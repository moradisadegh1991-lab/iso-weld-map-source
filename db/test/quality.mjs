#!/usr/bin/env node
/**
 * Punch and NCR: the one who did the work does not accept it, a change of
 * category is never silent, a concession is an engineering signature, an
 * NCR does not close without a cause, and escalation waits for a stated
 * period.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  punchProblems, punchState, punchBlocks, ncrProblems, ncrAfter, ncrEscalation, ncrBlocks,
} from "../../lib/quality/quality.mjs";

// ── the engine ───────────────────────────────────────────────────────────

test("punch: clear needs a note, verify is by someone else, reject needs a reason", async () => {
  equal(punchProblems({ status: "open" }, "clear", { note: "fixed" }), []);
  equal(punchProblems({ status: "open" }, "clear", { note: " " }).length, 1);
  equal(punchProblems({ status: "cleared", clearedBy: "u1" }, "verify", { actorId: "u1" }).length, 1);
  equal(punchProblems({ status: "cleared", clearedBy: "u1" }, "verify", { actorId: "u2" }), []);
  equal(punchProblems({ status: "open" }, "verify", { actorId: "u2" }).length, 1, "nothing to verify yet");
  equal(punchProblems({ status: "cleared" }, "reject", {}).length, 1);
  equal(punchProblems({ status: "closed" }, "recategorise", { note: "x" }).length, 1);
  equal(punchProblems({ status: "open" }, "recategorise", {}).length, 1);
});

test("punch: overdue past its date; what a list blocks counts anything not closed", async () => {
  equal(punchState({ status: "open", dueOn: "2026-09-01" }, "2026-09-02"), "overdue");
  equal(punchState({ status: "open", dueOn: "2026-09-02" }, "2026-09-02"), "open");
  equal(punchState({ status: "cleared", dueOn: "2026-01-01" }, "2026-09-02"), "cleared");
  equal(punchBlocks([{ category: "A", status: "cleared" }, { category: "A", status: "closed" },
    { category: "B", status: "open" }, { category: "C", status: "open" }]), { mc: 1, rfsu: 2, carried: 1 });
});

test("NCR: the path, and every guard on it", async () => {
  const n = { status: "open" };
  equal(ncrProblems(n, "propose", { disposition: "rework", dispositionNote: "cut out and re-weld" }), []);
  equal(ncrProblems(n, "propose", { disposition: "ignore", dispositionNote: "x" }).length, 1);
  equal(ncrProblems(n, "approve", {}).length, 1, "out of order");
  const p = { status: "proposed", proposedBy: "u1", disposition: "use_as_is" };
  equal(ncrProblems(p, "approve", { actorId: "u1", actorIsEngineer: true }).length, 1, "no self-approval");
  equal(ncrProblems(p, "approve", { actorId: "u2", actorIsEngineer: false }).length, 1, "a concession is an engineering signature");
  equal(ncrProblems(p, "approve", { actorId: "u2", actorIsEngineer: true }), []);
  equal(ncrProblems({ ...p, disposition: "rework" }, "approve", { actorId: "u2" }), [], "rework restores the drawing");
  const i = { status: "implemented", implementedBy: "u3" };
  equal(ncrProblems(i, "close", { actorId: "u4" }).length, 2, "no root cause, no corrective action");
  equal(ncrProblems({ ...i, rootCause: "wrong filler", correctiveAction: "filler control at stores" }, "close", { actorId: "u3" }).length,
    1, "the implementer does not close");
  equal(ncrProblems(i, "close", { actorId: "u4", rootCause: "a", correctiveAction: "b" }), []);
  equal([ncrAfter("propose"), ncrAfter("rejectDisposition"), ncrAfter("close"), ncrAfter("x")],
    ["proposed", "open", "closed", null]);
});

test("NCR escalation: on time, overdue, and past the stated period — never a period invented", async () => {
  const n = { status: "open", responseDue: "2026-09-10" };
  equal(ncrEscalation(n, "2026-09-10", 14), { level: 0, daysOverdue: 0, capped: false });
  equal(ncrEscalation(n, "2026-09-20", 14), { level: 1, daysOverdue: 10, capped: false });
  equal(ncrEscalation(n, "2026-09-24", 14).level, 1, "exactly the period is not yet past it");
  equal(ncrEscalation(n, "2026-09-25", 14), { level: 2, daysOverdue: 15, capped: false });
  equal(ncrEscalation(n, "2026-12-25", null), { level: 1, daysOverdue: 106, capped: true });
  equal(ncrEscalation({ ...n, status: "closed" }, "2026-12-25", 14).level, 0);
  equal(ncrBlocks([{ status: "closed" }, { status: "implemented" }]), 1);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "qa-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const qa = await import("../../lib/db/repos/quality.mjs");
const { missingInformation } = await import("../../lib/db/repos/assumptions.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const carol = await projects.ensureUser(db, { subject: "kc|carol" });
const proj = await projects.createProject(db, { code: "Q1", name: "Q1", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "Q2", name: "Q2", ownerUserId: alice.id });
const P = proj.id;
const TODAY = new Date().toISOString().slice(0, 10);
const shift = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let s21, s22, pump, loose, pA;

await withProject(db, P, async () => {
  s21 = await spine.upsertSubsystem(db, { projectId: P, code: "21-01", systemCode: "21" });
  s22 = await spine.upsertSubsystem(db, { projectId: P, code: "22-01", systemCode: "22" });
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-2101A", discipline: "equipment", subsystemId: s21.id });
  loose = await spine.upsertTag(db, { projectId: P, tagNo: "E-9999", discipline: "equipment" });
});

test("a punch item takes its subsystem from its tag, and a tag filed nowhere cannot carry one", async () => {
  await withProject(db, P, async () => {
    pA = await qa.raisePunch(db, { projectId: P, tagId: pump.id, category: "A", description: "Coupling guard missing",
      raisedOn: shift(-10), dueOn: shift(-2), userId: alice.id });
    equal([pA.subsystem_id, pA.punch_no], [s21.id, "21-01-P001"]);
    const e = await throws(() => qa.raisePunch(db, { projectId: P, tagId: loose.id, category: "A", description: "x", raisedOn: TODAY }), "INVALID_INPUT");
    assert(/هیچ ساب‌سیستمی/.test(e.message), "says why, not just that something is missing");
    await throws(() => qa.raisePunch(db, { projectId: P, tagId: pump.id, subsystemId: s22.id, category: "B",
      description: "x", raisedOn: TODAY }), "INVALID_INPUT", "the tag says 21-01");
    await throws(() => qa.raisePunch(db, { projectId: P, subsystemId: s21.id, category: "D", description: "x", raisedOn: TODAY }), "INVALID_INPUT");
    await throws(() => qa.raisePunch(db, { projectId: P, subsystemId: s21.id, category: "B", description: "x",
      raisedOn: TODAY, dueOn: shift(-1) }), "INVALID_INPUT");
    const b = await qa.raisePunch(db, { projectId: P, subsystemId: s21.id, category: "B", description: "Nameplate", raisedOn: TODAY, userId: alice.id });
    equal(b.punch_no, "21-01-P002");
  });
});

test("clear, reject, clear again, and verify by someone who did not clear", async () => {
  await withProject(db, P, async () => {
    await qa.punchAction(db, { projectId: P, punchId: pA.id, action: "clear", note: "Guard fitted", userId: bob.id });
    await qa.punchAction(db, { projectId: P, punchId: pA.id, action: "reject", note: "Guard not bolted", userId: alice.id });
    await qa.punchAction(db, { projectId: P, punchId: pA.id, action: "clear", note: "Guard bolted", userId: bob.id });
    await throws(() => qa.punchAction(db, { projectId: P, punchId: pA.id, action: "verify", userId: bob.id }), "INVALID_INPUT");
    await throws(() => db.query("UPDATE punch_item SET status = 'closed', closed_by = cleared_by WHERE id = $1", [pA.id]),
      "punch_verifier_not_clearer", "the database holds the same line");
    const v = await qa.punchAction(db, { projectId: P, punchId: pA.id, action: "verify", userId: carol.id });
    equal([v.status, v.closed_by], ["closed", carol.id]);
    const h = await qa.punchHistory(db, { projectId: P, punchId: pA.id });
    equal(h.map((e) => e.event), ["raised", "cleared", "rejected", "cleared", "closed"]);
  });
});

test("a change of category is an event with a reason, and cannot be edited away", async () => {
  await withProject(db, P, async () => {
    const x = await qa.raisePunch(db, { projectId: P, subsystemId: s22.id, category: "A", description: "Missing bolt", raisedOn: TODAY, userId: alice.id });
    await throws(() => qa.punchAction(db, { projectId: P, punchId: x.id, action: "recategorise", category: "B" }), "INVALID_INPUT");
    await throws(() => qa.punchAction(db, { projectId: P, punchId: x.id, action: "recategorise", category: "A", note: "same" }), "INVALID_INPUT");
    await qa.punchAction(db, { projectId: P, punchId: x.id, action: "recategorise", category: "B", note: "Not safety related per QA", userId: bob.id });
    const list = await qa.listPunch(db, { projectId: P, subsystemId: s22.id });
    equal([list[0].category, list[0].recategorised], ["B", 1]);
    const h = await qa.punchHistory(db, { projectId: P, punchId: x.id });
    equal([h[1].from_value, h[1].to_value], ["A", "B"]);
    await throws(() => db.query("UPDATE punch_event SET note = 'x'"), "permission denied");
    await throws(() => db.query("DELETE FROM punch_item"), "permission denied");
  });
});

let ncr;
test("an NCR from raise to close, with a concession signed by engineering", async () => {
  await withProject(db, P, async () => {
    ncr = await qa.raiseNcr(db, { projectId: P, title: "Wrong gasket material", description: "SS316 spiral wound fitted, class calls for Inconel",
      severity: "major", tagId: pump.id, raisedOn: shift(-30), responseDue: shift(-20), userId: alice.id });
    equal([ncr.ncr_no, ncr.subsystem_id], ["NCR-0001", s21.id]);
    await qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "propose", disposition: "use_as_is",
      dispositionNote: "Service temperature allows SS316", userId: bob.id });
    await throws(() => qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "approve", userId: carol.id, actorIsEngineer: false }), "INVALID_INPUT");
    await throws(() => qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "approve", userId: bob.id, actorIsEngineer: true }), "INVALID_INPUT");
    await qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "rejectDisposition", note: "Chloride service — not acceptable", userId: carol.id });
    await qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "propose", disposition: "rework",
      dispositionNote: "Replace with Inconel gasket", userId: bob.id });
    await qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "approve", userId: carol.id });
    await qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "implement", note: "Replaced 2026-09", userId: bob.id });
    await throws(() => qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "close", userId: alice.id }), "INVALID_INPUT",
      "no root cause, no corrective action");
    await throws(() => qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "close", userId: bob.id,
      rootCause: "a", correctiveAction: "b" }), "INVALID_INPUT", "the implementer does not close");
    await throws(() => db.query("UPDATE ncr SET status = 'closed' WHERE id = $1", [ncr.id]), "ncr_closed_with_cause");
    const c = await qa.ncrAction(db, { projectId: P, ncrId: ncr.id, action: "close", userId: alice.id,
      rootCause: "Stores issued by size only", correctiveAction: "Gasket issue checks material against class sheet" });
    equal(c.status, "closed");
    equal((await qa.ncrHistory(db, { projectId: P, ncrId: ncr.id })).map((e) => e.event),
      ["raised", "propose", "rejectDisposition", "propose", "approve", "implement", "close"]);
  });
});

test("escalation: overdue NCRs, level 2 only once the project states its period", async () => {
  await withProject(db, P, async () => {
    await qa.raiseNcr(db, { projectId: P, title: "Weld undercut", description: "0.8 mm", severity: "minor", subsystemId: s22.id,
      raisedOn: shift(-40), responseDue: shift(-25), userId: alice.id });
    let l = (await qa.listNcr(db, { projectId: P })).find((n) => n.ncr_no === "NCR-0002");
    equal([l.escalation.level, l.escalation.capped], [1, true]);
    assert((await missingInformation(db, { projectId: P })).some((m) => m.key === "ncr-escalation"));
    await projects.updateProjectProfile(db, { projectId: P, patch: { ncr_escalation_days: 14 } });
    l = (await qa.listNcr(db, { projectId: P })).find((n) => n.ncr_no === "NCR-0002");
    equal([l.escalation.level, l.escalation.daysOverdue], [2, 25]);
    assert(!(await missingInformation(db, { projectId: P })).some((m) => m.key === "ncr-escalation"));
  });
});

test("what each subsystem's punch list and NCRs hold against MC", async () => {
  await withProject(db, P, async () => {
    // An NCR on a tag filed nowhere yet: it counts against the subsystem the
    // tag is filed under later, not against none.
    await qa.raiseNcr(db, { projectId: P, title: "Nozzle orientation", description: "N3 rotated 15°", severity: "major",
      tagId: loose.id, raisedOn: TODAY, userId: alice.id });
    await spine.upsertTag(db, { projectId: P, tagNo: "E-9999", discipline: "equipment", subsystemId: s21.id });
    const b = await qa.qualityBlocks(db, { projectId: P });
    equal(b[s21.id], { mc: 0, rfsu: 1, carried: 0, ncr: 1 }, "A verified, B still open, NCR-0001 closed, the late-filed tag's NCR open");
    equal(b[s22.id], { mc: 0, rfsu: 1, carried: 0, ncr: 1 }, "the recategorised B and the open NCR");
    const board = await qa.qualityBoard(db, { projectId: P });
    equal(board.subsystems.map((s) => s.code), ["21-01", "22-01"]);
  });
});

test("quality records belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await qa.listPunch(db, { projectId: other.id })).length, 0);
    equal((await db.query("SELECT count(*)::int AS n FROM ncr")).rows[0].n, 0);
  });
});

await run();
