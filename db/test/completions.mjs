#!/usr/bin/env node
/**
 * Completions: B31.3 test pressure only from stated inputs, no test while
 * the walkdown finds anything, a pass accepted by someone else, the spool's
 * test step answered by its package, and MC signed only with nothing open.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { testPressure, mixedPressures, packBlockers, judgeTest, mcReadiness } from "../../lib/completions/completions.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";

// ── the engine ───────────────────────────────────────────────────────────

test("hydrostatic test pressure is 1.5 · P · Rr, and there is none without Rr", async () => {
  equal(testPressure({ medium: "hydrostatic", designPressures: [20], stressRatio: 1 }).barg, 30);
  equal(testPressure({ medium: "hydrostatic", designPressures: [20, 15], stressRatio: 1.2 }).barg, 36, "the highest P governs");
  const none = testPressure({ medium: "hydrostatic", designPressures: [20], stressRatio: null });
  equal(none.barg, null);
  assert(/اعلام نشده/.test(none.reason), "says Rr was not stated, not that it is out of range");
  equal(testPressure({ medium: "hydrostatic", designPressures: [20], stressRatio: 7 }).barg, null, "Rr capped at 6.5");
  const noP = testPressure({ medium: "hydrostatic", designPressures: [20, null], stressRatio: 1 });
  equal(noP.barg, null, "a line without a design pressure");
  assert(/ثبت نشده/.test(noP.reason), "says which input is missing");
  equal(testPressure({ medium: "hydrostatic", designPressures: [0], stressRatio: 1 }).barg, null);
  equal(testPressure({ medium: "hydrostatic", designPressures: [], stressRatio: 1 }).barg, null);
});

test("pneumatic is 1.1 · P and needs no Rr", async () => {
  equal(testPressure({ medium: "pneumatic", designPressures: [10], stressRatio: null }).barg, 11);
  equal(testPressure({ medium: "steam", designPressures: [10] }).barg, null);
  equal([mixedPressures([20, 20]), mixedPressures([20, 15]), mixedPressures([20, null])], [false, true, false]);
});

test("the walkdown: every weld made and accepted, PWHT done, supports in — and no welds is unknown", async () => {
  const ok = { lineNo: "L1", welds: 4, welded: 4, examined: 4, pwhtRequired: 1, pwhtDone: 1, supports: 3, supportsInstalled: 3 };
  equal(packBlockers([ok]), []);
  equal(packBlockers([{ ...ok, welded: 3, examined: 2 }]).length, 2);
  equal(packBlockers([{ ...ok, pwhtDone: 0 }]).length, 1);
  equal(packBlockers([{ ...ok, supportsInstalled: 2 }]).length, 1);
  equal(packBlockers([{ ...ok, welds: 0, welded: 0, examined: 0 }]).length, 1);
  equal(packBlockers([]).length, 1);
});

test("a test passes on pressure, hold, gauge and no leak — each on its own", async () => {
  const good = { requiredBarg: 30, achievedBarg: 30.2, holdMin: 10, gaugeCert: "GC-114", leaks: false };
  equal(judgeTest(good), { pass: true, reasons: [] });
  equal(judgeTest({ ...good, achievedBarg: 29.9 }).pass, false);
  equal(judgeTest({ ...good, holdMin: 9.5 }).pass, false);
  equal(judgeTest({ ...good, gaugeCert: " " }).pass, false);
  equal(judgeTest({ ...good, leaks: true }).pass, false);
  equal(judgeTest({ ...good, leaks: null }).pass, false, "not recorded is not 'no leak'");
});

test("MC readiness names every kind of thing still open, and an empty subsystem is not complete", async () => {
  equal(mcReadiness({ tags: [{ tagNo: "P-1", ready: true, pct: 100 }] }).ready, true);
  const r = mcReadiness({ tags: [{ tagNo: "P-1", ready: false, pct: 60 }], lines: [{ lineNo: "L1" }, { lineNo: "L2", packNo: "TP-1", accepted: false }],
    cables: { items: 3, tested: 2 }, instruments: { items: 1, tested: 0 }, punchA: 2, ncrOpen: 1 });
  equal(r.blockers.map((b) => b.kind), ["tags", "no_pack", "untested", "cables", "instruments", "punch_a", "ncr"]);
  equal(mcReadiness({}).blockers.map((b) => b.kind), ["empty"]);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "cmp-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const pc = await import("../../lib/db/repos/piping-class.mjs");
const pex = await import("../../lib/db/repos/piping-execution.mjs");
const qa = await import("../../lib/db/repos/quality.mjs");
const cmp = await import("../../lib/db/repos/completions.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const proj = await projects.createProject(db, { code: "CMP", name: "CMP", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "CMP2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const TODAY = new Date().toISOString().slice(0, 10);
let sub, sub2, L1, L2, tp1, welds;

await withProject(db, P, async () => {
  sub = await spine.upsertSubsystem(db, { projectId: P, code: "60-01", systemCode: "60" });
  sub2 = await spine.upsertSubsystem(db, { projectId: P, code: "60-02", systemCode: "60" });
  const cls = await pc.upsertPipingClass(db, { projectId: P, code: "DX01", serviceCategory: "normal", designPressBarg: 20 });
  ({ rows: [L1] } = await db.query(
    "INSERT INTO line (project_id, line_no, piping_class_id) VALUES ($1,'10-CW-101',$2) RETURNING id, line_no", [P, cls.id]));
  ({ rows: [L2] } = await db.query("INSERT INTO line (project_id, line_no, piping_class) VALUES ($1,'10-CW-102','DX01') RETURNING id, line_no", [P]));
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
     VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`, [P, "e".repeat(64)]);
  const model = buildModel(DEMO, {});
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: L1.id, payload: DEMO, validationChecks: model.checks });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: L1.id, model });
  await spine.fileLine(db, { projectId: P, lineId: L1.id, subsystemId: sub.id });
  await spine.fileLine(db, { projectId: P, lineId: L2.id, subsystemId: sub.id });
  ({ rows: welds } = await db.query("SELECT weld_uid FROM weld WHERE project_id = $1 AND line_id = $2 ORDER BY weld_no", [P, L1.id]));
});

test("a package takes design pressure from the line's class, and has no test pressure without Rr", async () => {
  await withProject(db, P, async () => {
    tp1 = await cmp.upsertPackage(db, { projectId: P, packNo: "tp-60-001", subsystemId: sub.id, medium: "hydrostatic", userId: alice.id });
    equal(tp1.pack_no, "TP-60-001");
    let st = await cmp.addLines(db, { projectId: P, packageId: tp1.id, lineIds: [L1.id] });
    equal([st.lines[0].designBarg, st.pressure.barg], [20, null]);
    const tp2 = await cmp.upsertPackage(db, { projectId: P, packNo: "TP-60-002", medium: "pneumatic" });
    await throws(() => cmp.addLines(db, { projectId: P, packageId: tp2.id, lineIds: [L1.id] }), "INVALID_INPUT", "one line, one package");
    st = await cmp.addLines(db, { projectId: P, packageId: tp2.id, lineIds: [L2.id] });
    equal(st.lines[0].designBarg, 20, "class found by its code when the line holds only the code");
    await throws(() => cmp.upsertPackage(db, { projectId: P, packNo: "TP-X", medium: "hydrostatic", stressRatio: 8 }), "INVALID_INPUT");
    tp1 = await cmp.upsertPackage(db, { projectId: P, packNo: "TP-60-001", subsystemId: sub.id, medium: "hydrostatic", stressRatio: 1 });
    equal((await cmp.packageStatus(db, { projectId: P, packageId: tp1.id })).pressure.barg, 30);
  });
});

test("no test is recorded while the walkdown finds anything — a rejected weld included", async () => {
  await withProject(db, P, async () => {
    const rec = () => cmp.recordTest(db, { projectId: P, packageId: tp1.id, testedOn: TODAY, achievedBarg: 31, holdMin: 30,
      gaugeCert: "GC-1", leaks: false, userId: alice.id });
    let st = await cmp.packageStatus(db, { projectId: P, packageId: tp1.id });
    assert(st.blockers.length > 0 && st.state === "not_ready");
    await throws(rec, "INVALID_INPUT");
    for (const w of welds) {
      await db.query("INSERT INTO weld_execution (project_id, weld_uid, welded_at) VALUES ($1,$2,$3)", [P, w.weld_uid, TODAY]);
      await db.query("INSERT INTO ndt_record (project_id, weld_uid, method, result) VALUES ($1,$2,'RT',$3)",
        [P, w.weld_uid, w === welds[0] ? "reject" : "accept"]);
    }
    st = await cmp.packageStatus(db, { projectId: P, packageId: tp1.id });
    equal(st.blockers.map((b) => b.what), ["1 جوش بدون NDT پذیرفته‌شده"], "a rejected weld is examined, not accepted");
    await db.query("INSERT INTO ndt_record (project_id, weld_uid, method, result, repair_cycle) VALUES ($1,$2,'RT','accept',1)", [P, welds[0].weld_uid]);
    await pex.upsertSupport(db, { projectId: P, supportNo: "S-101", kind: "shoe", lineId: L1.id });
    st = await cmp.packageStatus(db, { projectId: P, packageId: tp1.id });
    equal(st.blockers.map((b) => b.what), ["1 ساپورت نصب نشده"]);
    const { rows: [s] } = await db.query("SELECT id FROM pipe_support WHERE support_no = 'S-101'");
    await pex.markSupport(db, { projectId: P, supportId: s.id, step: "installed", on: TODAY, userId: alice.id });
    equal((await cmp.packageStatus(db, { projectId: P, packageId: tp1.id })).state, "ready");
  });
});

let passRec;
test("the verdict is the engine's, a pass is accepted by someone else, and then the package is closed", async () => {
  await withProject(db, P, async () => {
    const f = await cmp.recordTest(db, { projectId: P, packageId: tp1.id, testedOn: TODAY, achievedBarg: 28, holdMin: 30,
      gaugeCert: "GC-1", leaks: false, witness: "TPI — Mr. K", userId: alice.id });
    equal([f.verdict, Number(f.required_barg)], ["fail", 30]);
    await throws(() => cmp.acceptTest(db, { projectId: P, recordId: f.id, userId: bob.id }), "INVALID_INPUT");
    passRec = await cmp.recordTest(db, { projectId: P, packageId: tp1.id, testedOn: TODAY, achievedBarg: 30.5, holdMin: 30,
      gaugeCert: "GC-1", leaks: "false", userId: alice.id });
    equal(passRec.verdict, "pass");
    await throws(() => cmp.acceptTest(db, { projectId: P, recordId: passRec.id, userId: alice.id }), "INVALID_INPUT");
    await throws(() => db.query("UPDATE test_record SET accepted_by = recorded_by WHERE id = $1", [passRec.id]), "test_acceptor_not_recorder");
    await throws(() => db.query("UPDATE test_record SET achieved_barg = 99 WHERE id = $1", [passRec.id]), "permission denied");
    await cmp.acceptTest(db, { projectId: P, recordId: passRec.id, userId: bob.id });
    const st = await cmp.packageStatus(db, { projectId: P, packageId: tp1.id });
    equal([st.state, st.accepted], ["accepted", true]);
    await throws(() => cmp.addLines(db, { projectId: P, packageId: tp1.id, lineIds: [L2.id] }), "INVALID_INPUT");
    await throws(() => cmp.upsertPackage(db, { projectId: P, packNo: "TP-60-001", medium: "pneumatic" }), "INVALID_INPUT");
    await throws(() => cmp.recordTest(db, { projectId: P, packageId: tp1.id, testedOn: TODAY, achievedBarg: 31, holdMin: 30,
      gaugeCert: "x", leaks: false }), "INVALID_INPUT");
    await throws(() => db.query("DELETE FROM test_record"), "permission denied");
  });
});

test("the spool's test step is the package's, here and in the SQL stage, and refuses a hand tick", async () => {
  await withProject(db, P, async () => {
    const { rows: spools } = await db.query("SELECT id FROM spool WHERE project_id = $1 AND line_id = $2", [P, L1.id]);
    assert(spools.length > 0, "the demo drawing has spools");
    for (const { id } of spools) {
      const s = await pex.spoolStatus(db, { projectId: P, spoolId: id });
      const t = s.steps.find((x) => x.code === "test");
      equal([t.status, t.derived], ["done", true]);
      const { rows: [row] } = await db.query("SELECT stage FROM reporting.spool_stage WHERE spool_key = $1", [id]);
      equal(row.stage, s.headline, "engine and SQL agree");
    }
    await throws(() => pex.recordSpoolActivity(db, { projectId: P, spoolId: spools[0].id, code: "test", doneAt: TODAY }), "INVALID_INPUT");
  });
});

test("MC is signed only with nothing open, accepted by someone else, and reports what reopened", async () => {
  await withProject(db, P, async () => {
    let r = await cmp.subsystemMc(db, { projectId: P, subsystemId: sub.id });
    equal(r.blockers.map((b) => b.kind), ["untested"], "10-CW-102 is in TP-60-002, not tested");
    const pA = await qa.raisePunch(db, { projectId: P, subsystemId: sub.id, category: "A", description: "Blind missing", raisedOn: TODAY, userId: alice.id });
    r = await cmp.subsystemMc(db, { projectId: P, subsystemId: sub.id });
    equal(r.blockers.map((b) => b.kind), ["untested", "punch_a"]);
    await throws(() => cmp.signMc(db, { projectId: P, subsystemId: sub.id, userId: alice.id }), "INVALID_INPUT");
    // 10-CW-102 belongs to the next subsystem; the blind goes in.
    await spine.fileLine(db, { projectId: P, lineId: L2.id, subsystemId: sub2.id });
    await qa.punchAction(db, { projectId: P, punchId: pA.id, action: "clear", note: "fitted", userId: bob.id });
    await qa.punchAction(db, { projectId: P, punchId: pA.id, action: "verify", userId: alice.id });
    r = await cmp.subsystemMc(db, { projectId: P, subsystemId: sub.id });
    equal([r.ready, r.lines.map((l) => l.line_no)], [true, ["10-CW-101"]]);
    const m = await cmp.signMc(db, { projectId: P, subsystemId: sub.id, userId: alice.id });
    equal(m.snapshot.lines.length, 1);
    await throws(() => cmp.signMc(db, { projectId: P, subsystemId: sub.id, userId: alice.id }), "INVALID_INPUT");
    await throws(() => cmp.acceptMc(db, { projectId: P, subsystemId: sub.id, userId: alice.id }), "INVALID_INPUT");
    await cmp.acceptMc(db, { projectId: P, subsystemId: sub.id, userId: bob.id });
    await throws(() => db.query("UPDATE mc_certificate SET snapshot = '{}'"), "permission denied");
    await qa.raiseNcr(db, { projectId: P, title: "Flange face damage", description: "x", severity: "minor", subsystemId: sub.id, raisedOn: TODAY });
    const board = await cmp.mcBoard(db, { projectId: P });
    const b1 = board.find((s) => s.code === "60-01");
    equal([!!b1.accepted_at, b1.reopened], [true, true], "signed, and something it certified has reopened");
    const b2 = board.find((s) => s.code === "60-02");
    equal(b2.blockers.map((b) => b.kind), ["untested"]);
  });
});

test("an empty subsystem is not complete", async () => {
  await withProject(db, P, async () => {
    const s3 = await spine.upsertSubsystem(db, { projectId: P, code: "60-03", systemCode: "60" });
    const r = await cmp.subsystemMc(db, { projectId: P, subsystemId: s3.id });
    equal(r.blockers.map((b) => b.kind), ["empty"]);
    await throws(() => cmp.signMc(db, { projectId: P, subsystemId: s3.id, userId: alice.id }), "INVALID_INPUT");
  });
});

test("completions belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await cmp.packageBoard(db, { projectId: other.id })).length, 0);
    equal((await db.query("SELECT count(*)::int AS n FROM test_record")).rows[0].n, 0);
  });
});

await run();
