#!/usr/bin/env node
/**
 * Inspection: an ITP is a controlled document, a request's state is read
 * from the results, a Hold is released only by the party that holds it, a
 * Witness is waived only by absence after the notice the project states,
 * and a step the project's ITP gates is not recorded until its inspection
 * is released.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  irState, noticeOk, resultProblems, resultParty, activityProblems, itpProblems, stepGate, gates,
} from "../../lib/inspection/itp.mjs";
import { CHAINS } from "../../lib/platform/precedence.mjs";
import { opProblems } from "../../lib/field/ops.mjs";

// ── the rules ────────────────────────────────────────────────────────────

const PRE_POUR = { id: "a", itpNo: "ITP-CIV-01", seq: 20, title: "Pre-pour", points: { contractor: "H", company: "H", tpi: "W" } };
const T0 = "2026-09-20T08:00:00Z", T48 = "2026-09-22T08:00:00Z";
const st = (results, extra = {}) => irState({ activity: PRE_POUR, results, raisedAt: T0, plannedAt: T48, noticeHours: 24, ...extra });
const ok = (party) => ({ party, outcome: "accepted" });

test("a Hold is released by its party accepting; a Witness by accepting, or by absence after proper notice", async () => {
  equal(st([]).state, "awaiting");
  equal(st([]).waitingOn, ["contractor", "company", "tpi"]);
  equal(st([ok("contractor"), ok("company")]).waitingOn, ["tpi"]);
  equal(st([ok("contractor"), ok("company"), ok("tpi")]).state, "released");
  equal(st([ok("contractor"), { party: "company", outcome: "accepted_comments" }, { party: "tpi", outcome: "not_attended" }]).state,
    "released", "the TPI was told 48 h ahead; 24 h is due");
  const absentHold = st([ok("contractor"), { party: "company", outcome: "not_attended" }, ok("tpi")]);
  equal(absentHold.state, "awaiting", "a Hold is not waived by absence");
  assert(/غیبت آزاد نمی‌شود/.test(absentHold.parties.find((p) => p.party === "company").why));
  const late = st([ok("contractor"), ok("company"), { party: "tpi", outcome: "not_attended" }], { plannedAt: "2026-09-21T07:59:00Z" });
  equal([late.notice, late.state], [false, "awaiting"], "23 h 59 min is short notice");
  const unknown = st([ok("contractor"), ok("company"), { party: "tpi", outcome: "not_attended" }], { noticeHours: null });
  equal([unknown.notice, unknown.state], [null, "awaiting"], "no stated notice: absence waives nothing");
  assert(/اعلام نشده/.test(unknown.parties.find((p) => p.party === "tpi").why));
  equal(st([ok("contractor"), { party: "company", outcome: "rejected" }]).state, "rejected");
  equal(st([ok("contractor"), ok("company"), ok("tpi")], { cancelled: true }).state, "cancelled");
  const review = { points: { contractor: "S", company: "R" } };
  equal([gates(review), irState({ activity: review, results: [] }).state, irState({ activity: review, results: [ok("company")] }).state],
    [false, "awaiting", "released"], "no Hold or Witness: released on any acceptance, and gates nothing");
});

test("notice is measured, and exactly the stated hours is enough", async () => {
  equal(noticeOk({ raisedAt: T0, plannedAt: "2026-09-21T08:00:00Z", noticeHours: 24 }), true);
  equal(noticeOk({ raisedAt: T0, plannedAt: "2026-09-21T07:59:59Z", noticeHours: 24 }), false);
  equal([noticeOk({ raisedAt: T0, plannedAt: T48, noticeHours: null }), noticeOk({ raisedAt: T0, plannedAt: T48 }),
    noticeOk({ raisedAt: "x", plannedAt: T48, noticeHours: 24 })], [null, null, null]);
});

test("a result is refused when it is not that party's to give, or not the moment to give it", async () => {
  const base = { activity: PRE_POUR, results: [], raisedAt: T0, plannedAt: T48, noticeHours: 24, raisedBy: "alice" };
  equal(resultProblems({ ...base, party: "company", outcome: "accepted", at: T48, signerId: "bob" }), []);
  equal(resultProblems({ ...base, party: "company", outcome: "accepted", at: T48, signerId: "alice" }).length, 1,
    "the requester does not sign for the company");
  equal(resultProblems({ ...base, activity: { points: { contractor: "H" } }, party: "tpi", outcome: "accepted", at: T48 }).length, 1,
    "a party with no point on the activity");
  equal(resultProblems({ ...base, results: [ok("company")], party: "company", outcome: "rejected", at: T48 }).length, 1, "twice");
  equal(resultProblems({ ...base, results: [{ party: "company", outcome: "rejected" }], party: "tpi", outcome: "accepted", at: T48 }).length, 1,
    "a rejected request is closed");
  equal(resultProblems({ ...base, party: "tpi", outcome: "not_attended", at: "2026-09-22T07:00:00Z" }).length, 1, "absent before the hour");
  equal(resultProblems({ ...base, party: "tpi", outcome: "not_attended", at: T48 }), [], "absent at the hour");
  equal(resultProblems({ ...base, party: "contractor", outcome: "not_attended", at: T48 }).length, 1);
  equal(resultProblems({ ...base, party: "company", outcome: "accepted", at: "2026-09-20T07:00:00Z", signerId: "bob" }).length, 1, "before the request");
  equal(resultProblems({ ...base, party: "company", outcome: "maybe", at: T48, signerId: "bob" }).length, 1);
  equal(resultProblems({ ...base, party: null, outcome: "accepted", at: T48 }).length, 1, "no party, no signature");
  equal(resultProblems({ ...base, cancelled: true, party: "company", outcome: "accepted", at: T48, signerId: "bob" }).length, 1);
  equal(resultParty({ signerParty: "company", outcome: "accepted" }), { party: "company" });
  equal(resultParty({ signerParty: "contractor", outcome: "not_attended", aboutParty: "tpi" }), { party: "tpi" });
  assert(resultParty({ signerParty: "company", outcome: "not_attended", aboutParty: "tpi" }).error, "absence is the contractor's statement");
  assert(resultParty({ signerParty: "contractor", outcome: "not_attended" }).error);
  assert(resultParty({ signerParty: "contractor", outcome: "not_attended", aboutParty: "contractor" }).error);
});

test("an ITP is checked before it is approved", async () => {
  const chain = CHAINS.foundation;
  equal(activityProblems({ seq: 10, title: "Rebar", stepCode: "rebar", points: { contractor: "H", company: "W" } }, chain), []);
  equal(activityProblems({ seq: 10, title: "Rebar", stepCode: "welding", points: { contractor: "H" } }, chain).length, 1, "not a foundation step");
  equal(activityProblems({ seq: 10, title: "Rebar", points: {} }).length, 1, "no party");
  equal(activityProblems({ seq: 10, title: "Rebar", points: { company: "X" } }).length, 2, "an unknown point, and so no party");
  equal(activityProblems({ seq: 10, title: "Rebar", points: { client: "H" } }).length, 2);
  equal(activityProblems({ seq: 0, title: " ", points: { company: "R" } }).length, 2);
  const acts = [{ seq: 10, title: "a", points: { company: "H" } }, { seq: 10, title: "b", points: { company: "W" } }];
  assert(itpProblems({ activities: acts }).some((p) => /تکراری/.test(p)));
  equal(itpProblems({ activities: [] }).length, 1);
  equal(itpProblems({ activities: [acts[0]], preparedBy: "u1" }, { approverId: "u1" }).length, 1, "the preparer does not approve");
  equal(itpProblems({ activities: [acts[0]], preparedBy: "u1" }, { approverId: "u2" }), []);
});

test("a signature taken offline is checked on the phone as the server will check it", async () => {
  const base = { opId: "0f8fad5b-d9cb-469f-a165-70867728950e", capturedAt: T0, kind: "ir_result" };
  equal(opProblems({ ...base, payload: { irId: "x", outcome: "accepted" } }), []);
  equal(opProblems({ ...base, payload: { irId: "x", outcome: "rejected" } }).length, 1, "a rejection says why");
  equal(opProblems({ ...base, payload: { irId: "x", outcome: "rejected", comments: "gap 4 mm" } }), []);
  equal(opProblems({ ...base, payload: { irId: "x", outcome: "not_attended" } }).length, 1, "who did not come");
  equal(opProblems({ ...base, payload: { irId: "x", outcome: "not_attended", aboutParty: "contractor" } }).length, 1);
  equal(opProblems({ ...base, payload: { irId: "x", outcome: "not_attended", aboutParty: "tpi" } }), []);
  equal(opProblems({ ...base, payload: { irId: "x", outcome: "maybe" } }).length, 1);
  equal(opProblems({ ...base, payload: { outcome: "accepted" } }).length, 1);
});

test("the step gate names every unreleased Hold or Witness, and why", async () => {
  const review = { id: "r", itpNo: "I", seq: 30, title: "Tickets", points: { company: "R" } };
  equal(stepGate([PRE_POUR, review], { a: "released" }), []);
  const lines = stepGate([PRE_POUR, review], {});
  equal(lines.length, 1, "a Review does not stop the work");
  assert(/ITP-CIV-01 ردیف 20/.test(lines[0]) && /H: کارفرما/.test(lines[0]) && /W: بازرس/.test(lines[0]) && /ثبت نشده/.test(lines[0]), lines[0]);
  assert(/رد شد/.test(stepGate([PRE_POUR], { a: "rejected" })[0]));
  assert(/منتظر/.test(stepGate([PRE_POUR], { a: "awaiting" })[0]));
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "insp-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const qa = await import("../../lib/db/repos/quality.mjs");
const elec = await import("../../lib/db/repos/electrical.mjs");
const insp = await import("../../lib/db/repos/inspection.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice", displayName: "Alice (contractor QC)" });
const bob = await projects.ensureUser(db, { subject: "kc|bob", displayName: "Bob (company)" });
const carol = await projects.ensureUser(db, { subject: "kc|carol", displayName: "Carol (TPI)" });
const dave = await projects.ensureUser(db, { subject: "kc|dave", displayName: "Dave (no party)" });
const proj = await projects.createProject(db, { code: "INS", name: "I", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "INS2", name: "O", ownerUserId: alice.id });
const P = proj.id;
for (const [u, role, party] of [[alice, "engineer", "contractor"], [bob, "qc", "company"], [carol, "qc", "tpi"], [dave, "engineer", null]]) {
  await projects.addMember(db, { projectId: P, userId: u.id, role });
  await withProject(db, P, () => projects.setInspectionParty(db, { projectId: P, userId: u.id, party }));
}
const M = async (u) => projects.membershipOf(db, { projectId: P, userId: u.id });
const TODAY = new Date().toISOString().slice(0, 10);
const HOUR = 3_600_000;
const inHours = (h, from = Date.now()) => new Date(from + h * HOUR);
let F1, F2, F3, F4, pump, itp, prePour, rebar, tickets;

await withProject(db, P, async () => {
  const sub = await spine.upsertSubsystem(db, { projectId: P, code: "12-01", systemCode: "12" });
  [F1, F2, F3, F4] = await Promise.all(["F-1", "F-2", "F-3", "F-4"].map((no) =>
    spine.upsertTag(db, { projectId: P, tagNo: no, discipline: "civil", kind: "foundation", subsystemId: sub.id })));
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-1", discipline: "equipment", kind: "rotating", subsystemId: sub.id });
});
const inP = (fn) => withProject(db, P, fn);

test("with no approved ITP a step records as before; a draft gates nothing", async () => {
  await inP(async () => {
    await acts.recordActivity(db, { projectId: P, tagId: F1.id, code: "pre_pour", doneAt: TODAY, userId: alice.id });
    itp = await insp.createItp(db, { projectId: P, itpNo: "ITP-CIV-01", revision: "A", title: "Foundations", scope: "foundation", userId: alice.id });
    rebar = await insp.saveActivity(db, { projectId: P, itpId: itp.id, seq: 10, title: "Rebar and formwork", stepCode: "rebar",
      reference: "ACI 318 §26.6", points: { contractor: "H", company: "W" } });
    prePour = await insp.saveActivity(db, { projectId: P, itpId: itp.id, seq: 20, title: "Pre-pour inspection", stepCode: "pre_pour",
      criteria: "cover, embedments, bolts per drawing", record: "ITR-C-02", points: { contractor: "H", company: "H", tpi: "W" } });
    tickets = await insp.saveActivity(db, { projectId: P, itpId: itp.id, seq: 30, title: "Delivery tickets", points: { company: "r" } });
    await throws(async () => insp.saveActivity(db, { projectId: P, itpId: itp.id, seq: 40, title: "Weld", stepCode: "shop_weld", points: { company: "H" } }),
      "زنجیرهٔ");
    await acts.recordActivity(db, { projectId: P, tagId: F2.id, code: "rebar", doneAt: TODAY, userId: alice.id });
  });
});

test("an ITP is approved by someone other than its preparer, and is then fixed", async () => {
  await inP(async () => {
    await throws(async () => insp.approveItp(db, { projectId: P, itpId: itp.id, userId: alice.id }), "تهیه‌کننده");
    itp = await insp.approveItp(db, { projectId: P, itpId: itp.id, userId: dave.id });
    equal(itp.status, "approved");
    await throws(async () => insp.saveActivity(db, { projectId: P, itpId: itp.id, seq: 50, title: "x", points: { company: "H" } }), "ثابت");
    await throws(async () => db.query("UPDATE itp_activity SET company = 'S' WHERE id = $1", [prePour.id]), "fixed");
    await throws(async () => db.query("INSERT INTO itp_activity (project_id, itp_id, seq, title, company) VALUES ($1,$2,99,'x','H')", [P, itp.id]), "fixed");
    await throws(async () => db.query("UPDATE itp SET title = 'Other' WHERE id = $1", [itp.id]), "new revision");
    await throws(async () => db.query("UPDATE itp SET status = 'draft' WHERE id = $1", [itp.id]), "cannot go");
    await throws(async () => db.query("UPDATE itp SET approved_by = prepared_by, status = 'draft' WHERE id = $1", [itp.id]));
    await throws(async () => insp.approveItp(db, { projectId: P, itpId: itp.id, userId: bob.id }), "فقط پیش‌نویس");
  });
});

test("a gated step is refused until its inspection is released — and says what it waits on", async () => {
  await inP(async () => {
    const e = await throws(async () => acts.recordActivity(db, { projectId: P, tagId: F2.id, code: "pre_pour", doneAt: TODAY, userId: alice.id }), "ITP-CIV-01 ردیف 20");
    equal([e.status, e.code], [409, "INSPECTION_HOLD"]);
    assert(/ثبت نشده/.test(e.message), e.message);
    await acts.recordActivity(db, { projectId: P, tagId: F2.id, code: "excavation", doneAt: TODAY, userId: alice.id });
    await acts.recordActivity(db, { projectId: P, tagId: F2.id, code: "pre_pour", status: "in_progress", userId: alice.id });
    // F-1's pre-pour was done before the ITP came into force: correcting its record is not completing it again.
    await acts.recordActivity(db, { projectId: P, tagId: F1.id, code: "pre_pour", doneAt: TODAY, refNo: "ITR-C-03/001", userId: alice.id });
  });
});

test("the contractor raises the request, for an item of the ITP's kind, in the future, once", async () => {
  await inP(async () => {
    const r = { projectId: P, activityId: prePour.id, itemKind: "tag", itemId: F2.id, plannedAt: inHours(48) };
    await throws(async () => insp.raiseIr(db, { ...r, membership: await M(dave), userId: dave.id }), "پیمانکار");
    await throws(async () => insp.raiseIr(db, { ...r, membership: await M(bob), userId: bob.id }), "پیمانکار");
    await throws(async () => insp.raiseIr(db, { ...r, itemId: pump.id, membership: await M(alice), userId: alice.id }), "نه «فونداسیون»");
    await throws(async () => insp.raiseIr(db, { ...r, plannedAt: inHours(-1), membership: await M(alice), userId: alice.id }), "گذشته");
    await throws(async () => insp.raiseIr(db, { ...r, itemKind: "spool", membership: await M(alice), userId: alice.id }), "not found");
    const ir = await insp.raiseIr(db, { ...r, location: "Unit 12", membership: await M(alice), userId: alice.id });
    equal(ir.ir_no, "IR-00001");
    await throws(async () => insp.raiseIr(db, { ...r, membership: await M(alice), userId: alice.id }), "منتظر نتیجه");
  });
});

test("released by the Hold parties accepting and the Witness absent after proper notice; then the step records", async () => {
  await inP(async () => {
    await projects.updateProjectProfile(db, { projectId: P, patch: { inspection_notice_hours: 24 } });
    const [ir] = await insp.requestsFor(db, { projectId: P, itemKind: "tag", itemId: F2.id });
    const at = new Date(ir.planned_at);
    await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted", membership: await M(alice), userId: alice.id, now: at });
    await throws(async () => insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "not_attended", aboutParty: "tpi",
      membership: await M(alice), userId: alice.id, now: inHours(-1, at.getTime()) }), "پیش از زمان");
    await throws(async () => insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "not_attended", aboutParty: "company",
      membership: await M(bob), userId: bob.id, now: at }), "پیمانکار ثبت می‌کند");
    let v = await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "not_attended", aboutParty: "tpi",
      membership: await M(alice), userId: alice.id, now: inHours(1, at.getTime()) });
    equal([v.state.state, v.state.waitingOn], ["awaiting", ["company"]]);
    await throws(async () => insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted", membership: await M(dave), userId: dave.id, now: at }),
      "عضویت پروژه");
    v = await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted_comments", comments: "cover 45 mm at pier 3, within tolerance",
      inspectorName: "B. Company", membership: await M(bob), userId: bob.id, now: inHours(2, at.getTime()) });
    equal(v.state.state, "released");
    await acts.recordActivity(db, { projectId: P, tagId: F2.id, code: "pre_pour", doneAt: TODAY, userId: alice.id });
    await throws(async () => insp.raiseIr(db, { projectId: P, activityId: prePour.id, itemKind: "tag", itemId: F2.id, plannedAt: inHours(30),
      membership: await M(alice), userId: alice.id }), "آزاد شده");
    await throws(async () => db.query("UPDATE inspection_result SET outcome = 'rejected'"), "permission denied");
    await throws(async () => db.query("DELETE FROM inspection_result"), "permission denied");
  });
});

test("with no stated notice, a Witness party's absence releases nothing", async () => {
  await inP(async () => {
    await projects.updateProjectProfile(db, { projectId: P, patch: { inspection_notice_hours: null } });
    const ir = await insp.raiseIr(db, { projectId: P, activityId: prePour.id, itemKind: "tag", itemId: F4.id, plannedAt: inHours(1),
      membership: await M(alice), userId: alice.id });
    const at = inHours(2);
    await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted", membership: await M(alice), userId: alice.id, now: at });
    await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted", membership: await M(bob), userId: bob.id, now: at });
    const v = await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "not_attended", aboutParty: "tpi",
      membership: await M(alice), userId: alice.id, now: at });
    equal([v.state.state, v.state.notice], ["awaiting", null]);
    await throws(async () => acts.recordActivity(db, { projectId: P, tagId: F4.id, code: "pre_pour", doneAt: TODAY, userId: alice.id }), "منتظر نتیجه");
    await projects.updateProjectProfile(db, { projectId: P, patch: { inspection_notice_hours: 1 } });
    await acts.recordActivity(db, { projectId: P, tagId: F4.id, code: "pre_pour", doneAt: TODAY, userId: alice.id });
  });
});

test("a rejection says why, closes the request, asks for a re-inspection, and can raise its NCR", async () => {
  await inP(async () => {
    const ir = await insp.raiseIr(db, { projectId: P, activityId: prePour.id, itemKind: "tag", itemId: F3.id, plannedAt: inHours(30),
      membership: await M(alice), userId: alice.id });
    const at = inHours(31);
    await throws(async () => insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "rejected", membership: await M(bob), userId: bob.id, now: at }), "دلیل");
    const v = await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "rejected", comments: "anchor bolt 2 off by 12 mm",
      membership: await M(bob), userId: bob.id, now: at });
    equal(v.state.state, "rejected");
    await throws(async () => insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted", membership: await M(carol), userId: carol.id, now: at }), "بسته");
    await throws(async () => acts.recordActivity(db, { projectId: P, tagId: F3.id, code: "pre_pour", doneAt: TODAY, userId: alice.id }), "رد شد");
    const r = { projectId: P, activityId: prePour.id, itemKind: "tag", itemId: F3.id, plannedAt: inHours(50), membership: await M(alice), userId: alice.id };
    await throws(async () => insp.raiseIr(db, r), "بازرسی دوباره");
    await throws(async () => insp.raiseIr(db, { ...r, reinspectionOf: F1.id }), "بازرسی دوباره فقط");
    const again = await insp.raiseIr(db, { ...r, reinspectionOf: ir.id });
    equal(again.reinspection_of, ir.id);
    const ncr = await insp.ncrFromIr(db, { projectId: P, irId: ir.id, severity: "minor", userId: alice.id, raiseNcr: qa.raiseNcr });
    equal([ncr.source, ncr.tag_id], ["inspection", F3.id]);
    assert(ncr.description.includes("anchor bolt 2") && ncr.description.includes(ir.ir_no), ncr.description);
    await throws(async () => insp.ncrFromIr(db, { projectId: P, irId: ir.id, severity: "minor", userId: alice.id, raiseNcr: qa.raiseNcr }), "قبلاً");
    await throws(async () => insp.ncrFromIr(db, { projectId: P, irId: again.id, severity: "minor", userId: alice.id, raiseNcr: qa.raiseNcr }), "رد شده");
  });
});

test("the requester does not sign for the company, even when they hold its party", async () => {
  await inP(async () => {
    const [ir] = (await insp.requestsFor(db, { projectId: P, itemKind: "tag", itemId: F3.id })).filter((x) => x.state.state === "awaiting");
    await projects.setInspectionParty(db, { projectId: P, userId: alice.id, party: "company" });
    await throws(async () => insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted", membership: await M(alice), userId: alice.id,
      now: new Date(ir.planned_at) }), "درخواست‌دهنده");
    await projects.setInspectionParty(db, { projectId: P, userId: alice.id, party: "contractor" });
    await throws(async () => projects.setInspectionParty(db, { projectId: P, userId: alice.id, party: "client" }), "شناخته نشد");
  });
});

test("a request is cancelled with a reason while undecided, and then no longer counts", async () => {
  await inP(async () => {
    const [ir] = (await insp.requestsFor(db, { projectId: P, itemKind: "tag", itemId: F3.id })).filter((x) => x.state.state === "awaiting");
    await throws(async () => insp.cancelIr(db, { projectId: P, irId: ir.id, reason: " ", userId: alice.id }), "دلیل");
    const v = await insp.cancelIr(db, { projectId: P, irId: ir.id, reason: "pour postponed", userId: alice.id });
    equal(v.state.state, "cancelled");
    await throws(async () => insp.cancelIr(db, { projectId: P, irId: ir.id, reason: "again", userId: alice.id }), "فقط");
    const released = (await insp.requestsFor(db, { projectId: P, itemKind: "tag", itemId: F2.id }))[0];
    await throws(async () => insp.cancelIr(db, { projectId: P, irId: released.id, reason: "x", userId: alice.id }), "فقط");
    const e = await throws(async () => acts.recordActivity(db, { projectId: P, tagId: F3.id, code: "pre_pour", doneAt: TODAY, userId: alice.id }));
    assert(/رد شد/.test(e.message), "the rejection before the cancelled re-inspection still stands: " + e.message);
  });
});

test("a new revision starts from the last, supersedes it on approval, and inspections done under it still count", async () => {
  await inP(async () => {
    await throws(async () => insp.createItp(db, { projectId: P, itpNo: "ITP-CIV-01", revision: "B", scope: "cable", userId: alice.id }), "عوض نمی‌شود");
    const b = await insp.createItp(db, { projectId: P, itpNo: "ITP-CIV-01", revision: "B", scope: "foundation", userId: alice.id });
    await throws(async () => insp.createItp(db, { projectId: P, itpNo: "ITP-CIV-01", revision: "C", scope: "foundation", userId: alice.id }), "پیش‌نویس");
    const list = await insp.listItps(db, { projectId: P });
    equal(list.find((x) => x.id === b.id).activities.map((a) => a.seq), [10, 20, 30], "copied from A");
    await insp.approveItp(db, { projectId: P, itpId: b.id, userId: dave.id });
    const after = await insp.listItps(db, { projectId: P });
    equal(after.filter((x) => x.itp_no === "ITP-CIV-01").map((x) => [x.revision, x.status]), [["B", "approved"], ["A", "superseded"]]);
    await throws(async () => insp.raiseIr(db, { projectId: P, activityId: prePour.id, itemKind: "tag", itemId: F1.id, plannedAt: inHours(30),
      membership: await M(alice), userId: alice.id }), "در حال اجرا نیست");
    const f2 = await insp.itemInspections(db, { projectId: P, itemKind: "tag", itemId: F2.id });
    const row20 = f2.activities.find((a) => a.seq === 20);
    equal([row20.revision, row20.latest.state.state, row20.latest.revision], ["B", "released", "A"], "released under A, still released under B");
    equal(f2.activities.find((a) => a.seq === 30).gates, false);
    equal(f2.activities.find((a) => a.seq === 10).stepDone, true, "rebar was recorded before the ITP");
    equal(f2.activities.find((a) => a.seq === 20).stepDone, true, "pre-pour, once released and recorded");
    await acts.recordActivity(db, { projectId: P, tagId: F2.id, code: "pre_pour", doneAt: TODAY, userId: alice.id });
  });
});

test("the gate holds on every chain the project writes an ITP for — a cable's termination too", async () => {
  await inP(async () => {
    await elec.importCableSchedule(db, { projectId: P, text: "Cable No,From,To,Cable Type,Voltage,Length (m)\nEC-1,MCC-12,P-1,3Cx35 XLPE/SWA,0.6/1kV,85" });
    const { rows: [c] } = await db.query("SELECT id FROM cable WHERE cable_no = 'EC-1'");
    const e1 = await insp.createItp(db, { projectId: P, itpNo: "ITP-ELE-01", revision: "0", title: "Cables", scope: "cable", userId: alice.id });
    await insp.saveActivity(db, { projectId: P, itpId: e1.id, seq: 10, title: "Termination check", stepCode: "terminated", points: { contractor: "H", company: "W" } });
    await insp.approveItp(db, { projectId: P, itpId: e1.id, userId: dave.id });
    await elec.recordCableActivity(db, { projectId: P, cableId: c.id, code: "pulled", doneAt: TODAY, userId: alice.id });
    await throws(async () => elec.recordCableActivity(db, { projectId: P, cableId: c.id, code: "terminated", doneAt: TODAY, userId: alice.id }), "ITP-ELE-01");
    const items = await insp.itemsForScope(db, { projectId: P, scope: "cable" });
    equal(items.map((i) => [i.label, i.kind]), [["EC-1", "cable"]]);
    equal((await insp.itemsForScope(db, { projectId: P, scope: "foundation" })).length, 4, "only foundations, not the pump");
  });
});

test("the board lists requests by planned date with their state; nothing crosses projects", async () => {
  await inP(async () => {
    const all = await insp.irBoard(db, { projectId: P });
    assert(all.length >= 4 && all.every((r) => r.itemLabel && r.itemLabel !== "?"), JSON.stringify(all.map((r) => r.itemLabel)));
    equal((await insp.irBoard(db, { projectId: P, state: "released" })).map((r) => r.itemLabel).sort(), ["F-2", "F-4"]);
    equal((await insp.irBoard(db, { projectId: P, from: inHours(40).toISOString(), to: inHours(60).toISOString() })).map((r) => r.itemLabel),
      ["F-3", "F-2"], "latest planned first");
    equal((await insp.irBoard(db, { projectId: P, from: inHours(49).toISOString(), to: inHours(60).toISOString() })).map((r) => r.itemLabel), ["F-3"]);
  });
  await withProject(db, other.id, async () => {
    equal((await db.query("SELECT count(*)::int AS n FROM inspection_request")).rows[0].n, 0);
    equal((await insp.listItps(db, { projectId: other.id })).length, 0);
    await throws(async () => insp.raiseIr(db, { projectId: other.id, activityId: prePour.id, itemKind: "tag", itemId: F1.id, plannedAt: inHours(5),
      membership: { inspection_party: "contractor" }, userId: alice.id }), "not found");
  });
});

test("an inspector signs on site with no network: the queued signature is judged like one given at a desk", async () => {
  const fld = await import("../../lib/db/repos/field.mjs");
  const uuid = () => globalThis.crypto.randomUUID();
  const { rows: [c] } = await inP(() => db.query("SELECT id FROM cable WHERE cable_no = 'EC-1'"));
  const { rows: [act] } = await inP(() => db.query("SELECT a.id FROM itp_activity a JOIN itp i ON i.id = a.itp_id WHERE i.itp_no = 'ITP-ELE-01'"));
  const ir = await inP(async () => insp.raiseIr(db, { projectId: P, activityId: act.id, itemKind: "cable", itemId: c.id, plannedAt: inHours(0.5),
    membership: await M(alice), userId: alice.id }));
  // A static-equipment ITP holding grout: a pump's grout is not a vessel's.
  await inP(async () => {
    const m = await insp.createItp(db, { projectId: P, itpNo: "ITP-MEC-01", revision: "0", title: "Static", scope: "static", userId: alice.id });
    await insp.saveActivity(db, { projectId: P, itpId: m.id, seq: 10, title: "Grout", stepCode: "grout", points: { company: "H" } });
    await insp.approveItp(db, { projectId: P, itpId: m.id, userId: dave.id });
  });
  const pack = await inP(() => fld.fieldPack(db, { projectId: P }));
  equal(pack.inspections.filter((x) => x.id === ir.id).map((x) => [x.itemLabel, x.parties.map((p) => p.point).join("")]), [["EC-1", "HW"]]);
  const cableSteps = pack.cables.find((x) => x.no === "EC-1").steps;
  equal(cableSteps.find((x) => x.code === "terminated").hold, { itpNo: "ITP-ELE-01", seq: 10, title: "Termination check", irNo: ir.ir_no, state: "awaiting" },
    "the phone is told what holds the step, instead of offering a button the server will refuse");
  equal(cableSteps.find((x) => x.code === "pulled").hold, null, "a step done carries no hold");
  equal(pack.tags.find((x) => x.no === "F-3").steps.find((x) => x.code === "pre_pour").hold.state, "rejected",
    "after a rejection and a cancelled re-inspection, the phone says what the server's gate says");
  equal(pack.tags.find((x) => x.no === "F-1").steps.find((x) => x.code === "pre_pour").hold, null, "done before the ITP: nothing holds it");
  equal(pack.tags.find((x) => x.no === "P-1").steps.find((x) => x.code === "grout").hold, null, "a rotating machine is not held by the static ITP");
  equal(pack.tags.find((x) => x.no === "F-3").steps.find((x) => x.code === "rebar").hold?.state, null);
  const elsewhere = await inP(() => spine.upsertSubsystem(db, { projectId: P, code: "31-01", systemCode: "31" }));
  equal((await inP(() => fld.fieldPack(db, { projectId: P, subsystemId: elsewhere.id }))).inspections.length, 0,
    "a subsystem's pack carries its own inspections only");
  const op = (payload, minutes) => ({ opId: uuid(), kind: "ir_result", projectId: P, payload,
    capturedAt: new Date(Date.now() + minutes * 60_000).toISOString() });
  const early = op({ irId: ir.id, outcome: "not_attended", aboutParty: "company" }, 1);
  const accept = op({ irId: ir.id, outcome: "accepted", inspectorName: "A. QC" }, 2);
  const bad = op({ irId: ir.id, outcome: "rejected" }, 3);
  let r = await fld.applyOps(db, { projectId: P, userId: alice.id, membership: await M(alice), ops: [early, accept, bad] });
  equal(r.map((x) => x.status), ["rejected", "applied", "rejected"]);
  assert(/پیش از زمان/.test(r[0].error) && /دلیل/.test(r[2].error), JSON.stringify(r));
  const viewer = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: { role: "viewer", inspection_party: "company" },
    ops: [op({ irId: ir.id, outcome: "accepted" }, 4)] });
  assert(/اجازه/.test(viewer[0].error));
  const later = new Date(Date.now() + 40 * 60_000).toISOString();
  const co = { opId: uuid(), kind: "ir_result", projectId: P, payload: { irId: ir.id, outcome: "accepted_comments", comments: "glands OK" }, capturedAt: later };
  r = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: await M(bob), ops: [co] });
  equal([r[0].status, r[0].result.party, r[0].result.state], ["applied", "company", "released"]);
  const after = await inP(() => fld.fieldPack(db, { projectId: P }));
  equal(after.cables.find((x) => x.no === "EC-1").steps.find((x) => x.code === "terminated").hold, null, "released: nothing holds it");
  const { rows: [sig] } = await inP(() => db.query("SELECT recorded_at FROM inspection_result WHERE ir_id = $1 AND party = 'company'", [ir.id]));
  assert(sig.recorded_at.getTime() <= Date.now(), "a phone clock ahead of the server does not sign in the future");
  const again = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: await M(bob), ops: [co] });
  equal([again[0].duplicate, again[0].status], [true, "applied"], "a repeated sync signs once");
  await inP(() => elec.recordCableActivity(db, { projectId: P, cableId: c.id, code: "terminated", doneAt: TODAY, userId: alice.id }));
});

await run();
