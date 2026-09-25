#!/usr/bin/env node
/**
 * Pre-commissioning and RFSU: the project declares its checklists, each is
 * owed on every item it applies to, a pass counts once someone else
 * accepts it, and RFSU is signed only with MC accepted, every check
 * accepted, no punch A/B and no NCR open.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  templateProblems, expectedChecks, checkState, attemptProblems, acceptProblems, rfsuReadiness,
} from "../../lib/completions/precom.mjs";

// ── the rules ────────────────────────────────────────────────────────────

test("a checklist names what it applies to", async () => {
  equal(templateProblems({ code: "B-MEC-01", title: "Motor solo run", appliesTo: "rotating" }), []);
  equal(templateProblems({ code: "x", title: "", appliesTo: "pump" }).length, 3);
  equal(templateProblems({ code: "B MEC", title: "t", appliesTo: "loop" }).length, 1, "no spaces in a code");
});

test("each active checklist is owed on every item of its kind", async () => {
  const T = [{ id: "t1", code: "B-SUB", title: "Flushing", appliesTo: "subsystem" },
    { id: "t2", code: "B-MEC", title: "Solo run", appliesTo: "rotating" },
    { id: "t3", code: "B-OLD", title: "Retired", appliesTo: "rotating", active: false }];
  const owed = expectedChecks(T, { subsystem: [{ ref: "s", label: "12-01" }], rotating: [{ ref: "p1", label: "P-1" }, { ref: "p2", label: "P-2" }] });
  equal(owed.map((c) => `${c.code}:${c.label}`), ["B-SUB:12-01", "B-MEC:P-1", "B-MEC:P-2"]);
  equal(expectedChecks(T, {}).length, 0, "a kind the subsystem has none of owes nothing");
});

test("the latest attempt decides; a pass counts once accepted", async () => {
  equal(checkState([]), "open");
  equal(checkState([{ result: "pass" }]), "passed");
  equal(checkState([{ result: "pass", acceptedBy: "u" }]), "accepted");
  equal(checkState([{ result: "pass", acceptedBy: "u" }, { result: "fail" }]), "failed", "a later fail reopens it");
  equal(checkState([{ result: "fail" }, { result: "pass" }]), "passed", "the retest");
});

test("an attempt is refused before MC, without a reason for a fail, or dated ahead", async () => {
  const ok = { mcAccepted: true, result: "pass", performedOn: "2026-09-20", today: "2026-09-25" };
  equal(attemptProblems(ok), []);
  assert(/MC/.test(attemptProblems({ ...ok, mcAccepted: false })[0]));
  equal(attemptProblems({ ...ok, result: "fail" }).length, 1);
  equal(attemptProblems({ ...ok, result: "fail", note: "leak at flange 3" }), []);
  equal(attemptProblems({ ...ok, result: "maybe" }).length, 1);
  equal(attemptProblems({ ...ok, performedOn: "2026-09-26" }).length, 1);
  equal(attemptProblems({ ...ok, performedOn: "20/09/2026" }).length, 1);
  equal(attemptProblems({ ...ok, applies: false }).length, 1);
});

test("a pass is accepted by someone else, and only the latest one", async () => {
  const a = { id: "a", result: "pass", performedBy: "u1" };
  equal(acceptProblems({ attempt: a, latest: a, userId: "u2" }), []);
  equal(acceptProblems({ attempt: a, latest: a, userId: "u1" }).length, 1);
  equal(acceptProblems({ attempt: { ...a, result: "fail" }, latest: a, userId: "u2" }).length, 1);
  equal(acceptProblems({ attempt: { ...a, acceptedBy: "u3" }, latest: a, userId: "u2" }).length, 1);
  equal(acceptProblems({ attempt: a, latest: { id: "b" }, userId: "u2" }).length, 1);
  equal(acceptProblems({ attempt: null }).length, 1);
});

test("RFSU: MC accepted, checklists declared and all accepted, no punch A/B, no NCR", async () => {
  const done = [{ state: "accepted", code: "B", label: "x" }];
  equal(rfsuReadiness({ mcAccepted: true, templatesDeclared: true, checks: done }), { ready: true, blockers: [] });
  equal(rfsuReadiness({ mcAccepted: true, templatesDeclared: false, checks: [] }).blockers.map((b) => b.kind), ["no_templates"],
    "no checklist declared is not a completed pre-commissioning");
  const r = rfsuReadiness({ mcAccepted: false, templatesDeclared: true, checks: [...done, { state: "passed", code: "B", label: "P-1" }], punchAB: 2, ncrOpen: 1 });
  equal(r.blockers.map((b) => [b.kind, b.count ?? null]), [["mc", null], ["checks", 1], ["punch", 2], ["ncr", 1]]);
  equal(r.blockers[1].detail, ["B · P-1"]);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "prc-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const inst = await import("../../lib/db/repos/instrumentation.mjs");
const qa = await import("../../lib/db/repos/quality.mjs");
const prc = await import("../../lib/db/repos/precom.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const proj = await projects.createProject(db, { code: "PRC", name: "P", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "PRC2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const TODAY = new Date().toISOString().slice(0, 10);
const inP = (fn) => withProject(db, P, fn);
let sub, pump, tSub, tMec, tLoop;

await inP(async () => {
  sub = await spine.upsertSubsystem(db, { projectId: P, code: "12-01", systemCode: "12" });
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-1", discipline: "equipment", kind: "rotating", subsystemId: sub.id });
  await spine.upsertTag(db, { projectId: P, tagNo: "V-1", discipline: "equipment", kind: "static", subsystemId: sub.id });
  // An instrument with no loop number owes no loop check.
  await db.query("INSERT INTO instrument (project_id, tag_no, subsystem_id) VALUES ($1, 'XX-LOOSE', $2)", [P, sub.id]);
  await inst.importInstrumentIndex(db, { projectId: P, text: "Tag No,Service,Type,Range,Equipment\nPT-1203A,discharge,Smart transmitter,0-25 bar,P-1\nPI-1203A,local,Bourdon gauge,0-25 bar,P-1" });
});

test("the project declares its checklists; one with records keeps its kind", async () => {
  await inP(async () => {
    tSub = await prc.upsertTemplate(db, { projectId: P, code: "B-SUB-01", title: "Flushing and blowing", appliesTo: "subsystem", criteria: "clean target" });
    tMec = await prc.upsertTemplate(db, { projectId: P, code: "B-MEC-01", title: "Motor solo run", appliesTo: "rotating", criteria: "4 h, vibration < 4.5 mm/s" });
    tLoop = await prc.upsertTemplate(db, { projectId: P, code: "B-INS-01", title: "Loop function test", appliesTo: "loop" });
    await throws(async () => prc.upsertTemplate(db, { projectId: P, code: "B-X", title: "x", appliesTo: "pump" }), "اعمال");
    const s = await prc.subsystemPrecom(db, { projectId: P, subsystemId: sub.id });
    equal(s.checks.map((c) => `${c.code}:${c.label}`).sort(), ["B-INS-01:" + s.checks.find((c) => c.itemKind === "loop").label, "B-MEC-01:P-1", "B-SUB-01:12-01"].sort());
    equal(s.checks.filter((c) => c.itemKind === "loop").length, 1, "the two instruments share one loop");
    equal(s.blockers.map((b) => b.kind), ["mc", "checks"]);
  });
});

test("nothing is recorded before MC is accepted", async () => {
  await inP(async () => {
    await throws(async () => prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tSub.id, itemRef: sub.id,
      result: "pass", performedOn: TODAY, userId: alice.id }), "پذیرش MC");
    await db.query(`INSERT INTO mc_certificate (project_id, subsystem_id, snapshot, signed_by) VALUES ($1,$2,'{}',$3)`, [P, sub.id, alice.id]);
    await throws(async () => prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tSub.id, itemRef: sub.id,
      result: "pass", performedOn: TODAY, userId: alice.id }), "پذیرش MC", "signed is not accepted");
    equal((await prc.subsystemPrecom(db, { projectId: P, subsystemId: sub.id })).blockers[0].kind, "mc", "nor for RFSU");
    await db.query("UPDATE mc_certificate SET accepted_by = $2, accepted_at = now() WHERE subsystem_id = $1", [sub.id, bob.id]);
  });
});

test("a pass counts once someone else accepts it; the latest attempt decides", async () => {
  await inP(async () => {
    const flush = await prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tSub.id, itemRef: sub.id,
      result: "pass", performedOn: TODAY, witnessedBy: "Company rep.", userId: alice.id });
    await throws(async () => prc.acceptAttempt(db, { projectId: P, attemptId: flush.id, userId: alice.id }), "انجام‌دهنده");
    await prc.acceptAttempt(db, { projectId: P, attemptId: flush.id, userId: bob.id });
    await throws(async () => prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tMec.id, itemRef: pump.id,
      result: "fail", performedOn: TODAY, userId: alice.id }), "شرح");
    await prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tMec.id, itemRef: pump.id,
      result: "fail", performedOn: TODAY, note: "DE bearing 7.1 mm/s", userId: alice.id });
    const first = await prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tMec.id, itemRef: pump.id,
      result: "pass", performedOn: TODAY, note: "after realignment", userId: alice.id });
    const second = await prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tMec.id, itemRef: pump.id,
      result: "pass", performedOn: TODAY, note: "4 h run, 2.3 mm/s", userId: alice.id });
    await throws(async () => prc.acceptAttempt(db, { projectId: P, attemptId: first.id, userId: bob.id }), "جدیدتری");
    await prc.acceptAttempt(db, { projectId: P, attemptId: second.id, userId: bob.id });
    await throws(async () => prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tMec.id, itemRef: "not-an-item",
      result: "pass", performedOn: TODAY, userId: alice.id }), "اعمال نمی‌شود");
    const s = await prc.subsystemPrecom(db, { projectId: P, subsystemId: sub.id });
    const mec = s.checks.find((c) => c.code === "B-MEC-01");
    equal([mec.state, mec.attempts.length], ["accepted", 3]);
    equal(s.counts, { total: 3, accepted: 2, failed: 0, passed: 0 });
    await throws(async () => prc.upsertTemplate(db, { projectId: P, code: "B-MEC-01", title: "Motor solo run", appliesTo: "static" }), "عوض نمی‌شود");
    await throws(async () => db.query("UPDATE precom_attempt SET result = 'fail'"), "permission denied");
    await throws(async () => db.query("DELETE FROM precom_attempt"), "permission denied");
    await throws(async () => db.query("UPDATE precom_attempt SET accepted_by = performed_by WHERE id = $1", [first.id]), "precom_acceptor_not_performer");
  });
});

test("RFSU waits for every check, every punch A/B and every NCR; the signer does not accept it", async () => {
  await inP(async () => {
    await throws(async () => prc.signRfsu(db, { projectId: P, subsystemId: sub.id, userId: alice.id }), "checks");
    const s0 = await prc.subsystemPrecom(db, { projectId: P, subsystemId: sub.id });
    const loop = s0.checks.find((c) => c.itemKind === "loop");
    const lt = await prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tLoop.id, itemRef: loop.itemRef,
      result: "pass", performedOn: TODAY, userId: alice.id });
    await prc.acceptAttempt(db, { projectId: P, attemptId: lt.id, userId: bob.id });
    const b = await qa.raisePunch(db, { projectId: P, tagId: pump.id, category: "B", description: "Coupling guard paint", raisedOn: TODAY, userId: bob.id });
    await throws(async () => prc.signRfsu(db, { projectId: P, subsystemId: sub.id, userId: alice.id }), "punch (1)");
    await qa.punchAction(db, { projectId: P, punchId: b.id, action: "clear", note: "painted", userId: alice.id });
    await qa.punchAction(db, { projectId: P, punchId: b.id, action: "verify", userId: bob.id });
    const n = await qa.raiseNcr(db, { projectId: P, title: "t", description: "d", severity: "minor", tagId: pump.id, raisedOn: TODAY, userId: bob.id });
    await throws(async () => prc.signRfsu(db, { projectId: P, subsystemId: sub.id, userId: alice.id }), "ncr (1)");
    await qa.ncrAction(db, { projectId: P, ncrId: n.id, action: "propose", disposition: "rework", dispositionNote: "redo", userId: bob.id });
    await qa.ncrAction(db, { projectId: P, ncrId: n.id, action: "approve", userId: alice.id, actorIsEngineer: true });
    await qa.ncrAction(db, { projectId: P, ncrId: n.id, action: "implement", note: "done", rootCause: "x", correctiveAction: "y", userId: bob.id });
    await qa.ncrAction(db, { projectId: P, ncrId: n.id, action: "close", userId: alice.id });
    const r = await prc.signRfsu(db, { projectId: P, subsystemId: sub.id, userId: alice.id });
    assert(r.snapshot.checks.length === 3 && r.snapshot.checks.every((c) => c.attemptId), "what was certified is kept with the signature");
    await throws(async () => prc.signRfsu(db, { projectId: P, subsystemId: sub.id, userId: alice.id }), "پیش‌تر");
    await throws(async () => prc.acceptRfsu(db, { projectId: P, subsystemId: sub.id, userId: alice.id }), "امضاکننده");
    await prc.acceptRfsu(db, { projectId: P, subsystemId: sub.id, userId: bob.id });
    await throws(async () => prc.acceptRfsu(db, { projectId: P, subsystemId: sub.id, userId: bob.id }), "پیش‌تر");
    await throws(async () => prc.recordAttempt(db, { projectId: P, subsystemId: sub.id, templateId: tSub.id, itemRef: sub.id,
      result: "pass", performedOn: TODAY, userId: alice.id }), "RFSU");
    const board = await prc.precomBoard(db, { projectId: P });
    equal(board.map((x) => [x.code, !!x.rfsu_accepted_at, x.reopened]), [["12-01", true, false]]);
    await qa.raisePunch(db, { projectId: P, tagId: pump.id, category: "B", description: "found after RFSU", raisedOn: TODAY, userId: bob.id });
    equal((await prc.precomBoard(db, { projectId: P }))[0].reopened, true, "the certificate stands; the board says something reopened");
    await throws(async () => db.query("DELETE FROM rfsu_certificate"), "permission denied");
  });
  await withProject(db, other.id, async () => {
    equal((await prc.listTemplates(db, { projectId: other.id })).length, 0);
    const s2 = await spine.upsertSubsystem(db, { projectId: other.id, code: "99-01", systemCode: "99" });
    await db.query("INSERT INTO mc_certificate (project_id, subsystem_id, snapshot, signed_by, accepted_by, accepted_at) VALUES ($1,$2,'{}',$3,$4,now())",
      [other.id, s2.id, alice.id, bob.id]);
    const r2 = await prc.subsystemPrecom(db, { projectId: other.id, subsystemId: s2.id });
    equal([r2.ready, r2.blockers.map((b) => b.kind)], [false, ["no_templates"]], "no checklist declared: nothing to certify");
    equal((await db.query("SELECT count(*)::int AS n FROM precom_attempt")).rows[0].n, 0);
  });
});

await run();
