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

await run();
await db.close();
