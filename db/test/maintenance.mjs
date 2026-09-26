#!/usr/bin/env node
/**
 * Handover to maintenance, phase 2: the maintenance plan (every interval
 * cited, a second person approves, an approved revision is fixed), spare
 * parts from the SPIR (interchangeability read off the rows, stock read off
 * the warehouse), and periodic calibration (due from the last PASSING
 * calibration, never guessed).
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  taskProblems, intervalText, addMonths, calibrationDue, interchangeability, spareCover,
} from "../../lib/cmms/maintenance.mjs";

// ── the rules ────────────────────────────────────────────────────────────

const TASK = { taskCode: "PM-01", title: "Lube oil change", strategy: "time_based", intervalValue: 3, intervalUnit: "month",
  source: "oem", sourceRef: "IOM §7.2" };

test("an interval is never without its source, and run-to-failure has none", async () => {
  equal(taskProblems(TASK), []);
  assert(taskProblems({ ...TASK, sourceRef: " " }).some((p) => /پیشنهاد نمی‌دهد/.test(p)), "no reference, no interval");
  assert(taskProblems({ ...TASK, source: "habit" }).length === 1);
  equal(taskProblems({ ...TASK, strategy: "run_to_failure", intervalValue: null, intervalUnit: null, source: "rcm", sourceRef: "RCM-12 row 4" }), []);
  equal(taskProblems({ ...TASK, strategy: "run_to_failure" }).length, 1, "a run-to-failure task with an interval is a contradiction");
  equal(taskProblems({ ...TASK, intervalValue: 0 }).length, 1);
  equal(taskProblems({ ...TASK, intervalUnit: "fortnight" }).length, 1);
  equal(taskProblems({ ...TASK, strategy: "condition_based", intervalValue: 1, intervalUnit: "month" }), [], "a monitoring route has its frequency");
  equal(taskProblems({ ...TASK, durationH: -1 }).length, 1);
  equal([intervalText(TASK), intervalText({ strategy: "time_based", intervalValue: 4000, intervalUnit: "run_hours" }),
    intervalText({ strategy: "run_to_failure" })], ["هر 3 ماه", "هر 4000 ساعت کارکرد", "تا خرابی"]);
});

test("calendar months: the end of a month stays at the end of the next", async () => {
  equal([addMonths("2026-01-31", 1), addMonths("2028-01-31", 1), addMonths("2026-11-15", 2), addMonths("2026-03-31", 12)],
    ["2026-02-28", "2028-02-29", "2027-01-15", "2027-03-31"]);
});

test("the next calibration is due from the last passing one; nothing is due without a plan or a baseline", async () => {
  const plan = { intervalMonths: 12 };
  const today = "2026-09-26";
  equal(calibrationDue({ plan: null, lastPass: "2025-01-01", today }).state, "no_plan");
  equal(calibrationDue({ plan, lastPass: null, today }).state, "no_baseline", "never calibrated is not 'due'");
  equal(calibrationDue({ plan, lastPass: "2026-01-01", lastFailed: true, today }).state, "failed");
  equal(calibrationDue({ plan, lastPass: "2025-09-25", today }), { state: "overdue", due: "2026-09-25", days: -1 });
  equal(calibrationDue({ plan, lastPass: "2025-10-26", today }), { state: "due_soon", due: "2026-10-26", days: 30 });
  equal(calibrationDue({ plan, lastPass: "2025-10-27", today }).state, "ok", "31 days out is beyond the window");
});

test("interchangeability is read off the rows: one part number on several tags", async () => {
  const g = interchangeability([
    { tagNo: "P-1A", partNo: "MS-220", manufacturer: "John Crane", description: "Mechanical seal" },
    { tagNo: "P-1B", partNo: "ms-220 ", manufacturer: "john crane", description: "Mechanical seal" },
    { tagNo: "P-1B", partNo: "BRG-6310", manufacturer: "SKF", description: "Bearing" },
    { tagNo: "K-1", partNo: "MS-220", manufacturer: "Other Co", description: "Different seal, same number" },
  ]);
  equal(g.map((x) => [x.partNo, x.tags]), [["MS-220", ["P-1A", "P-1B"]]], "the same number from another maker is another part");
});

test("stock covers an approved quantity, or says why it cannot be judged", async () => {
  equal(spareCover({ qtyApproved: null, itemLinked: true, onHand: 5 }).state, "not_decided");
  equal(spareCover({ qtyApproved: 2, itemLinked: false }).state, "not_stocked");
  equal(spareCover({ qtyApproved: 2, itemLinked: true, onHand: 2 }), { state: "covered", need: 2, have: 2 });
  equal(spareCover({ qtyApproved: 4, itemLinked: true, onHand: 1 }), { state: "short", need: 4, have: 1, short: 3 });
});

// ── against the database ─────────────────────────────────────────────────

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "mnt-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const inst = await import("../../lib/db/repos/instrumentation.mjs");
const mt = await import("../../lib/db/repos/maintenance.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice", displayName: "Alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob", displayName: "Bob" });
const proj = await projects.createProject(db, { code: "MNT", name: "M", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "MNT2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
let pumpA, pumpB, fdn, pm1, sealItem, pt, fv, psv;

await inP(async () => {
  const { rows: [unit] } = await db.query("INSERT INTO unit (project_id, code) VALUES ($1,'12') RETURNING id", [P]);
  const sub = await spine.upsertSubsystem(db, { projectId: P, code: "12-01", systemCode: "12", unitId: unit.id });
  pumpA = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203A", discipline: "equipment", kind: "rotating", subsystemId: sub.id });
  pumpB = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203B", discipline: "equipment", kind: "rotating", subsystemId: sub.id });
  fdn = await spine.upsertTag(db, { projectId: P, tagNo: "FDN-1", discipline: "civil", kind: "foundation", subsystemId: sub.id });
  await projects.updateProjectProfile(db, { projectId: P, patch: { cmms_plant_code: "OLF", floc_template: "{plant}-{unit}-{tag}",
    calibration_tolerance_pct: 0.5 } });
  const ins = async (tag, category, extra = "") => (await db.query(
    `INSERT INTO instrument (project_id, tag_no, category, range_lo, range_hi, range_unit) VALUES ($1,$2,$3,0,10,'bar') RETURNING *`,
    [P, tag, category])).rows[0];
  pt = await ins("PT-1201", "transmitter");
  fv = await ins("FV-1202", "valve");
  psv = await ins("PSV-1203", "safety_valve");
});

test("a task is a draft until someone other than its author approves it; then it is fixed", async () => {
  await inP(async () => {
    await throws(async () => mt.savePmTask(db, { projectId: P, tagId: fdn.id, ...TASK, userId: alice.id }), "تگ تجهیز");
    await throws(async () => mt.savePmTask(db, { projectId: P, tagId: pumpA.id, ...TASK, sourceRef: "", userId: alice.id }), "پیشنهاد نمی‌دهد");
    pm1 = await mt.savePmTask(db, { projectId: P, tagId: pumpA.id, ...TASK, taskCode: "pm-01", craft: "mechanical", durationH: 2, userId: alice.id });
    equal([pm1.task_code, pm1.revision, pm1.status], ["PM-01", 0, "draft"]);
    await throws(async () => mt.approvePmTask(db, { projectId: P, taskId: pm1.id, userId: alice.id }), "تهیه‌کنندهٔ تسک");
    const ok = await mt.approvePmTask(db, { projectId: P, taskId: pm1.id, userId: bob.id });
    equal(ok.status, "approved");
    await throws(async () => db.query("UPDATE pm_task SET interval_value = 6 WHERE id = $1", [pm1.id]), "new revision");
    await throws(async () => db.query("DELETE FROM pm_task WHERE id = $1", [pm1.id]), "kept");
    await throws(async () => db.query("UPDATE pm_task SET status = 'draft' WHERE id = $1", [pm1.id]), "cannot go");
    await throws(async () => mt.discardPmDraft(db, { projectId: P, taskId: pm1.id }), "فقط پیش‌نویس");
  });
});

test("the database refuses what the form would: a cited source, and no interval on run-to-failure", async () => {
  await inP(async () => {
    const ins = (vals) => db.query(
      `INSERT INTO pm_task (project_id, tag_id, task_code, title, strategy, interval_value, interval_unit, source, source_ref)
       VALUES ($1,$2,$3,'x',$4,$5,$6,'oem',$7)`, [P, pumpA.id, ...vals]);
    await throws(async () => ins(["X-1", "time_based", 3, "month", "  "]), "pm_source_cited");
    await throws(async () => ins(["X-2", "run_to_failure", 3, "month", "RCM"]), "pm_interval_fits");
    await throws(async () => ins(["X-3", "time_based", null, null, "IOM"]), "pm_interval_fits");
    const { rows: [d] } = await db.query(
      `INSERT INTO pm_task (project_id, tag_id, task_code, title, strategy, interval_value, interval_unit, source, source_ref, prepared_by)
       VALUES ($1,$2,'X-4','x','time_based',1,'year','oem','IOM',$3) RETURNING id`, [P, pumpA.id, alice.id]);
    await throws(async () => db.query("UPDATE pm_task SET approved_by = $2, approved_at = now(), status = 'approved' WHERE id = $1",
      [d.id, alice.id]), "pm_approver_not_preparer");
    await db.query("DELETE FROM pm_task WHERE id = $1", [d.id]);
  });
});

test("a change to an approved task is the next revision; the approved one stays in force until it is approved", async () => {
  await inP(async () => {
    const r1 = await mt.savePmTask(db, { projectId: P, tagId: pumpA.id, ...TASK, intervalValue: 6, sourceRef: "IOM §7.2 rev B", userId: alice.id });
    equal([r1.revision, r1.status], [1, "draft"]);
    const again = await mt.savePmTask(db, { projectId: P, tagId: pumpA.id, ...TASK, intervalValue: 4, sourceRef: "IOM §7.2 rev B", userId: alice.id });
    equal([again.id, Number(again.interval_value)], [r1.id, 4], "a draft is edited in place, not multiplied");
    let plan = await mt.pmPlan(db, { projectId: P });
    equal(plan.map((t) => [t.revision, t.status]), [[1, "draft"], [0, "approved"]]);
    equal((await mt.approvedTaskCounts(db, { projectId: P }))[pumpA.id], 1);
    await mt.approvePmTask(db, { projectId: P, taskId: r1.id, userId: bob.id });
    plan = await mt.pmPlan(db, { projectId: P });
    equal(plan.map((t) => [t.revision, t.status, t.intervalValue]), [[1, "approved", 4], [0, "superseded", 3]]);
    const d = await mt.savePmTask(db, { projectId: P, tagId: pumpA.id, ...TASK, intervalValue: 1, userId: alice.id });
    await mt.discardPmDraft(db, { projectId: P, taskId: d.id });
    equal((await mt.pmPlan(db, { projectId: P })).length, 2, "a discarded draft leaves the record as it was");
    await mt.savePmTask(db, { projectId: P, tagId: pumpB.id, taskCode: "PM-09", title: "Run to failure — standby coupling guard",
      strategy: "run_to_failure", intervalValue: 5, intervalUnit: "month", source: "rcm", sourceRef: "RCM-12 row 4", userId: alice.id })
      .then((t) => equal([t.interval_value, t.interval_unit], [null, null], "a run-to-failure decision carries no interval"));
  });
});

test("only approved tasks leave, keyed by functional location, and the export is logged as the plan", async () => {
  await inP(async () => {
    const e = await mt.exportMaintenance(db, { projectId: P, kind: "pm_plan", userId: alice.id });
    const lines = e.csv.slice(1).trim().split("\r\n");
    equal(lines.length, 2, "header and the one approved task — not the draft on P-1203B");
    assert(lines[1].startsWith('"OLF-12-P-1203A","P-1203A","PM-01","1"'), lines[1]);
    const { rows: [log] } = await db.query("SELECT kind, rows_total, sha256 FROM handover_export WHERE project_id = $1 ORDER BY at DESC LIMIT 1", [P]);
    equal([log.kind, log.rows_total, log.sha256], ["pm_plan", 1, e.sha256]);
    await throws(async () => mt.exportMaintenance(db, { projectId: P, kind: "everything" }), "شناخته نشد");
  });
});

test("spare parts: one line per part and class, changes kept, units never converted, stock read from the warehouse", async () => {
  await inP(async () => {
    sealItem = await wh.upsertItem(db, { projectId: P, code: "SEAL-MS220", description: "Mechanical seal MS-220", category: "other", uom: "EA" });
    const base = { projectId: P, partNo: "MS-220", manufacturer: "John Crane", description: "Mechanical seal", category: "commissioning",
      qtyInstalled: 1, qtyRecommended: 2, qtyApproved: 2, itemId: sealItem.id, spirRef: "SPIR-P-1203 r0", userId: alice.id };
    await throws(async () => mt.saveSpare(db, { ...base, tagId: fdn.id }), "تگ تجهیز");
    await throws(async () => mt.saveSpare(db, { ...base, tagId: pumpA.id, uom: "SET" }), "تبدیل بی‌صدا");
    await throws(async () => mt.saveSpare(db, { ...base, tagId: pumpA.id, category: "spare-ish" }), "دسته");
    await mt.saveSpare(db, { ...base, tagId: pumpA.id });
    await mt.saveSpare(db, { ...base, tagId: pumpA.id, qtyApproved: 3, userId: bob.id });
    await mt.saveSpare(db, { ...base, tagId: pumpB.id });
    await mt.saveSpare(db, { ...base, tagId: pumpB.id, partNo: "BRG-6310", manufacturer: "SKF", description: "Bearing", category: "operational",
      qtyApproved: 4, itemId: null });
    let b = await mt.sparesBoard(db, { projectId: P });
    equal(b.parts.length, 3, "saving the same part and class again updates it");
    const a = b.parts.find((p) => p.tagNo === "P-1203A");
    equal([a.qtyApproved, a.cover], [3, { state: "short", need: 3, have: 0, short: 3 }], "nothing received yet");
    equal(b.parts.find((p) => p.partNo === "BRG-6310").cover.state, "not_stocked");
    equal(b.interchangeable.map((g) => [g.partNo, g.tags]), [["MS-220", ["P-1203A", "P-1203B"]]]);
    // Two seals received and accepted. Both lines are commissioning spares for the same item: the two seals go to
    // P-1203A's line first (by tag) — they are not counted twice, once for each line that names them.
    const lot = await wh.receiveLot(db, { projectId: P, itemId: sealItem.id, receiptNo: "MRR-S1", receivedOn: "2026-09-01", qtyReceived: 2 });
    await wh.inspectLot(db, { projectId: P, lotId: lot.id, qtyAccepted: 2, inspectedOn: "2026-09-02" });
    // Five more arrived but are not inspected: quarantine is not stock.
    await wh.receiveLot(db, { projectId: P, itemId: sealItem.id, receiptNo: "MRR-S2", receivedOn: "2026-09-10", qtyReceived: 5 });
    b = await mt.sparesBoard(db, { projectId: P });
    equal(b.parts.filter((p) => p.partNo === "MS-220").map((p) => [p.tagNo, p.cover.state, p.cover.have]),
      [["P-1203A", "short", 2], ["P-1203B", "short", 0]]);
    // A spare valve accepted on its MIR but with its MTC still unreviewed: on hand, and not issuable — not cover.
    const valve = await wh.upsertItem(db, { projectId: P, code: "GV-2-800", description: "Gate valve 2in cl800", category: "valve", uom: "EA" });
    const vlot = await wh.receiveLot(db, { projectId: P, itemId: valve.id, receiptNo: "MRR-V1", receivedOn: "2026-09-12", heatNo: "HV-1", qtyReceived: 1 });
    await wh.inspectLot(db, { projectId: P, lotId: vlot.id, qtyAccepted: 1, inspectedOn: "2026-09-13" });
    await mt.saveSpare(db, { projectId: P, tagId: pumpB.id, partNo: "GV-2-800", description: "Suction isolation valve", category: "capital",
      qtyApproved: 1, itemId: valve.id, userId: alice.id });
    const v = (await mt.sparesBoard(db, { projectId: P })).parts.find((p) => p.partNo === "GV-2-800");
    equal([v.cover.state, v.cover.have], ["short", 0], "an unreviewed MTC holds a traceable part out of stock");
    await mt.removeSpare(db, { projectId: P, spareId: v.id, userId: alice.id });
    // Three more accepted: P-1203A's line is filled (3), P-1203B's gets the other two.
    const lot3 = await wh.receiveLot(db, { projectId: P, itemId: sealItem.id, receiptNo: "MRR-S3", receivedOn: "2026-09-15", qtyReceived: 3 });
    await wh.inspectLot(db, { projectId: P, lotId: lot3.id, qtyAccepted: 3, inspectedOn: "2026-09-16" });
    b = await mt.sparesBoard(db, { projectId: P });
    equal(b.parts.filter((p) => p.partNo === "MS-220").map((p) => [p.tagNo, p.cover.state, p.cover.have]),
      [["P-1203A", "covered", 3], ["P-1203B", "covered", 2]]);
    // A capital spare of the same seal on P-1203A comes after both commissioning lines, whatever its tag.
    const cap = await mt.saveSpare(db, { ...base, tagId: pumpA.id, category: "capital", qtyApproved: 1 });
    b = await mt.sparesBoard(db, { projectId: P });
    equal(b.parts.filter((p) => p.partNo === "MS-220").map((p) => [p.tagNo, p.category, p.cover.state, p.cover.have]),
      [["P-1203A", "capital", "short", 0], ["P-1203A", "commissioning", "covered", 3], ["P-1203B", "commissioning", "covered", 2]]);
    await mt.removeSpare(db, { projectId: P, spareId: cap.id, userId: alice.id });
    const { rows: log } = await db.query("SELECT action, snapshot->>'qtyApproved' AS q FROM spare_part_revision WHERE project_id = $1 AND tag_id = $2 AND snapshot->>'category' = 'commissioning' ORDER BY at", [P, pumpA.id]);
    equal(log.map((r) => [r.action, r.q]), [["saved", "2"], ["saved", "3"]]);
    await mt.removeSpare(db, { projectId: P, spareId: a.id, userId: bob.id });
    const { rows: [last] } = await db.query("SELECT action FROM spare_part_revision WHERE project_id = $1 AND tag_id = $2 ORDER BY at DESC LIMIT 1", [P, pumpA.id]);
    equal(last.action, "removed");
    await throws(async () => db.query("UPDATE spare_part_revision SET action = 'saved'"), "permission denied");
    const e = await mt.exportMaintenance(db, { projectId: P, kind: "spares", userId: alice.id });
    equal(e.rows, 2);
  });
});

test("calibration: due from the last passing one; a failed latest one is said; a valve's baseline is the technician's signature", async () => {
  await inP(async () => {
    await throws(async () => mt.setCalibrationPlan(db, { projectId: P, instrumentId: pt.id, intervalMonths: 12, source: "company", sourceRef: "" }), "پیشنهاد نمی‌دهد");
    await throws(async () => mt.setCalibrationPlan(db, { projectId: P, instrumentId: pt.id, intervalMonths: 0, source: "company", sourceRef: "X" }), "۱ تا ۱۲۰");
    await mt.setCalibrationPlan(db, { projectId: P, instrumentId: pt.id, intervalMonths: 12, source: "company", sourceRef: "ENG-STD-INST-04 §3", userId: alice.id });
    await mt.setCalibrationPlan(db, { projectId: P, instrumentId: fv.id, intervalMonths: 24, source: "oem", sourceRef: "Valve IOM §9", userId: alice.id });
    const good = "0:4 2.5:8 5:12 7.5:16 10:20", badPts = "0:4 2.5:8 5:12.5 7.5:16 10:20";
    await inst.recordCalibration(db, { projectId: P, instrumentId: pt.id, points: good, calibratedOn: "2025-09-01" });
    const today = "2026-09-26";
    let b = await mt.calibrationBoard(db, { projectId: P, today });
    const row = (tag) => b.find((r) => r.tagNo === tag);
    equal([row("PT-1201").lastPass, row("PT-1201").due.state, row("PT-1201").due.due], ["2025-09-01", "overdue", "2026-09-01"]);
    equal(row("FV-1202").due.state, "no_baseline", "a valve with no signed calibration has no due date");
    equal(row("PSV-1203").due.state, "no_plan");
    await inst.recordCalibration(db, { projectId: P, instrumentId: pt.id, points: badPts, calibratedOn: "2026-09-20" });
    await db.query(`INSERT INTO instrument_activity (project_id, instrument_id, code, status, done_at) VALUES ($1,$2,'calibrated','done','2026-02-01')`, [P, fv.id]);
    b = await mt.calibrationBoard(db, { projectId: P, today });
    equal([row("PT-1201").due.state, row("PT-1201").lastPass], ["failed", "2025-09-01"], "a failing calibration is not a baseline");
    equal([row("FV-1202").lastPass, row("FV-1202").due.due, row("FV-1202").due.state], ["2026-02-01", "2028-02-01", "ok"]);
    await inst.recordCalibration(db, { projectId: P, instrumentId: pt.id, points: good, calibratedOn: "2026-09-22" });
    b = await mt.calibrationBoard(db, { projectId: P, today });
    equal([row("PT-1201").due.state, row("PT-1201").due.due], ["ok", "2027-09-22"]);
    await mt.setCalibrationPlan(db, { projectId: P, instrumentId: pt.id, intervalMonths: 6, source: "statutory", sourceRef: "Custody transfer rule 12", userId: bob.id });
    const { rows: hist } = await db.query("SELECT snapshot->>'intervalMonths' AS m FROM calibration_plan_revision WHERE instrument_id = $1 ORDER BY at", [pt.id]);
    equal(hist.map((h) => h.m), ["12", "6"]);
  });
});

test("the plan, the spares and the calibration belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await mt.pmPlan(db, { projectId: other.id })).length, 0);
    equal((await mt.pmPlan(db, { projectId: P })).length, 0, "row level security, not the WHERE clause");
    equal((await mt.sparesBoard(db, { projectId: P })).parts.length, 0);
    await throws(async () => mt.approvePmTask(db, { projectId: other.id, taskId: pm1.id, userId: bob.id }), "not found");
    await throws(async () => mt.setCalibrationPlan(db, { projectId: other.id, instrumentId: pt.id, intervalMonths: 12, source: "company", sourceRef: "X" }), "not found");
  });
});

await run();
