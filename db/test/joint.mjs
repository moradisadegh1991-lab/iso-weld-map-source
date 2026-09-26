#!/usr/bin/env node
/**
 * Joint history: one weld's life across drawing revisions, read from the
 * records the platform already holds — and F-15: a superseded revision's
 * register no longer counts in the reports.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "joint-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const docs = await import("../../lib/db/repos/documents.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const exec = await import("../../lib/db/repos/execution.mjs");
const pe = await import("../../lib/db/repos/piping-execution.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const joint = await import("../../lib/db/repos/joint.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice", displayName: "Alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob", displayName: "Bob" });
const proj = await projects.createProject(db, { code: "JH", name: "J", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "JH2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
const clone = (x) => JSON.parse(JSON.stringify(x));

// Rev 1 inserts an elbow mid-route: the welds downstream renumber, and keep their identity.
const REV1 = clone(DEMO);
REV1.nodes.splice(2, 0, { id: "N2b", type: "elbow90", ref: "", E: 118948, N: 392000, EL: 97928 });
REV1.nodes[3].EL = 97928;
REV1.edges = [{ from: "N1", to: "N2", nps: 36 }, { from: "N2", to: "N2b", nps: 36 }, { from: "N2b", to: "N3", nps: 36 }, { from: "N3", to: "N4", nps: 36 }];
REV1.bom = REV1.bom.map((b) => (/Elbow 90/.test(b.description) ? { ...b, qty: 2 } : b));

let lineId, r0, r1, rev0, rev1, W, W2, W4, welder, lot;
await inP(async () => {
  ({ rows: [{ id: lineId }] } = await db.query("INSERT INTO line (project_id, line_no, piping_class) VALUES ($1,'10-P-001','A1') RETURNING id", [P]));
  const { document: d0 } = await docs.registerDocument(db, { projectId: P, docNo: "ISO-1", revision: "0", revisionDate: "2026-06-01",
    fileSha256: "a".repeat(64), storageUri: "local://a" });
  r0 = await runs.createRun(db, { projectId: P, documentId: d0.id, lineId, payload: DEMO });
  await runs.saveRegister(db, { projectId: P, runId: r0.id, documentId: d0.id, lineId, model: buildModel(DEMO, {}) });
  await runs.approveRun(db, { projectId: P, runId: r0.id, userId: alice.id });
  rev0 = await runs.getRegister(db, { projectId: P, runId: r0.id });
});

test("F-15: a superseded revision's register leaves the reports — each weld counts once", async () => {
  await inP(async () => {
    const { document: d1 } = await docs.registerDocument(db, { projectId: P, docNo: "ISO-1", revision: "1", revisionDate: "2026-08-01",
      fileSha256: "b".repeat(64), storageUri: "local://b" });
    await docs.supersedePrevious(db, { projectId: P, documentId: d1.id });
    r1 = await runs.createRun(db, { projectId: P, documentId: d1.id, lineId, payload: REV1 });
    await runs.saveRegister(db, { projectId: P, runId: r1.id, documentId: d1.id, lineId, model: buildModel(REV1, {}), carryFrom: rev0 });
    rev1 = await runs.getRegister(db, { projectId: P, runId: r1.id });
    const { rows: [c] } = await db.query(
      "SELECT count(*)::int AS n, count(DISTINCT weld_uid)::int AS u FROM reporting.fact_weld WHERE project_key = $1", [P]);
    equal([c.n, c.u], [rev1.length, rev1.length], "only Rev 1's register is current");
    const renumbered = rev1.filter((w) => { const o = rev0.find((x) => x.weld_uid === w.weld_uid); return o && o.weld_no !== w.weld_no && o.spool_no; });
    assert(renumbered.length >= 2, "the inserted elbow renumbers welds downstream");
    [W, W2] = renumbered;
    W4 = rev1.find((w) => w.weld_uid !== W.weld_uid && w.weld_uid !== W2.weld_uid && rev0.some((o) => o.weld_uid === w.weld_uid));
  });
});

test("search lists the current register once, by weld, line, spool or drawing", async () => {
  await inP(async () => {
    const all = await joint.searchJoints(db, { projectId: P });
    equal(all.length, rev1.length);
    equal(new Set(all.map((w) => w.weld_uid)).size, all.length, "no weld twice");
    assert(all.every((w) => w.revision === "1"));
    equal((await joint.searchJoints(db, { projectId: P, q: W.weld_no })).map((w) => w.weld_uid).includes(W.weld_uid), true);
    assert((await joint.searchJoints(db, { projectId: P, q: W.spool_no })).length >= 1);
    equal((await joint.searchJoints(db, { projectId: P, q: "10-P-001" })).length, rev1.length);
    equal((await joint.searchJoints(db, { projectId: P, q: "nothing-like-this" })).length, 0);
  });
});

test("the history follows one identity through a renumbering, with what changed", async () => {
  await inP(async () => {
    const h = await joint.jointHistory(db, { projectId: P, weldUid: W.weld_uid });
    equal(h.revisions.map((r) => [r.revision, r.weldNo, r.current]),
      [["0", rev0.find((o) => o.weld_uid === W.weld_uid).weld_no, false], ["1", W.weld_no, true]]);
    assert(h.revisions[1].changes.some((c) => c.field === "شمارهٔ جوش"), "the renumbering is named");
    equal([h.identity.weldNo, h.identity.revision, h.identity.current, h.identity.lineNo, h.identity.pipingClass],
      [W.weld_no, "1", true, "10-P-001", "A1"]);
    equal([h.execution, h.status.welded, h.ndt.length], [null, false, 0], "nothing recorded is nothing shown");
    equal(h.timeline.filter((e) => e.kind === "drawing").map((e) => e.on), ["2026-06-01", h.timeline.find((e) => /تأیید/.test(e.text)).on, "2026-08-01"].sort());
  });
});

test("welding, a rejected shot and its repair, material and fit-up are read in order", async () => {
  await inP(async () => {
    welder = await exec.upsertWelder(db, { projectId: P, stampNo: "W-07", name: "Reza", employer: "C-02" });
    await db.query(
      `INSERT INTO weld_execution (project_id, weld_uid, line_id, welder_id, process, position, welded_at, qualification_verdict)
       VALUES ($1,$2,$3,$4,'GTAW','6G','2026-08-10',$5)`,
      [P, W.weld_uid, lineId, welder.id, JSON.stringify({ ok: true, blocking: [], warnings: [{ message: "QW-322.1: continuity from payroll only" }] })]);
    await exec.recordNdt(db, { projectId: P, weldUid: W.weld_uid, method: "RT", result: "reject", defectType: "porosity", inspectedAt: "2026-08-12", reportNo: "RT-1" });
    await exec.recordNdt(db, { projectId: P, weldUid: W.weld_uid, method: "RT", result: "accept", inspectedAt: "2026-08-15", reportNo: "RT-2" });
    const spoolId = (await db.query("SELECT spool_id FROM weld WHERE extraction_run_id = $1 AND weld_uid = $2", [r1.id, W.weld_uid])).rows[0].spool_id;
    await pe.recordSpoolActivity(db, { projectId: P, spoolId, code: "fit_up", doneAt: "2026-08-09", refNo: "FU-9", userId: alice.id });
    const item = await wh.upsertItem(db, { projectId: P, code: "PIPE-36", description: "Pipe 36in", category: "pipe", uom: "m" });
    lot = await wh.receiveLot(db, { projectId: P, itemId: item.id, receiptNo: "MRR-1", receivedOn: "2026-07-20", heatNo: "H-9", mtcRef: "MTC-9", qtyReceived: 12 });
    await wh.inspectLot(db, { projectId: P, lotId: lot.id, qtyAccepted: 12, inspectedOn: "2026-07-21" });
    await wh.reviewMtc(db, { projectId: P, lotId: lot.id, mtcStatus: "accepted" });
    await wh.recordMovement(db, { projectId: P, lotId: lot.id, kind: "issue", qty: 6, movedOn: "2026-08-01", spoolId, refNo: "MIV-1" });

    const h = await joint.jointHistory(db, { projectId: P, weldUid: W.weld_uid });
    equal([h.execution.welder.stampNo, h.execution.process, h.execution.weldedOn], ["W-07", "GTAW", "2026-08-10"]);
    equal(h.methods, [{ method: "RT", shots: 2, repairs: 1, latest: "accept" }]);
    equal([h.status.accepted, h.status.repairs], [true, 1]);
    equal(h.material.map((m) => [m.heatNo, m.mtcStatus, m.qty]), [["H-9", "accepted", 6]]);
    const kinds = h.timeline.map((e) => e.kind);
    assert(kinds.indexOf("material") < kinds.indexOf("fitup") && kinds.indexOf("fitup") < kinds.indexOf("weld")
      && kinds.indexOf("weld") < kinds.lastIndexOf("ndt"), kinds.join(" "));
    const shots = h.timeline.filter((e) => e.kind === "ndt");
    equal(shots.map((e) => e.tone), ["bad", "ok"], "the reject, then the re-shot that passed");
    const days = h.timeline.filter((e) => e.on).map((e) => e.on);
    equal(days, [...days].sort(), "oldest first");
    equal(h.attention.map((a) => a.level), ["warn"], "only the warning the assignment carried");
    assert(/QW-322.1/.test(h.attention[0].text));
  });
});

test("what does not add up is said: a rejected shot never re-shot, a sample never shot, a weld with no fit-up", async () => {
  await inP(async () => {
    await db.query("INSERT INTO weld_execution (project_id, weld_uid, line_id, welder_id, welded_at) VALUES ($1,$2,$3,$4,'2026-08-11')",
      [P, W2.weld_uid, lineId, welder.id]);
    await exec.recordNdt(db, { projectId: P, weldUid: W2.weld_uid, method: "RT", result: "reject", inspectedAt: "2026-08-13" });
    await db.query("INSERT INTO ndt_selection (project_id, line_id, method, percent, seed, selected_uids) VALUES ($1,$2,'UT',10,'s1',$3)",
      [P, lineId, [W2.weld_uid]]);
    const h = await joint.jointHistory(db, { projectId: P, weldUid: W2.weld_uid });
    const text = h.attention.map((a) => a.text).join(" | ");
    assert(/RT: آخرین شات .*رد شده/.test(text), text);
    assert(/UT 10% انتخاب شده/.test(text), text);
    equal([h.status.accepted, h.selection[0].selected], [false, true]);
    const spoolOfW2 = (await db.query("SELECT spool_id FROM weld WHERE extraction_run_id = $1 AND weld_uid = $2", [r1.id, W2.weld_uid])).rows[0].spool_id;
    const spoolOfW = (await db.query("SELECT spool_id FROM weld WHERE extraction_run_id = $1 AND weld_uid = $2", [r1.id, W.weld_uid])).rows[0].spool_id;
    assert(spoolOfW2 === spoolOfW ? !/فیت‌آپ/.test(text) : /فیت‌آپ/.test(text), "fit-up is the spool's; said only when missing");
    assert(!joint.attention({ ...h, selection: [{ method: "UT", percent: 10, selected: false }] }).some((a) => /UT/.test(a.text)),
      "a weld the sample did not draw owes no UT");
  });
});

test("material from a heat whose MTC was later rejected is a recall on the weld", async () => {
  await inP(async () => {
    // Material that went to another spool is not this weld's.
    const mine = (await db.query("SELECT spool_id FROM weld WHERE extraction_run_id = $1 AND weld_uid = $2", [r1.id, W.weld_uid])).rows[0].spool_id;
    const { rows: [elsewhere] } = await db.query("SELECT id FROM spool WHERE extraction_run_id = $1 AND id <> $2 LIMIT 1", [r1.id, mine]);
    await wh.recordMovement(db, { projectId: P, lotId: lot.id, kind: "issue", qty: 2, movedOn: "2026-08-02", spoolId: elsewhere.id, refNo: "MIV-2" });
    await wh.reviewMtc(db, { projectId: P, lotId: lot.id, mtcStatus: "rejected" });
    const h = await joint.jointHistory(db, { projectId: P, weldUid: W.weld_uid });
    equal(h.material.map((m) => m.refNo), ["MIV-1"], "only what was issued to this weld's spool");
    const bad = h.attention.filter((a) => a.level === "bad").map((a) => a.text);
    assert(bad.some((t) => /H-9/.test(t) && /فراخوان/.test(t)), bad.join(" | "));
    equal(h.timeline.find((e) => e.kind === "material").tone, "bad");
  });
});

test("a weld made after its line's accepted pressure test is flagged; one made before is not", async () => {
  await inP(async () => {
    const { rows: [pk] } = await db.query("INSERT INTO test_package (project_id, pack_no, medium) VALUES ($1,'TP-1','hydrostatic') RETURNING id", [P]);
    await db.query("INSERT INTO test_package_line (project_id, package_id, line_id) VALUES ($1,$2,$3)", [P, pk.id, lineId]);
    await db.query(`INSERT INTO test_record (project_id, package_id, tested_on, medium, verdict, recorded_by, accepted_by, accepted_at)
                    VALUES ($1,$2,'2026-08-20','hydrostatic','pass',$3,$4,now())`, [P, pk.id, alice.id, bob.id]);
    const before = await joint.jointHistory(db, { projectId: P, weldUid: W.weld_uid });
    assert(!before.attention.some((a) => /تست فشار/.test(a.text)), "welded 08-10, tested 08-20");
    equal(before.testPack.records.map((t) => [t.on, t.verdict, t.accepted]), [["2026-08-20", "pass", true]]);
    await db.query("UPDATE weld_execution SET welded_at = '2026-08-25' WHERE project_id = $1 AND weld_uid = $2", [P, W.weld_uid]);
    const after = await joint.jointHistory(db, { projectId: P, weldUid: W.weld_uid });
    assert(after.attention.some((a) => a.level === "bad" && /بعد از تست فشار/.test(a.text) && /TP-1/.test(a.text)));
    await db.query("UPDATE weld_execution SET welded_at = '2026-08-10' WHERE project_id = $1 AND weld_uid = $2", [P, W.weld_uid]);
  });
});

test("a welded joint the current revision dropped is shown, and flagged for rework", async () => {
  await inP(async () => {
    await db.query("INSERT INTO weld_execution (project_id, weld_uid, line_id, welder_id, welded_at) VALUES ($1,$2,$3,$4,'2026-07-30')",
      [P, W4.weld_uid, lineId, welder.id]);
    await db.query("DELETE FROM weld WHERE extraction_run_id = $1 AND weld_uid = $2", [r1.id, W4.weld_uid]);
    const h = await joint.jointHistory(db, { projectId: P, weldUid: W4.weld_uid });
    equal([h.identity.current, h.identity.droppedIn, h.revisions.length], [false, { docNo: "ISO-1", revision: "1" }, 1]);
    assert(h.attention.some((a) => a.level === "bad" && /رویژن جاری/.test(a.text) && /Rev 1/.test(a.text)));
    assert(!(await joint.searchJoints(db, { projectId: P })).some((w) => w.weld_uid === W4.weld_uid), "not in the current register");
  });
});

test("the drawing's corrections come with it, labelled by revision", async () => {
  await inP(async () => {
    await db.query(`INSERT INTO extraction_edit (project_id, extraction_run_id, path, field, kind, before_value, after_value, reason, edited_by)
                    VALUES ($1,$2,'nodes[1].N','N','changed','385918','386268','misread digit',$3)`, [P, r0.id, alice.id]);
    const h = await joint.jointHistory(db, { projectId: P, weldUid: W.weld_uid });
    equal(h.edits.map((e) => [e.revision, e.path, e.before, e.after, e.by]), [["0", "nodes[1].N", 385918, 386268, "Alice"]]);
  });
});

test("an unknown weld is 404, and another project cannot read this one", async () => {
  await inP(async () => {
    const e = await throws(async () => joint.jointHistory(db, { projectId: P, weldUid: "no-such-uid" }), "no-such-uid");
    equal(e.status, 404);
  });
  await withProject(db, other.id, async () => {
    await throws(async () => joint.jointHistory(db, { projectId: other.id, weldUid: W.weld_uid }), "در هیچ رویژنی نیست");
    await throws(async () => joint.jointHistory(db, { projectId: P, weldUid: W.weld_uid }), "در هیچ رویژنی نیست");
    equal((await joint.searchJoints(db, { projectId: P })).length, 0, "row level security, not the WHERE clause");
  });
});

await run();
