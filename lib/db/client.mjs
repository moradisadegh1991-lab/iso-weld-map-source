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
 * node-postgres: one request = one connection = one transaction.
 *
 * A pool hands every `pool.query` to whichever connection is idle, so session state set by one
 * call (`app.project_id`, `SET ROLE`) is NOT what the next call runs under — under concurrency a
 * query ran under another request's project, or as the login role (past row security), and an idle
 * pooled connection kept the last request's scope. That is the defect this replaces.
 *
 * Now a scoped block (`scope`, used by withProject/withoutProject) takes ONE connection, BEGINs, applies the
 * role and the project with SET LOCAL / set_config(..., true) — transaction-local, so COMMIT or ROLLBACK
 * clears them whatever happens — and binds that connection to the block's async context. Every `db.query`
 * made anywhere inside (callers keep using the `db` they already hold, none is rewritten) is routed to it.
 * A transaction or scope opened inside runs on the same connection under a SAVEPOINT: it composes, it is
 * never a second independent transaction, and a failure inside rolls back to its savepoint only.
 * Work that must outlive the block (started from a request, not awaited) leaves it with `outsideScope`.
 */
export const boundConnection = new AsyncLocalStorage();   // { pool, handle } for the running async chain
const SAFE_ROLE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

async function createPgClient(connectionString) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString });
  const bound = () => { const b = boundConnection.getStore(); return b && b.pool === pool ? b.handle : null; };

  // The handle of one held connection. `scope` and `transaction` on it are the nested (savepoint) forms.
  const makeHandle = (c) => {
    let n = 0;
    const h = {
      driver: "pg", inTransaction: true,
      query: (sql, p) => c.query(sql, p),
      exec: (sql) => c.query(sql),
      async transaction(fn) { return savepoint(h, c, `sp_${++n}`, fn, null); },
      async scope(settings, fn) { return savepoint(h, c, `sp_${++n}`, fn, settings); },
    };
    return h;
  };
  // SAVEPOINT … RELEASE on success, ROLLBACK TO … on failure (which also undoes a SET LOCAL made inside, and
  // lifts the aborted state so the caller may go on). A nested scope puts the outer settings back afterwards.
  const savepoint = async (h, c, name, fn, settings) => {
    await c.query(`SAVEPOINT ${name}`);
    const before = settings ? (await c.query("SELECT current_setting('app.project_id', true) AS p, current_user AS u, session_user AS s")).rows[0] : null;
    try {
      if (settings) await applyScope(c, settings);
      const out = await fn(h);
      if (settings) await restoreScope(c, before);
      await c.query(`RELEASE SAVEPOINT ${name}`);
      return out;
    } catch (e) {
      try { await c.query(`ROLLBACK TO SAVEPOINT ${name}`); await c.query(`RELEASE SAVEPOINT ${name}`); } catch { /* the outer transaction is lost; its ROLLBACK follows */ }
      throw e;
    }
  };
  const applyScope = async (c, { project = null, role = null }) => {
    await c.query("SELECT set_config('app.project_id', $1, true)", [project ? String(project) : ""]);
    if (role) { if (!SAFE_ROLE.test(role)) throw new Error(`unsafe role name: ${role}`); await c.query(`SET LOCAL ROLE "${role}"`); }
  };
  const restoreScope = async (c, before) => {
    await c.query("SELECT set_config('app.project_id', $1, true)", [before.p || ""]);
    // back to the login role is RESET (a restricted role may not SET ROLE to the login role, but may always RESET)
    if (before.u === before.s) await c.query("RESET ROLE"); else await c.query(`SET LOCAL ROLE "${before.u}"`);
  };

  // A top-level block: its own connection and transaction, released whatever happens.
  const top = async (fn, settings) => {
    const c = await pool.connect();
    let broken = null;
    try {
      await c.query("BEGIN");
      const h = makeHandle(c);
      if (settings) await applyScope(c, settings);
      const out = await boundConnection.run({ pool, handle: h }, () => fn(h));
      await c.query("COMMIT");
      return out;
    } catch (e) {
      try { await c.query("ROLLBACK"); } catch (r) { broken = r; }
      throw e;
    } finally {
      c.release(broken || undefined);     // a connection that could not roll back is destroyed, not reused
    }
  };

  return {
    driver: "pg",
    query: (sql, params) => (bound() || pool).query(sql, params),
    exec: (sql) => (bound() || pool).query(sql),
    transaction(fn) { const h = bound(); return h ? h.transaction(fn) : top(fn, null); },
    scope(settings, fn) { const h = bound(); return h ? h.scope(settings, fn) : top(fn, settings); },
    close: () => pool.end(),
  };
}
