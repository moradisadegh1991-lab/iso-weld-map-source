#!/usr/bin/env node
/**
 * Record today's earned-value and progress snapshot for every project
 * (lib/db/repos/controls.mjs, takeSnapshot) — the monthly figures EV history
 * is made of. For a scheduler (cron) on the day the project closes its month:
 *
 *   npm run controls:snapshot                   every project
 *   npm run controls:snapshot -- DEMO K110      these project codes only
 *
 * A project already snapshotted today is reported and skipped: the figure
 * recorded for a date is not replaced. With PGlite, stop the server first.
 */
import "./env.mjs";
import { getDb } from "../lib/server/db.mjs";
import { withProject } from "../lib/db/scope.mjs";
import { takeSnapshot } from "../lib/db/repos/controls.mjs";

const codes = process.argv.slice(2).map((c) => c.toUpperCase());
const db = await getDb();
const { rows } = await db.query("SELECT id, code FROM project ORDER BY code");
let failed = 0;
for (const p of rows.filter((r) => !codes.length || codes.includes(r.code))) {
  try {
    const s = await withProject(db, p.id, () => takeSnapshot(db, { projectId: p.id }));
    console.log(`✓ ${p.code}: ${s.asOf} — ${s.accounts} حساب کنترلی، ${s.progressRows} ردیف پیشرفت`);
  } catch (e) {
    if (e.code === "SNAPSHOT_EXISTS") console.log(`· ${p.code}: ${e.message}`);
    else { failed++; console.error(`✗ ${p.code}: ${e.message}`); }
  }
}
await db.close?.();
process.exit(failed ? 1 : 0);
