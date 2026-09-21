/**
 * The process-wide database handle for route handlers.
 *
 * Migrations run once, lazily, on first use. That is fine for a single
 * instance and for the PGlite development path; a multi-instance deployment
 * should run `npm run db:migrate` as a deploy step and set
 * DB_AUTO_MIGRATE=off, because two instances racing to apply the same
 * migration is a good way to find out what your locking story is at the
 * worst possible moment.
 */
import { createClient } from "../db/client.mjs";
import { migrate } from "../db/migrate.mjs";

let handle = null;

export async function getDb() {
  if (handle) return handle;
  handle = (async () => {
    const db = await createClient({ dataDir: process.env.PGLITE_DIR || ".pglite" });
    if (process.env.DB_AUTO_MIGRATE !== "off") await migrate(db);
    return db;
  })();
  return handle;
}

/** Tests only: drop the memoised handle so the next getDb starts clean. */
export function __resetDb() {
  handle = null;
}
