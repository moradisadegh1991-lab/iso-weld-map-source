/**
 * Database client.
 *
 * One interface, two drivers:
 *
 *   DATABASE_URL set    -> node-postgres against a real server
 *   DATABASE_URL unset  -> PGlite, real PostgreSQL compiled to WebAssembly,
 *                          running in this process
 *
 * PGlite is not a mock or a SQLite stand-in: it is PostgreSQL, so the
 * migrations, the jsonb columns and the row level security policies all
 * behave exactly as they will in production. That is what lets the whole
 * data layer be tested with no server, no container and no credentials,
 * which matters when the production database sits on the other side of a
 * network the developer machine cannot reach.
 *
 * New modules in this repository are written as .mjs so plain Node runs them
 * without a loader shim; the older lib/*.js files predate that choice.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{rows: any[], rowCount?: number}>,
 *              exec(sql: string): Promise<unknown>,
 *              transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>,
 *              close(): Promise<void>, driver: string }} Db */

/** @returns {Promise<Db>} */
export async function createClient({ url = process.env.DATABASE_URL, dataDir } = {}) {
  return url ? createPgClient(url) : createPgliteClient(dataDir);
}

async function createPgliteClient(dataDir) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create(dataDir ? { dataDir } : undefined);

  // A handle that looks like the client but is already inside a transaction.
  // `transaction` on it just runs the callback: a repository written to open
  // its own transaction still composes when called from one that is already
  // open, without silently starting a second, independent one.
  const wrap = (runner) => {
    const inner = {
      query: (sql, params) => runner.query(sql, params),
      exec: (sql) => runner.exec(sql),
      transaction: (fn) => fn(inner),
      inTransaction: true,
    };
    return inner;
  };

  return {
    driver: "pglite",
    query: (sql, params) => pg.query(sql, params),
    exec: (sql) => pg.exec(sql),
    // PGlite has no connection pool, so a transaction is just BEGIN/COMMIT on
    // the single connection. Nesting is not supported and never needed here.
    async transaction(fn) {
      await pg.exec("BEGIN");
      try {
        const out = await fn(wrap(pg));
        await pg.exec("COMMIT");
        return out;
      } catch (e) {
        await pg.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => pg.close(),
  };
}

/**
 * node-postgres: one scoped block = one dedicated connection.
 *
 * A pool hands every `pool.query` to whichever connection is idle, so session state set by one call
 * (`app.project_id`, `SET ROLE`) is NOT what the next call runs under — under concurrency a query ran
 * under another request's project, or as the login role (past row security), and an idle pooled
 * connection kept the last request's scope. That is the defect this replaces.
 *
 * Now a scoped block (`scope`, used by withProject/withoutProject) takes ONE connection, applies the role and the
 * project on it, and binds it to the block's async context: every `db.query` made anywhere inside (callers keep
 * using the `db` they already hold, none is rewritten) goes to that connection. On the way out — success, error or
 * anything else — the settings are cleared on it before it returns to the pool, and a connection that cannot be
 * cleared is destroyed, never reused. Work that must outlive the block (started from a request, not awaited) leaves
 * it with `outsideScope` (lib/db/scope.mjs).
 *
 * The block is NOT itself one transaction, like the PGlite path: code in this repository catches a failed statement
 * and goes on (eps-activities, eps-scope, intake, kpi…), and inside one transaction that silently discards every
 * write the block made before it (the transaction is aborted; COMMIT then rolls back without an error). A unit that
 * must be atomic says so with `db.transaction`: on the bound connection that is BEGIN/COMMIT (the scope holds
 * inside it), and one opened inside another is a SAVEPOINT — it composes, never a second independent transaction,
 * and a failure inside rolls back to its savepoint only.
 */
export const boundConnection = new AsyncLocalStorage();   // { pool, handle } for the running async chain
const SAFE_ROLE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

async function createPgClient(connectionString) {
  const { default: pg } = await import("pg");
  // a scoped block holds its connection for its whole life (reading a drawing inside one takes seconds), so the pool
  // size is the number of such blocks that run at once: DATABASE_POOL_MAX raises it (pg's default is 10)
  const pool = new pg.Pool({ connectionString, max: Number(process.env.DATABASE_POOL_MAX) || 10 });
  const bound = () => { const b = boundConnection.getStore(); return b && b.pool === pool ? b.handle : null; };

  const read = async (c) => (await c.query("SELECT current_setting('app.project_id', true) AS p, current_user AS u, session_user AS s")).rows[0];
  // `local`: inside a transaction, so a ROLLBACK TO undoes it; otherwise session-level on the dedicated connection
  const apply = async (c, { project = null, role = null }, local) => {
    await c.query("SELECT set_config('app.project_id', $1, $2)", [project ? String(project) : "", local]);
    if (role) { if (!SAFE_ROLE.test(role)) throw new Error(`unsafe role name: ${role}`); await c.query(`SET ${local ? "LOCAL " : ""}ROLE "${role}"`); }
  };
  // back to what the outer block had; the login role is RESET (a restricted role may not SET ROLE to it, but may always RESET)
  const restore = async (c, before, local) => {
    await c.query("SELECT set_config('app.project_id', $1, $2)", [before.p || "", local]);
    if (before.u === before.s) await c.query("RESET ROLE"); else await c.query(`SET ${local ? "LOCAL " : ""}ROLE "${before.u}"`);
  };

  // The handle of one held connection. `scope` and `transaction` on it are the nested forms.
  const makeHandle = (c) => {
    let n = 0, depth = 0;     // depth: 0 = autocommit, 1 = BEGIN issued, >1 = savepoints
    const h = {
      driver: "pg",
      get inTransaction() { return depth > 0; },
      query: (sql, p) => c.query(sql, p),
      exec: (sql) => c.query(sql),
      async transaction(fn) {
        if (depth === 0) {
          await c.query("BEGIN"); depth = 1;
          try { const out = await fn(h); await c.query("COMMIT"); return out; }
          catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
          finally { depth = 0; }
        }
        return savepoint(`sp_${++n}`, fn, null);
      },
      async scope(settings, fn) {
        if (depth === 0) {
          const before = await read(c);
          await apply(c, settings, false);
          try { return await fn(h); } finally { await restore(c, before, false); }
        }
        return savepoint(`sp_${++n}`, fn, settings);
      },
    };
    // SAVEPOINT … RELEASE on success, ROLLBACK TO … on failure (which also undoes a SET LOCAL made inside, and
    // lifts the aborted state so the caller may go on). A nested scope puts the outer settings back afterwards.
    const savepoint = async (name, fn, settings) => {
      await c.query(`SAVEPOINT ${name}`); depth += 1;
      const before = settings ? await read(c) : null;
      try {
        if (settings) await apply(c, settings, true);
        const out = await fn(h);
        if (settings) await restore(c, before, true);
        await c.query(`RELEASE SAVEPOINT ${name}`);
        return out;
      } catch (e) {
        try { await c.query(`ROLLBACK TO SAVEPOINT ${name}`); await c.query(`RELEASE SAVEPOINT ${name}`); } catch { /* the outer transaction is lost; its ROLLBACK follows */ }
        throw e;
      } finally { depth -= 1; }
    };
    return h;
  };

  // A top-level block: its own connection, released whatever happens; one that could not be cleared is destroyed.
  const top = async (fn, settings) => {
    const c = await pool.connect();
    let broken = null;
    try {
      const h = makeHandle(c);
      if (settings) await apply(c, settings, false);
      return await boundConnection.run({ pool, handle: h }, () => fn(h));
    } finally {
      try {
        await c.query("ROLLBACK").catch(() => {});                 // a block that ended mid-transaction leaves none behind
        await c.query("RESET ROLE"); await c.query("SELECT set_config('app.project_id', '', false)");
      } catch (e) { broken = e; }
      c.release(broken || undefined);
    }
  };

  return {
    driver: "pg",
    query: (sql, params) => (bound() || pool).query(sql, params),
    exec: (sql) => (bound() || pool).query(sql),
    transaction(fn) { const h = bound(); return h ? h.transaction(fn) : top((hh) => hh.transaction(fn), null); },
    scope(settings, fn) { const h = bound(); return h ? h.scope(settings, fn) : top(fn, settings); },
    close: () => pool.end(),
  };
}
