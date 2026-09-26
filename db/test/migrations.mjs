#!/usr/bin/env node
/**
 * Migrations that move data, tested against data.
 *
 * A migration that restructures a table is only as good as what it does to
 * the rows already in it, and those rows exist only on databases that were
 * migrated before it. So this builds exactly that: a database at 011, legacy
 * values written the old way, and then 012 applied on top.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { mkdtemp, readdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../../lib/db/client.mjs";
import { migrate } from "../../lib/db/migrate.mjs";

const ALL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const staged = await mkdtemp(path.join(tmpdir(), "mig-files-"));
for (const f of (await readdir(ALL)).filter((f) => f.endsWith(".sql")).sort()) {
  if (f < "012") await copyFile(path.join(ALL, f), path.join(staged, f));
}

const db = await createClient({ dataDir: await mkdtemp(path.join(tmpdir(), "mig-db-")) });
await migrate(db, { dir: staged });

// ── the world before 012: spools with free-set statuses ──────────────────
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const user = await one("INSERT INTO app_user (subject) VALUES ('kc|legacy') RETURNING id");
const proj = await one("INSERT INTO project (code, name) VALUES ('OLD','old') RETURNING id");
const doc = await one(
  `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
   VALUES ($1,'D-1','0',$2,'local://x') RETURNING id`, [proj.id, "c".repeat(64)]);
const r = await one(
  `INSERT INTO extraction_run (project_id, document_id, payload, status)
   VALUES ($1,$2,'{}','extracted') RETURNING id`, [proj.id, doc.id]);

const legacy = { "SP-01": "erected", "SP-02": "fabricated", "SP-03": "planned",
                 "SP-04": "painted", "SP-05": "released" };
for (const [no, status] of Object.entries(legacy)) {
  await db.query(
    `INSERT INTO spool (project_id, extraction_run_id, spool_no, fab_status, fab_status_at, fab_status_by)
     VALUES ($1,$2,$3,$4::fabrication_status,'2026-06-15',$5)`, [proj.id, r.id, no, status, user.id]);
}

await migrate(db);   // everything from 012 on

const acts = async (no) => (await db.query(
  `SELECT a.code, a.done_at, a.note, a.recorded_by FROM spool_activity a
     JOIN spool s ON s.id = a.spool_id WHERE s.spool_no = $1 ORDER BY a.code`, [no])).rows;

test("an old status becomes the chain steps it implies", async () => {
  equal((await acts("SP-01")).map((a) => a.code), ["erected", "fit_up", "released"]);
  equal((await acts("SP-02")).map((a) => a.code), ["fit_up", "released"]);
  equal((await acts("SP-04")).map((a) => a.code), ["fit_up", "painted", "released"]);
  equal((await acts("SP-05")).map((a) => a.code), ["released"]);
  equal((await acts("SP-03")).length, 0, "planned implies nothing, so nothing is invented");
});

test("carried-over steps keep their date and their author, and say where they came from", async () => {
  const [a] = await acts("SP-02");
  equal(new Date(a.done_at).toISOString().slice(0, 10), "2026-06-15");
  equal(a.recorded_by, user.id);
  assert(/fab_status=fabricated/.test(a.note), "nobody should mistake it for a fresh entry");
});

test("a spool that was 'fabricated' is still built, so its revisions still warn", async () => {
  // This is the property the revision diff depends on. "fabricated" cannot
  // become weld records — there is no welder or joint date to make them
  // from — but fit-up is enough to keep the steel on the rework list.
  const rows = (await db.query(
    "SELECT spool_no, built FROM reporting.spool_stage ORDER BY spool_no")).rows;
  const built = Object.fromEntries(rows.map((x) => [x.spool_no, x.built]));
  equal(built, { "SP-01": true, "SP-02": true, "SP-03": false, "SP-04": true, "SP-05": false });
});

test("the free-set column and its type are gone", async () => {
  const col = await one(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'spool' AND column_name LIKE 'fab_%'`);
  equal(col.n, 0);
  const typ = await one("SELECT count(*)::int AS n FROM pg_type WHERE typname = 'fabrication_status'");
  equal(typ.n, 0);
});

test("row level security is forced again after the carry-over", async () => {
  // The carry-over lifts FORCE for one statement. Leaving it lifted would
  // quietly exempt the table owner from every policy from then on.
  const rows = (await db.query(
    `SELECT relname, relforcerowsecurity FROM pg_class
      WHERE relname IN ('spool', 'spool_activity') ORDER BY relname`)).rows;
  equal(rows.map((x) => x.relforcerowsecurity), [true, true]);
});

// ── 044b/045: a signed-off 'material' ITP on a database at 044 ───────────
//
// An approved ITP is fixed by its trigger, and the old constraint knows only
// 'material' — so a migration that only ever ran on an empty schema can pass
// every other test and still fail on the first real project it meets. 045
// as released did exactly that; 044b repairs it without editing it.
const staged45 = await mkdtemp(path.join(tmpdir(), "mig-files-45-"));
for (const f of (await readdir(ALL)).filter((f) => f.endsWith(".sql")).sort()) {
  if (f < "044b") await copyFile(path.join(ALL, f), path.join(staged45, f));
}
const db45 = await createClient({ dataDir: await mkdtemp(path.join(tmpdir(), "mig-db-45-")) });
await migrate(db45, { dir: staged45 });
const one45 = async (sql, p) => (await db45.query(sql, p)).rows[0];
const prep = await one45("INSERT INTO app_user (subject) VALUES ('kc|prep') RETURNING id");
const appr = await one45("INSERT INTO app_user (subject) VALUES ('kc|appr') RETURNING id");
const p45 = await one45("INSERT INTO project (code, name) VALUES ('M45','m45') RETURNING id");
await db45.query("SELECT set_config('app.project_id', $1, false)", [p45.id]);
await db45.query(
  `INSERT INTO itp (project_id, itp_no, revision, title, scope, status, prepared_by, approved_by, approved_on) VALUES
     ($1,'ITP-MAT-1','0','Receiving','material','approved',$2,$3,'2026-01-01'),
     ($1,'ITP-MAT-2','0','Receiving draft','material','draft',$2,NULL,NULL),
     ($1,'ITP-CBL-1','0','Cable','cable','approved',$2,$3,'2026-01-01')`, [p45.id, prep.id, appr.id]);
await db45.query("SELECT set_config('app.project_id', '', false)");
await migrate(db45);

test("045: an approved 'material' ITP becomes material_pressure, and so does a draft; other scopes are untouched", async () => {
  await db45.query("SELECT set_config('app.project_id', $1, false)", [p45.id]);
  const rows = (await db45.query("SELECT itp_no, scope, status FROM itp ORDER BY itp_no")).rows;
  equal(rows.map((r) => [r.itp_no, r.scope, r.status]), [
    ["ITP-CBL-1", "cable", "approved"],
    ["ITP-MAT-1", "material_pressure", "approved"],
    ["ITP-MAT-2", "material_pressure", "draft"],
  ]);
});

test("045: the approved ITP is fixed again afterwards, and row level security is forced again", async () => {
  let refused = null;
  try { await db45.query("UPDATE itp SET scope = 'material_general' WHERE itp_no = 'ITP-MAT-1'"); } catch (e) { refused = e.message; }
  assert(/a change is a new revision/.test(refused || ""), `trigger back on: ${refused}`);
  const { rows: [r] } = await db45.query("SELECT relforcerowsecurity FROM pg_class WHERE relname = 'itp'");
  equal(r.relforcerowsecurity, true);
  let bad = null;
  try { await db45.query("UPDATE itp SET scope = 'material' WHERE itp_no = 'ITP-MAT-2'"); } catch (e) { bad = e.message; }
  assert(/itp_scope_known/.test(bad || ""), "'material' is no longer a scope");
});

// The other history: 045 as released already applied (no 'material' ITP
// then, so it succeeded), and 044b arrives afterwards. It must change
// nothing and fail on nothing.
const stagedAfter = await mkdtemp(path.join(tmpdir(), "mig-files-after-"));
for (const f of (await readdir(ALL)).filter((f) => f.endsWith(".sql")).sort()) {
  if (f !== "044b_material_itp_reassign.sql") await copyFile(path.join(ALL, f), path.join(stagedAfter, f));
}
const dbAfter = await createClient({ dataDir: await mkdtemp(path.join(tmpdir(), "mig-db-after-")) });
await migrate(dbAfter, { dir: stagedAfter });
const pa = (await dbAfter.query("INSERT INTO project (code, name) VALUES ('M45B','m') RETURNING id")).rows[0];
const ua = (await dbAfter.query("INSERT INTO app_user (subject) VALUES ('kc|a') RETURNING id")).rows[0];
const ub = (await dbAfter.query("INSERT INTO app_user (subject) VALUES ('kc|b') RETURNING id")).rows[0];
await dbAfter.query("SELECT set_config('app.project_id', $1, false)", [pa.id]);
await dbAfter.query(
  `INSERT INTO itp (project_id, itp_no, revision, title, scope, status, prepared_by, approved_by, approved_on)
   VALUES ($1,'ITP-E-1','0','Electrical receiving','material_electrical','approved',$2,$3,'2026-02-01')`, [pa.id, ua.id, ub.id]);
await dbAfter.query("SELECT set_config('app.project_id', '', false)");
const lateRan = await migrate(dbAfter);

test("044b after 045: applied late, it changes nothing and the new scopes stand", async () => {
  equal(lateRan, ["044b_material_itp_reassign"]);
  await dbAfter.query("SELECT set_config('app.project_id', $1, false)", [pa.id]);
  const { rows } = await dbAfter.query("SELECT itp_no, scope, status FROM itp");
  equal(rows.map((r) => [r.itp_no, r.scope, r.status]), [["ITP-E-1", "material_electrical", "approved"]]);
  const { rows: [c] } = await dbAfter.query(
    "SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'itp_scope_known'");
  assert(/material_general/.test(c.d) && !/'material'::/.test(c.d), c.d);
});

await run();
await db.close();
await db45.close();
await dbAfter.close();
