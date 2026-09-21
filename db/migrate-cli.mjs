#!/usr/bin/env node
/** `npm run db:migrate` — applies pending migrations to DATABASE_URL, or to a
 *  local PGlite directory when DATABASE_URL is unset. */
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
