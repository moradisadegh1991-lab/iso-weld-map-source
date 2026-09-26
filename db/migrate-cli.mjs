#!/usr/bin/env node
/** `npm run db:migrate` — applies pending migrations to DATABASE_URL, or to a
 *  local PGlite directory when DATABASE_URL is unset.
 *
 *  The env import is not decoration. Without it this script cannot see the
 *  DATABASE_URL in .env.local, silently falls back to a local PGlite
 *  directory, migrates THAT, and reports success — while the app and the
 *  doctor, which do read .env.local, go on talking to a database with no
 *  tables in it. The failure is invisible at exactly the moment it matters:
 *  the setup step says "6 migrations applied" and the next line says
 *  "0 of 6 applied". db/test/run.mjs pins this import for that reason. */
import "../tools/env.mjs";
import { createClient } from "../lib/db/client.mjs";
import { migrate } from "../lib/db/migrate.mjs";

const dataDir = process.env.PGLITE_DIR || ".pglite";
const db = await createClient({ dataDir });
try {
  console.log(`driver: ${db.driver}${db.driver === "pglite" ? ` (${dataDir})` : ""}`);
  const ran = await migrate(db, { log: (m) => console.log("  " + m) });
  console.log(ran.length ? `${ran.length} migration(s) applied.` : "already up to date.");
} finally {
  await db.close();
}
