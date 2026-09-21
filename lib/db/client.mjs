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

  const wrap = (runner) => ({
    query: (sql, params) => runner.query(sql, params),
    exec: (sql) => runner.exec(sql),
  });

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

async function createPgClient(connectionString) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString });

  return {
    driver: "pg",
    query: (sql, params) => pool.query(sql, params),
    exec: (sql) => pool.query(sql),
    // A real transaction must hold ONE connection for its whole life, or the
    // statements land on different pool members and the BEGIN means nothing.
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const out = await fn({ query: (s, p) => c.query(s, p), exec: (s) => c.query(s) });
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}
