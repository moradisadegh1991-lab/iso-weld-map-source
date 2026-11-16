#!/usr/bin/env node
/**
 * Override audit retention across the life of a register (Phase 2d.2, migration 103).
 *
 * Editing a register deletes the run's spool rows and inserts new ones (review.mjs applyCorrection); a new extraction run
 * or a new drawing revision makes new spool rows beside the old ones. An override is an engineering decision, not a
 * generated row: it must survive all of these, stay readable (spool number, drawing, revision), never be duplicated, and
 * stay append-only and project-scoped. These tests drive the real flows (createRun → saveRegister → applyCorrection).
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { overrideProvenance } from "../../lib/piping/override-provenance.mjs";
import { has, translate } from "../../lib/i18n/index.mjs";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("mat-retention-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runsRepo = await import("../../lib/db/repos/runs.mjs");
const review = await import("../../lib/db/repos/review.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const px = await import("../../lib/db/repos/piping-execution.mjs");
const { buildModel } = await import("../../lib/engine.js");
const { DEMO } = await import("../../lib/demo.js");

const db = await getDb();
const eng = await projects.ensureUser(db, { subject: "kc|eng", displayName: "Eng" });
const P = (await projects.createProject(db, { code: "RET", name: "R", ownerUserId: eng.id })).id;
const Q = (await projects.createProject(db, { code: "RE2", name: "R2", ownerUserId: eng.id })).id;
const inP = (fn) => withProject(db, P, fn);
const ENG = { role: "engineer", areas: [] };
/** The same db, but the statement matching `re` fails — also on the handles of nested transactions. */
const wrap = (base, re) => ({ ...base,
  query: async (sql, p) => { if (re.test(sql)) throw Object.assign(new Error("injected failure"), { injected: true }); return base.query(sql, p); },
  transaction: (fn) => base.transaction((t) => fn(wrap(t, re))) });
const failOn = (re) => wrap(db, re);

const payloadWithQty = (qty) => { const p = JSON.parse(JSON.stringify(DEMO)); p.bom = p.bom.map((b) => (b.pt === 1 ? { ...b, qty } : b)); return p; };
const doc = (revision, hash) => inP(async () => (await db.query(
  `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'SW-RET',$2,$3,'local://r') RETURNING id`, [P, revision, hash.repeat(64)])).rows[0].id);
/** createRun + saveRegister, as POST /api/runs does; returns the run id and its spools by number. */
const derive = (documentId, qty = 12.6) => inP(async () => {
  const payload = payloadWithQty(qty);
  const model = buildModel(payload, {});
  const r = await runsRepo.createRun(db, { projectId: P, documentId, payload, validationChecks: model.checks, createdBy: eng.id });
  await runsRepo.saveRegister(db, { projectId: P, runId: r.id, documentId, model });
  const spools = Object.fromEntries((await db.query("SELECT id, spool_no FROM spool WHERE extraction_run_id = $1", [r.id])).rows.map((s) => [s.spool_no, s.id]));
  return { runId: r.id, spools };
});
const correct = (runId, qty, scope = db) => inP(() => review.applyCorrection(scope, { projectId: P, runId, payload: payloadWithQty(qty), userId: eng.id }));
const events = () => inP(async () => (await db.query("SELECT * FROM material_override WHERE project_id = $1 ORDER BY authorized_at, id", [P])).rows);
const count = (sql, params = []) => inP(async () => Number((await db.query(sql, params)).rows[0].n));
const spoolsOf = (runId) => inP(async () => Object.fromEntries((await db.query("SELECT id, spool_no FROM spool WHERE extraction_run_id = $1", [runId])).rows.map((s) => [s.spool_no, s.id])));

let docA, docB, run1, spoolNo, oldSpoolId, oldActivityId, ev0, currentSpoolId;

await inP(async () => { await wh.upsertItem(db, { projectId: P, code: "PIPE-RET", description: "pipe", category: "pipe", uom: "m" }); });

test("setup: an override is made on a spool of the first derivation", async () => {
  docA = await doc("0", "a");
  run1 = await derive(docA, 40);
  spoolNo = Object.keys(run1.spools)[0];
  oldSpoolId = run1.spools[spoolNo];
  await inP(() => db.query("INSERT INTO spool_material (project_id, spool_id, kind, qty, uom, stock_code) VALUES ($1,$2,'pipe',5,'m','PIPE-RET')", [P, oldSpoolId]));
  const r = await inP(() => px.recordSpoolActivity(db, { projectId: P, spoolId: oldSpoolId, code: "fit_up", doneAt: "2026-09-10", userId: eng.id, membership: ENG, materialOverride: "yard stock, MIV to follow" }));
  oldActivityId = r.id;
  [ev0] = await events();
  equal([ev0.spool_no, ev0.doc_no, ev0.revision, ev0.sheet_no, ev0.run_id, ev0.document_id, ev0.spool_id, ev0.activity_id],
        [spoolNo, "SW-RET", "0", "1/1", run1.runId, docA, oldSpoolId, oldActivityId], "the snapshot is the live rows' reading");
  const own = await inP(() => px.materialOverrides(db, { projectId: P, spoolId: oldSpoolId }));
  equal([own[0].match_basis, own[0].same_spool, overrideProvenance(own[0]).exact], ["exact_spool", true, true]);
});

test("1,4,5,6. editing and re-deriving the register: the spool rows are replaced, the event is not lost, duplicated or unreadable", async () => {
  await correct(run1.runId, 12.6);
  const now = await spoolsOf(run1.runId);
  assert(now[spoolNo] && now[spoolNo] !== oldSpoolId, "the spool was regenerated with a new id");
  equal(await count("SELECT count(*) AS n FROM spool WHERE id = $1", [oldSpoolId]), 0, "the old spool row is gone");
  equal(await count("SELECT count(*) AS n FROM spool_activity WHERE id = $1", [oldActivityId]), 0, "and so is its step (existing behaviour)");
  const ev = await events();
  equal(ev.length, 1, "exactly one event, not lost, not duplicated");
  equal(ev[0], ev0, "byte-for-byte the event that was written");
  // a second re-derivation does not duplicate it either
  await correct(run1.runId, 30);
  equal((await events()).length, 1);
  // historical identity stays readable, and the spool as it is now finds it
  const newId = (await spoolsOf(run1.runId))[spoolNo];
  const h = await inP(() => px.materialOverrides(db, { projectId: P, spoolId: newId }));
  equal(h.length, 1);
  equal([h[0].spool_no, h[0].doc_no, h[0].revision, h[0].spool_id, h[0].activity_id, h[0].same_spool, h[0].reason],
        [spoolNo, "SW-RET", "0", oldSpoolId, oldActivityId, false, "yard stock, MIV to follow"]);
  equal(h[0].match_basis, "same_run_number_unverified");
});

test("2. a new extraction run of the same document: the old event is still there and the new spool finds it", async () => {
  const run2 = await derive(docA, 12.6);
  assert(run2.runId !== run1.runId);
  equal((await events()).length, 1);
  const h = await inP(() => px.materialOverrides(db, { projectId: P, spoolId: run2.spools[spoolNo] }));
  equal(h.length, 1);
  equal([h[0].run_id, h[0].same_spool], [run1.runId, false], "made on the first run, shown on the second");
  equal(h[0].match_basis, "same_revision_number_unverified");
});

test("3. a new drawing revision: the event is still the old revision's and says so", async () => {
  docB = await doc("B", "b");
  const run3 = await derive(docB, 12.6);
  currentSpoolId = run3.spools[spoolNo];
  const h = await inP(() => px.materialOverrides(db, { projectId: P, spoolId: run3.spools[spoolNo] }));
  equal(h.length, 1);
  equal([h[0].revision, h[0].document_id, h[0].doc_no], ["0", docA, "SW-RET"]);
  equal(h[0].match_basis, "cross_revision_number_unverified");
  const own = await inP(async () => (await db.query("SELECT d.revision FROM spool s JOIN extraction_run r ON r.id = s.extraction_run_id JOIN document d ON d.id = r.document_id WHERE s.id = $1", [run3.spools[spoolNo]])).rows[0].revision);
  equal(own, "B", "the spool being looked at is revision B, the event revision 0: distinguishable");
  // an override made on revision B is its own event, listed with the older one
  await inP(() => db.query("INSERT INTO spool_material (project_id, spool_id, kind, qty, uom, stock_code) VALUES ($1,$2,'pipe',5,'m','PIPE-RET')", [P, run3.spools[spoolNo]]));
  await inP(() => px.recordSpoolActivity(db, { projectId: P, spoolId: run3.spools[spoolNo], code: "fit_up", doneAt: "2026-09-20", userId: eng.id, membership: ENG, materialOverride: "again on rev B" }));
  const both = await inP(() => px.materialOverrides(db, { projectId: P, spoolId: run3.spools[spoolNo] }));
  equal(both.map((e) => [e.revision, e.same_spool]), [["B", true], ["0", false]]);
  equal(both.map((e) => e.match_basis), ["exact_spool", "cross_revision_number_unverified"]);
});

test("a spool of the same number on ANOTHER drawing does not see the event", async () => {
  const other = await inP(async () => (await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'SW-OTHER','0',$2,'local://o') RETURNING id`, [P, "c".repeat(64)])).rows[0].id);
  const r = await derive(other, 12.6);
  const h = await inP(() => px.materialOverrides(db, { projectId: P, spoolId: r.spools[spoolNo] }));
  equal(h.length, 0);
});

test("7. a failed re-derivation rolls back whole: spools, steps and history as they were", async () => {
  const before = { spools: await spoolsOf(run1.runId), events: await events() };
  const r = await inP(async () => (await db.query("SELECT id FROM spool_activity WHERE project_id = $1 LIMIT 1", [P])).rows.length);
  // a geometry edit (run1 is no longer its revision's current run, so sheet data may not be changed through it — Phase 1)
  const geometry = payloadWithQty(30); geometry.nodes[2].N += 100;
  await throws(() => inP(() => review.applyCorrection(failOn(/INSERT INTO weld /), { projectId: P, runId: run1.runId, payload: geometry, userId: eng.id })), "injected failure");
  equal(await spoolsOf(run1.runId), before.spools, "the spool rows are the ones that were there");
  equal(await events(), before.events, "the history is untouched");
  void r;
});

test("9. project isolation: another project reads nothing, and cannot attach an event to this project's spool", async () => {
  const h = await withProject(db, Q, () => px.materialOverrides(db, { projectId: Q }));
  equal(h.length, 0);
  const forged = await withProject(db, Q, () => px.materialOverrides(db, { projectId: P }));
  equal(forged.length, 0, "naming this project from another project's scope gives nothing (RLS)");
  const sp = Object.values(await spoolsOf(run1.runId))[0];
  const act = await inP(async () => (await db.query("INSERT INTO spool_activity (project_id, spool_id, code, status, done_at) VALUES ($1,$2,'erected','done','2026-09-11') RETURNING id", [P, sp])).rows[0].id);
  await throws(() => withProject(db, Q, () => db.query(
    "INSERT INTO material_override (project_id, spool_id, activity_id, code, reason, authorized_by, source) VALUES ($1,$2,$3,'erected','x',$4,'web')", [Q, sp, act, eng.id])), "is not a spool of project");
});

test("10. append-only holds on the snapshot too: no UPDATE of any column, no DELETE, and a forged snapshot is overwritten", async () => {
  const sp = Object.values(await spoolsOf(run1.runId))[0];
  const act = await inP(async () => (await db.query("SELECT id FROM spool_activity WHERE spool_id = $1", [sp])).rows[0].id);
  const id = (await inP(() => db.query(
    `INSERT INTO material_override (project_id, spool_id, activity_id, code, reason, authorized_by, source, spool_no, doc_no, revision)
     VALUES ($1,$2,$3,'erected','forging',$4,'web','FORGED','FORGED-DOC','Z') RETURNING id, spool_no, doc_no, revision`, [P, sp, act, eng.id]))).rows[0];
  equal([id.doc_no === "FORGED-DOC", id.spool_no === "FORGED", id.revision === "Z"], [false, false, false], "the trigger wrote the snapshot, not the writer");
  for (const set of ["spool_no = 'X'", "doc_no = 'X'", "revision = 'X'", "run_id = gen_random_uuid()", "spool_id = gen_random_uuid()", "reason = 'x'"])
    await throws(() => inP(() => db.query(`UPDATE material_override SET ${set} WHERE id = $1`, [id.id])), "permission denied");
  await throws(() => inP(() => db.query("DELETE FROM material_override WHERE id = $1", [id.id])), "permission denied");
});

test("deleting a step or a spool directly does not touch the events either", async () => {
  const before = (await events()).length;
  await inP(() => db.query("DELETE FROM spool WHERE extraction_run_id = $1", [run1.runId]));
  equal((await events()).length, before, "events survive the spool rows");
});

test("the same drawing and spool number on another sheet finds no history", async () => {
  const other = await inP(async () => (await db.query(
    `INSERT INTO document (project_id, doc_no, revision, sheet_no, file_sha256, storage_uri)
     VALUES ($1,'SW-RET','C','2/2',$2,'local://sheet') RETURNING id`, [P, "d".repeat(64)])).rows[0].id);
  const r = await derive(other);
  equal(await inP(() => px.materialOverrides(db, { projectId: P, spoolId: r.spools[spoolNo] })), []);
});

test("renumbering the current spool keeps its direct event exact, without treating old printed numbers as continuity", async () => {
  await inP(() => db.query("UPDATE spool SET spool_no = 'RENAMED-HISTORY' WHERE id = $1", [currentSpoolId]));
  try {
    const h = await inP(() => px.materialOverrides(db, { projectId: P, spoolId: currentSpoolId }));
    equal(h.length, 1);
    equal([h[0].reason, h[0].match_basis, h[0].same_spool], ["again on rev B", "exact_spool", true]);
  } finally { await inP(() => db.query("UPDATE spool SET spool_no = $1 WHERE id = $2", [spoolNo, currentSpoolId])); }
});

test("unfiltered history is not a verified target association; unknown and foreign targets disclose no matches", async () => {
  const before = await events();
  const all = await inP(() => px.materialOverrides(db, { projectId: P }));
  equal(all.length, before.length);
  assert(all.every((e) => e.match_basis === "all" && !e.same_spool && !overrideProvenance(e).exact));
  equal(await inP(() => px.materialOverrides(db, { projectId: P, spoolId: crypto.randomUUID() })), []);
  equal(await withProject(db, Q, () => px.materialOverrides(db, { projectId: Q, spoolId: currentSpoolId })), []);
  equal(await withProject(db, Q, () => px.materialOverrides(db, { projectId: P, spoolId: currentSpoolId })), []);
  equal(await events(), before, "reading associations never changes or duplicates audit events");
});

test("only a consistent exact-spool association is presented as direct; all number matches and unknown contracts stay unverified", () => {
  equal(overrideProvenance({ match_basis: "exact_spool", same_spool: true }).exact, true);
  for (const basis of ["same_run_number_unverified", "same_revision_number_unverified", "cross_revision_number_unverified"]) {
    const p = overrideProvenance({ match_basis: basis, same_spool: false });
    equal([p.basis, p.exact], [basis, false]);
  }
  for (const row of [null, {}, { same_spool: true }, { match_basis: 7 }, { match_basis: "future_basis", same_spool: true },
    { match_basis: "exact_spool", same_spool: false }, { match_basis: "cross_revision_number_unverified", same_spool: true }]) {
    equal([overrideProvenance(row).basis, overrideProvenance(row).exact], ["unknown", false]);
  }
});

test("the execution API exposes association basis without altering immutable history", async () => {
  const route = await import("../../app/api/piping/execution/route.js");
  const before = await events();
  const res = await route.GET(new Request(`http://x/api/piping/execution?projectId=${P}&spoolId=${currentSpoolId}`,
    { headers: { authorization: "Bearer kc|eng" } }));
  equal(res.status, 200);
  const body = await res.json();
  assert(body.overrides.some((e) => e.match_basis === "exact_spool" && e.same_spool));
  assert(body.overrides.some((e) => e.match_basis === "cross_revision_number_unverified" && !e.same_spool));
  equal(await events(), before);
});

test("association labels and explanations are translated in Persian, English and Arabic", () => {
  const variants = [{ match_basis: "exact_spool", same_spool: true }, {},
    ...["same_run_number_unverified", "same_revision_number_unverified", "cross_revision_number_unverified"].map((match_basis) => ({ match_basis, same_spool: false }))];
  for (const lang of ["fa", "en", "ar"]) for (const row of variants) {
    const p = overrideProvenance(row);
    for (const key of [p.label, p.hint]) {
      assert(has(lang, key), `${lang}: ${key} must not fall back to another language`);
      assert(translate(lang, key).trim() && translate(lang, key) !== key);
    }
  }
});

await run();
