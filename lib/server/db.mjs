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
import { writeFileSync, unlinkSync } from "node:fs";
import { createClient } from "../db/client.mjs";
import { migrate } from "../db/migrate.mjs";
import { serverLockPath } from "../db/backup.mjs";

let handle = null;

export async function getDb() {
  if (handle) return handle;
  handle = (async () => {
    const dataDir = process.env.PGLITE_DIR || ".pglite";
    const db = await createClient({ dataDir });
    // PGlite is one process. Say which one holds the directory, with a real
    // pid, so a backup can tell a running server from a stale lock left by a
    // server that was killed (PGlite's own postmaster.pid always reads -42).
    if (db.driver === "pglite") {
      const lock = serverLockPath(dataDir);
      try {
        writeFileSync(lock, String(process.pid));
        process.once("exit", () => { try { unlinkSync(lock); } catch { /* already gone */ } });
      } catch { /* a read-only checkout still serves; backups then refuse on postmaster.pid */ }
    }
    if (process.env.DB_AUTO_MIGRATE !== "off") await migrate(db);
    return db;
  })();
  return handle;
}

/** Tests only: drop the memoised handle so the next getDb starts clean. */
export function __resetDb() {
  handle = null;
}
