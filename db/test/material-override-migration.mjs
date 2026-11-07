#!/usr/bin/env node
/**
 * Migrations 102 (Phase 2d.1) and 103 (Phase 2d.2) against data: a database at 101 with override events, then 102 on top.
 *
 *   · sound data → 102 applies, nothing is lost, the composite keys and the NOT NULL are in place, and the old exception in the
 *     append-only trigger is gone (an UPDATE that nulls activity_id — what 101 let through for the owner — is now refused);
 *   · data that violates a new rule (a spool of another project, an activity of another spool, an event with no activity) →
 *     102 STOPS, names the event, and changes nothing.
 * Runs on PGlite; the privilege side (app_rw) is proved on PostgreSQL in material-override.mjs / material-concurrency.mjs.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../../lib/db/client.mjs";
import { migrate } from "../../lib/db/migrate.mjs";

const ALL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const staged = await scratchDir("mig102-files-");          // up to 101
const staged102 = await scratchDir("mig102b-files-");       // up to 102
for (const f of (await readdir(ALL)).filter((f) => f.endsWith(".sql")).sort()) {
  if (f < "102") await copyFile(path.join(ALL, f), path.join(staged, f));
  if (f < "103") await copyFile(path.join(ALL, f), path.join(staged102, f));
}
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];

/** A database at 101 with two projects, a spool and a step in each, and one sound override event in project A. */
async function at101() {
  // On PostgreSQL (DATABASE_URL, an empty database the user owns) every scenario starts from a wiped schema; on PGlite from a new directory.
  const db = process.env.DATABASE_URL ? await createClient({ url: process.env.DATABASE_URL }) : await createClient({ dataDir: await scratchDir("mig102-db-") });
  if (process.env.DATABASE_URL) await db.exec("DROP SCHEMA IF EXISTS reporting CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(db, { dir: staged });
  const user = await one(db, "INSERT INTO app_user (subject) VALUES ('kc|m102') RETURNING id");
  const w = {};
  for (const k of ["A", "B"]) {
    const proj = await one(db, "INSERT INTO project (code, name) VALUES ($1,$1) RETURNING id", [k]);
    const doc = await one(db, `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'D','0',$2,'local://x') RETURNING id`, [proj.id, k.repeat(64)]);
    const rn = await one(db, `INSERT INTO extraction_run (project_id, document_id, payload, status) VALUES ($1,$2,'{}','extracted') RETURNING id`, [proj.id, doc.id]);
    const sp = await one(db, "INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,'SP-1') RETURNING id", [proj.id, rn.id]);
    const sp2 = await one(db, "INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,'SP-2') RETURNING id", [proj.id, rn.id]);
    const ac = await one(db, "INSERT INTO spool_activity (project_id, spool_id, code, status, done_at) VALUES ($1,$2,'fit_up','done','2026-09-10') RETURNING id", [proj.id, sp.id]);
    w[k] = { project: proj.id, spool: sp.id, spool2: sp2.id, activity: ac.id };
  }
  const ev = (project, spool, activity, reason = "r") => one(db,
    "INSERT INTO material_override (project_id, spool_id, activity_id, code, reason, authorized_by, source) VALUES ($1,$2,$3,'fit_up',$4,$5,'web') RETURNING id",
    [project, spool, activity, reason, user.id]);
  const good = await ev(w.A.project, w.A.spool, w.A.activity, "sound");
  return { db, w, ev, user, good };
}
const constraints = async (db) => (await db.query(
  "SELECT conname FROM pg_constraint WHERE conrelid IN ('material_override'::regclass) ORDER BY conname")).rows.map((r) => r.conname);

test("sound data: 102 applies, the event is kept as it was, the keys and NOT NULL are in place", async () => {
  const { db, good } = await at101();
  const before = await one(db, "SELECT * FROM material_override WHERE id = $1", [good.id]);
  assert((await constraints(db)).includes("material_override_spool_id_fkey"), "101's single-column key is there before");
  const ran = await migrate(db, { dir: staged102 });
  assert(ran.includes("102_material_override_integrity"), JSON.stringify(ran));
  const after = await one(db, "SELECT * FROM material_override WHERE id = $1", [good.id]);
  equal(after, before, "the event is byte-for-byte what it was");
  const c = await constraints(db);
  for (const k of ["material_override_spool_fkey", "material_override_activity_fkey"]) assert(c.includes(k), `${k} missing: ${c}`);
  for (const k of ["material_override_project_id_fkey", "material_override_spool_id_fkey", "material_override_activity_id_fkey"]) assert(!c.includes(k), `${k} still there`);
  const nn = await one(db, "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'material_override' AND column_name = 'activity_id'");
  equal(nn.is_nullable, "NO");
  await db.close();
});

test("the old exception is gone: nulling activity_id passed the trigger at 101 (owner) and is refused after 102", async () => {
  const old = await at101();
  await old.db.query("UPDATE material_override SET activity_id = NULL WHERE id = $1", [old.good.id]);       // 101: the trigger lets it through
  equal((await one(old.db, "SELECT activity_id FROM material_override WHERE id = $1", [old.good.id])).activity_id, null, "the weakness, shown");
  await old.db.close();
  const fresh = await at101();
  await migrate(fresh.db, { dir: staged102 });
  const e = await throws(() => fresh.db.query("UPDATE material_override SET activity_id = NULL WHERE id = $1", [fresh.good.id]), "");
  assert(/append-only/.test(e.message), `refused by the trigger, not by something else: ${e.message}`);
  assert((await one(fresh.db, "SELECT activity_id FROM material_override WHERE id = $1", [fresh.good.id])).activity_id, "still there");
  await fresh.db.close();
});

for (const [name, build, needle] of [
  ["a spool of another project", (x) => x.ev(x.w.B.project, x.w.A.spool, x.w.B.activity, "BAD-SPOOL"), "another project"],
  ["an activity of another spool of the same project", (x) => x.ev(x.w.A.project, x.w.A.spool2, x.w.A.activity, "BAD-ACT"), "not of their project and spool"],
  ["an activity of another project", (x) => x.ev(x.w.A.project, x.w.A.spool, x.w.B.activity, "BAD-ACT2"), "not of their project and spool"],
]) {
  test(`102 stops, names the event and changes nothing: ${name}`, async () => {
    const x = await at101();
    const bad = await build(x);
    const rowsBefore = (await x.db.query("SELECT * FROM material_override ORDER BY id")).rows;
    const e = await throws(() => migrate(x.db, { dir: staged102 }), needle);
    assert(e.message.includes(bad.id), `the message names the event: ${e.message}`);
    equal((await x.db.query("SELECT * FROM material_override ORDER BY id")).rows, rowsBefore, "no event rewritten or removed");
    assert((await constraints(x.db)).includes("material_override_spool_id_fkey"), "the schema is still 101's");
    equal((await x.db.query("SELECT 1 FROM schema_migrations WHERE version LIKE '102%'")).rows.length, 0, "102 is not recorded");
    await x.db.close();
  });
}

test("102 stops on an event that lost its activity at 101 (SET NULL), and says which", async () => {
  const x = await at101();
  const lost = await x.ev(x.w.A.project, x.w.A.spool, x.w.A.activity, "lost");
  await x.db.query("DELETE FROM spool_activity WHERE id = $1", [x.w.A.activity]);   // 101: SET NULL on both events
  const e = await throws(() => migrate(x.db, { dir: staged102 }), "with no activity");
  assert(e.message.includes(lost.id) && e.message.includes(x.good.id), e.message);
  equal((await x.db.query("SELECT count(*)::int AS n FROM material_override")).rows[0].n, 2);
  await x.db.close();
});

// ── 103: the snapshot ─────────────────────────────────────────────────────

test("103: existing events are filled in from the live rows, unchanged otherwise; the keys to spool and activity are gone", async () => {
  const x = await at101();
  await migrate(x.db, { dir: staged102 });
  const before = await one(x.db, "SELECT * FROM material_override WHERE id = $1", [x.good.id]);
  const ran = await migrate(x.db);
  assert(ran.includes("103_material_override_snapshot"), JSON.stringify(ran));   // later migrations may follow it
  const after = await one(x.db, "SELECT * FROM material_override WHERE id = $1", [x.good.id]);
  const { spool_no, run_id, document_id, doc_no, revision, sheet_no, line_no, ...kept } = after;
  const { spool_no: _a, run_id: _b, document_id: _c, doc_no: _d, revision: _e, sheet_no: _f, line_no: _g, ...was } = before;
  equal(kept, was, "every column the event had is exactly as it was");
  equal([spool_no, doc_no, revision, sheet_no, line_no], ["SP-1", "D", "0", "1/1", null]);
  const live = await one(x.db, "SELECT r.id AS run_id, d.id AS document_id FROM spool s JOIN extraction_run r ON r.id = s.extraction_run_id JOIN document d ON d.id = r.document_id WHERE s.id = $1", [x.w.A.spool]);
  equal([run_id, document_id], [live.run_id, live.document_id]);
  const c = await constraints(x.db);
  for (const k of ["material_override_spool_fkey", "material_override_activity_fkey"]) assert(!c.includes(k), `${k} still there`);
  assert(c.includes("material_override_project_fkey"), c.join());
  equal((await x.db.query("SELECT 1 FROM pg_constraint WHERE conname IN ('spool_project_id_id_key','spool_activity_id_project_spool_key')")).rows.length, 0, "the key targets of 102 are dropped with them");
  // the spool and the step can now go; the event stays
  await x.db.query("DELETE FROM spool WHERE id = $1", [x.w.A.spool]);
  equal((await one(x.db, "SELECT count(*)::int AS n FROM material_override WHERE id = $1", [x.good.id])).n, 1);
  equal(await one(x.db, "SELECT * FROM material_override WHERE id = $1", [x.good.id]), after, "and is byte-for-byte what 103 left");
  // still append-only, for the owner too
  const e = await throws(() => x.db.query("UPDATE material_override SET spool_no = 'X' WHERE id = $1", [x.good.id]), "");
  assert(/append-only/.test(e.message), e.message);
  await x.db.close();
});

test("103: the insert-time check replaces the keys — foreign spool, foreign activity and a forged snapshot", async () => {
  const x = await at101();
  await migrate(x.db);
  const ins = (project, spool, activity, extra = "") => one(x.db,
    `INSERT INTO material_override (project_id, spool_id, activity_id, code, reason, authorized_by, source${extra ? ", spool_no, doc_no" : ""}) VALUES ($1,$2,$3,'fit_up','r2',$4,'web'${extra ? ",'FORGED','FORGED'" : ""}) RETURNING id, spool_no, doc_no`,
    [project, spool, activity, x.user.id]);
  await throws(() => ins(x.w.B.project, x.w.A.spool, x.w.B.activity), "is not a spool of project");
  await throws(() => ins(x.w.A.project, x.w.A.spool2, x.w.A.activity), "is not an activity of spool");
  await throws(() => ins(x.w.A.project, x.w.A.spool, x.w.B.activity), "is not an activity of spool");
  const ok = await ins(x.w.A.project, x.w.A.spool, x.w.A.activity, "forged");
  equal([ok.spool_no, ok.doc_no], ["SP-1", "D"], "the snapshot is the database's");
  await x.db.close();
});

await run();
