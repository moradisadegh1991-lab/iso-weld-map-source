#!/usr/bin/env node
/**
 * Safe work before the permit: competence cards, scaffold and crane
 * inspection, JSA — and the permit that is not issued without them.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cardValidOn, crewCheck, competenceRule, equipmentState, equipmentCoverage, jsaApprovalProblems, jsaCheck, addDays,
} from "../../lib/hse/safework.mjs";

// ── the rules ────────────────────────────────────────────────────────────

const card = (o) => ({ kind: "work_at_height", issuedOn: "2026-01-01", expiresOn: "2026-12-31", noExpiry: false, revokedOn: null, ...o });

test("a card is valid from issue to expiry, unless revoked; no expiry recorded is not 'forever'", async () => {
  equal(cardValidOn(card(), "2026-06-01").ok, true);
  equal(cardValidOn(card(), "2026-12-31").ok, true, "the expiry day itself is covered");
  equal(cardValidOn(card(), "2027-01-01").ok, false);
  equal(cardValidOn(card(), "2025-12-31").ok, false, "not before it was issued");
  equal(cardValidOn(card({ revokedOn: "2026-03-01" }), "2026-03-01").ok, false);
  equal(cardValidOn(card({ revokedOn: "2026-03-01" }), "2026-02-28").ok, true, "revocation is not retroactive");
  equal(cardValidOn(card({ expiresOn: null, noExpiry: true }), "2040-01-01").ok, true);
  const unknown = cardValidOn(card({ expiresOn: null }), "2026-06-01");
  equal(unknown.ok, null);
  assert(/انقضا ثبت نشده/.test(unknown.reason));
});

test("the crew check: no rule is reported, an empty rule requires nothing, and a card must cover the whole window", async () => {
  const rules = { hot: ["induction", "hot_work"], cold: [] };
  equal(competenceRule(rules, "lifting"), null);
  equal(crewCheck(competenceRule(rules, "lifting"), [], "2026-06-01", "2026-06-01"), { declared: false, reasons: [] });
  equal(crewCheck(competenceRule(rules, "cold"), [], "2026-06-01", "2026-06-01"), { declared: true, reasons: [] });
  const none = crewCheck(rules.hot, [], "2026-06-01", "2026-06-01");
  equal(none.reasons.length, 1, "a rule with nobody named checks nobody — refused");
  const ali = { name: "Ali", cards: [card({ kind: "induction", expiresOn: null, noExpiry: true }), card({ kind: "hot_work", expiresOn: "2026-06-01" })] };
  equal(crewCheck(rules.hot, [ali], "2026-06-01", "2026-06-01").reasons, []);
  const mid = crewCheck(rules.hot, [ali], "2026-06-01", "2026-06-02");
  equal(mid.reasons.length, 1, "the card lapses before the permit ends");
  assert(/Ali/.test(mid.reasons[0]) && /کار گرم/.test(mid.reasons[0]) && !/بدو ورود/.test(mid.reasons[0]), mid.reasons[0]);
});

test("a scaffold is fit until its last pass plus the project's interval; a later fail is a red tag", async () => {
  const P = { hse_scaffold_inspection_days: 7 };
  const eq = (inspections, extra = {}) => ({ kind: "scaffold", refNo: "SC-1", inspections, ...extra });
  equal(equipmentState(eq([]), P, "2026-06-01").code, "never");
  const pass = [{ inspectedOn: "2026-06-01", result: "pass" }];
  equal(equipmentState(eq(pass), P, "2026-06-08"), { code: "valid", validUntil: "2026-06-08", text: "معتبر تا 2026-06-08" });
  equal(equipmentState(eq(pass), P, "2026-06-09").code, "expired");
  equal(equipmentState(eq(pass), {}, "2026-06-02").code, "unknown", "no interval, no verdict");
  const failedAfter = [...pass, { inspectedOn: "2026-06-03", result: "fail" }];
  equal(equipmentState(eq(failedAfter), P, "2026-06-04").code, "failed");
  equal(equipmentState(eq(failedAfter), P, "2026-06-02").code, "valid", "the fail had not happened yet on the 2nd");
  equal(equipmentState(eq([{ inspectedOn: "2026-06-03", result: "fail" }, ...pass]), P, "2026-06-04").code, "failed", "order in, order out");
  equal(equipmentState(eq(pass, { dismantledOn: "2026-06-05" }), P, "2026-06-05").code, "dismantled");
  equal(equipmentCoverage(eq(pass), P, "2026-06-02", "2026-06-08"), []);
  const beyond = equipmentCoverage(eq(pass), P, "2026-06-02", "2026-06-09");
  equal(beyond.length, 1);
  assert(/تا پایان مجوز/.test(beyond[0]), beyond[0]);
  equal(addDays("2026-02-27", 2), "2026-03-01");
});

test("a JSA is approved only with controls, residual scores within the project's limit, and no control that adds risk", async () => {
  const step = (o) => ({ seq: 1, controls: "Harness, 100% tie-off", likelihood: 4, severity: 5, residualLikelihood: 1, residualSeverity: 5, ...o });
  equal(jsaApprovalProblems([step()], { hse_risk_max_residual: 6 }), []);
  assert(/تعیین نشده/.test(jsaApprovalProblems([step()], {})[0]), "no limit, no approval");
  equal(jsaApprovalProblems([], { hse_risk_max_residual: 6 }).length, 1);
  equal(jsaApprovalProblems([step({ controls: " " })], { hse_risk_max_residual: 6 }).length, 1);
  equal(jsaApprovalProblems([step({ residualSeverity: null })], { hse_risk_max_residual: 6 }).length, 1);
  const over = jsaApprovalProblems([step({ residualLikelihood: 2 })], { hse_risk_max_residual: 6 });
  equal(over.length, 1);
  assert(/10/.test(over[0]) && /6/.test(over[0]), over[0]);
  equal(jsaApprovalProblems([step({ likelihood: 1, severity: 2, residualLikelihood: 1, residualSeverity: 3 })],
    { hse_risk_max_residual: 6 }).length, 1, "a residual above the initial risk");
  equal(jsaApprovalProblems([step({ residualLikelihood: 2, residualSeverity: 3 })], { hse_risk_max_residual: 6 }), [],
    "exactly at the limit is accepted");
});

test("a permit's JSA: required and missing, draft, superseded", async () => {
  equal(jsaCheck({ required: null, jsa: null }), []);
  equal(jsaCheck({ required: false, jsa: null }), []);
  equal(jsaCheck({ required: true, jsa: null }).length, 1);
  equal(jsaCheck({ required: false, jsa: { jsaNo: "J", revision: "0", status: "draft" } }).length, 1, "a draft attached is never enough");
  equal(jsaCheck({ required: true, jsa: { jsaNo: "J", revision: "0", status: "superseded" } }).length, 1);
  equal(jsaCheck({ required: true, jsa: { jsaNo: "J", revision: "1", status: "approved" } }), []);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "hsesw-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const hse = await import("../../lib/db/repos/hse.mjs");
const sw = await import("../../lib/db/repos/hse-safework.mjs");
const { missingInformation } = await import("../../lib/db/repos/assumptions.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice", displayName: "Alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob", displayName: "Bob" });
const proj = await projects.createProject(db, { code: "SW", name: "SW", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "SW2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const hours = (h) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const ago = (d) => addDays(TODAY, -d);
let reza, sara, insp, scaffold, crane, jsa0;

await withProject(db, P, async () => {
  await projects.updateProjectProfile(db, { projectId: P, patch: { hse_permit_max_hours: 240 } });
});

test("the project's rules are checked when stated, and an empty list is a statement", async () => {
  await withProject(db, P, async () => {
    await throws(() => sw.setSafeWorkRules(db, { projectId: P, competenceRules: { work_at_height: ["flying"] } }), "INVALID_INPUT");
    await throws(() => sw.setSafeWorkRules(db, { projectId: P, competenceRules: { teleport: [] } }), "INVALID_INPUT");
    await throws(() => sw.setSafeWorkRules(db, { projectId: P, jsaRequiredTypes: ["teleport"] }), "INVALID_INPUT");
    const s = await sw.setSafeWorkRules(db, { projectId: P,
      competenceRules: { work_at_height: ["induction", "work_at_height"], lifting: ["rigger"], cold: [] },
      jsaRequiredTypes: ["work_at_height"] });
    equal(s.hse_competence_rules.cold, []);
    equal(s.hse_jsa_required_types, ["work_at_height"]);
  });
});

test("cards: no expiry is stated, never assumed; a card is revoked, never deleted", async () => {
  await withProject(db, P, async () => {
    reza = await sw.upsertPerson(db, { projectId: P, idNo: "0012345678", fullName: "Reza K.", trade: "Scaffolder" });
    sara = await sw.upsertPerson(db, { projectId: P, idNo: "0098765432", fullName: "Sara M." });
    insp = await sw.upsertPerson(db, { projectId: P, idNo: "0055555555", fullName: "Inspector N." });
    await throws(() => sw.addCompetence(db, { projectId: P, personId: reza.id, kind: "induction", issuedOn: ago(30),
      expiresOn: addDays(TODAY, 300), noExpiry: true }), "INVALID_INPUT", "a date and 'no expiry' contradict");
    await throws(() => sw.addCompetence(db, { projectId: P, personId: reza.id, kind: "induction", issuedOn: ago(30),
      expiresOn: ago(40) }), "INVALID_INPUT");
    await throws(() => sw.addCompetence(db, { projectId: P, personId: reza.id, kind: "flying", issuedOn: ago(30) }), "INVALID_INPUT");
    await sw.addCompetence(db, { projectId: P, personId: reza.id, kind: "induction", issuedOn: ago(30), noExpiry: true, userId: alice.id });
    await sw.addCompetence(db, { projectId: P, personId: reza.id, kind: "work_at_height", issuedOn: ago(30), expiresOn: addDays(TODAY, 300) });
    await sw.addCompetence(db, { projectId: P, personId: sara.id, kind: "induction", issuedOn: ago(30), noExpiry: true });
    await sw.addCompetence(db, { projectId: P, personId: sara.id, kind: "work_at_height", issuedOn: ago(400), expiresOn: ago(1) });
    const loose = await sw.addCompetence(db, { projectId: P, personId: sara.id, kind: "first_aid", issuedOn: ago(10) });
    const people = await sw.peopleBoard(db, { projectId: P, today: TODAY });
    const saraCards = people.find((p) => p.id === sara.id).cards;
    equal(saraCards.map((c) => [c.kind, c.state.code]), [["work_at_height", "expired"], ["induction", "valid"], ["first_aid", "unknown"]]);
    assert((await missingInformation(db, { projectId: P })).some((m) => m.key === "hse-card-expiry" && m.count === 1));
    await throws(() => db.query("DELETE FROM hse_competence WHERE id = $1", [loose.id]), "permission denied");
    await throws(() => sw.revokeCompetence(db, { projectId: P, competenceId: loose.id, revokedOn: TODAY }), "INVALID_INPUT", "a reason");
    await sw.revokeCompetence(db, { projectId: P, competenceId: loose.id, revokedOn: TODAY, reason: "Issued in error" });
    assert(!(await missingInformation(db, { projectId: P })).some((m) => m.key === "hse-card-expiry"), "a revoked card is no longer missing a date");
  });
});

test("an inspection is by someone holding the inspector's card that day, is not dated ahead, and a fail says why", async () => {
  await withProject(db, P, async () => {
    scaffold = await sw.registerEquipment(db, { projectId: P, kind: "scaffold", refNo: "sc-101", area: "U-11 rack" });
    crane = await sw.registerEquipment(db, { projectId: P, kind: "crane", refNo: "CR-50T", capacityT: 50 });
    await throws(() => sw.registerEquipment(db, { projectId: P, kind: "ladder", refNo: "L1" }), "INVALID_INPUT");
    await throws(() => sw.inspectEquipment(db, { projectId: P, equipmentId: scaffold.id, inspectedOn: TODAY, result: "pass",
      inspectorId: insp.id }), "بازرس داربست", "no inspector's card");
    await sw.addCompetence(db, { projectId: P, personId: insp.id, kind: "scaffold_inspector", issuedOn: ago(3), expiresOn: addDays(TODAY, 200) });
    await throws(() => sw.inspectEquipment(db, { projectId: P, equipmentId: scaffold.id, inspectedOn: ago(5), result: "pass",
      inspectorId: insp.id }), "بازرس داربست", "the card was issued after that day");
    await throws(() => sw.inspectEquipment(db, { projectId: P, equipmentId: crane.id, inspectedOn: TODAY, result: "pass",
      inspectorId: insp.id }), "بالابر", "a scaffold inspector does not certify a crane");
    await throws(() => sw.inspectEquipment(db, { projectId: P, equipmentId: scaffold.id, inspectedOn: addDays(TODAY, 1), result: "pass",
      inspectorId: insp.id }), "INVALID_INPUT", "not dated ahead");
    await throws(() => sw.inspectEquipment(db, { projectId: P, equipmentId: scaffold.id, inspectedOn: TODAY, result: "fail",
      inspectorId: insp.id }), "INVALID_INPUT", "a fail says why");
    const i = await sw.inspectEquipment(db, { projectId: P, equipmentId: scaffold.id, inspectedOn: TODAY, result: "pass",
      inspectorId: insp.id, certRef: "TAG-0101", userId: alice.id });
    await throws(() => db.query("UPDATE hse_equipment_inspection SET result = 'fail' WHERE id = $1", [i.id]), "permission denied");
    let b = await sw.equipmentBoard(db, { projectId: P, today: TODAY });
    equal(b.find((e) => e.id === scaffold.id).state.code, "unknown", "no interval stated yet");
    assert((await missingInformation(db, { projectId: P })).some((m) => m.key === "hse-scaffold-interval"));
    await projects.updateProjectProfile(db, { projectId: P, patch: { hse_scaffold_inspection_days: 7 } });
    b = await sw.equipmentBoard(db, { projectId: P, today: TODAY });
    equal(b.find((e) => e.id === scaffold.id).state.validUntil, addDays(TODAY, 7));
    equal(b.find((e) => e.id === crane.id).state.code, "never");
  });
});

test("a JSA: approved by someone else, within the limit, then fixed; a change is a revision that supersedes", async () => {
  await withProject(db, P, async () => {
    jsa0 = await sw.createJsa(db, { projectId: P, jsaNo: "jsa-wah-01", title: "Work on pipe rack scaffold", userId: alice.id });
    await throws(() => sw.saveJsaStep(db, { projectId: P, jsaId: jsa0.id, seq: 1, step: "Climb", hazard: "Fall", likelihood: 6, severity: 5 }),
      "INVALID_INPUT", "scale is 1–5");
    await sw.saveJsaStep(db, { projectId: P, jsaId: jsa0.id, seq: 1, step: "Climb scaffold", hazard: "Fall from height",
      controls: "Inspected scaffold, full harness, 100% tie-off", likelihood: 4, severity: 5, residualLikelihood: 2, residualSeverity: 5 });
    await throws(() => sw.approveJsa(db, { projectId: P, jsaId: jsa0.id, userId: bob.id }), "تعیین نشده", "no limit stated");
    assert((await missingInformation(db, { projectId: P })).some((m) => m.key === "hse-risk-max"));
    await projects.updateProjectProfile(db, { projectId: P, patch: { hse_risk_max_residual: 6 } });
    await throws(() => sw.approveJsa(db, { projectId: P, jsaId: jsa0.id, userId: bob.id }), "از حد پذیرفتنی", "residual 10 > 6");
    await sw.saveJsaStep(db, { projectId: P, jsaId: jsa0.id, seq: 1, step: "Climb scaffold", hazard: "Fall from height",
      controls: "Inspected scaffold, full harness, 100% tie-off, rescue plan", likelihood: 4, severity: 5, residualLikelihood: 1, residualSeverity: 5 });
    await throws(() => sw.approveJsa(db, { projectId: P, jsaId: jsa0.id, userId: alice.id }), "تهیه‌کننده", "not by its preparer");
    const a = await sw.approveJsa(db, { projectId: P, jsaId: jsa0.id, userId: bob.id, today: TODAY });
    equal([a.status, a.approved_by], ["approved", bob.id]);
    await throws(() => sw.saveJsaStep(db, { projectId: P, jsaId: jsa0.id, seq: 2, step: "x", hazard: "y", likelihood: 1, severity: 1 }),
      "INVALID_INPUT");
    await throws(() => db.query("UPDATE hse_jsa_step SET controls = 'none' WHERE jsa_id = $1", [jsa0.id]), "fixed", "the database too");
    await throws(() => db.query("UPDATE hse_jsa SET title = 'x' WHERE id = $1", [jsa0.id]), "new revision");
  });
});

test("a work-at-height permit is not issued while a crew card, the scaffold or the JSA falls short — every reason at once", async () => {
  await withProject(db, P, async () => {
    await throws(() => hse.requestPermit(db, { projectId: P, permitNo: "WAH-X", type: "work_at_height", area: "U-11", description: "x",
      validFrom: hours(-1), validTo: hours(6), equipmentId: crane.id, userId: alice.id }), "INVALID_INPUT", "a crane is not a scaffold permit's");
    const p = await hse.requestPermit(db, { projectId: P, permitNo: "WAH-001", type: "work_at_height", area: "U-11 rack",
      description: "Insulation on rack", validFrom: hours(-1), validTo: hours(6), equipmentId: scaffold.id,
      crew: [reza.id, sara.id], userId: alice.id });
    const e = await throws(() => hse.activatePermit(db, { projectId: P, permitId: p.id, userId: bob.id, now: NOW.toISOString() }), "INVALID_INPUT");
    assert(e.reasons.some((r) => /Sara/.test(r) && /کار در ارتفاع/.test(r)), e.reasons.join(" | "));
    assert(!e.reasons.some((r) => /Reza/.test(r)), "Reza holds both");
    assert(e.reasons.some((r) => /JSA/.test(r)), "and the JSA the project requires");
    const board = (await hse.listPermits(db, { projectId: P, now: NOW.toISOString() })).find((x) => x.id === p.id);
    equal(board.readiness.ok, false);
    equal(board.crew.map((c) => c.name), ["Reza K.", "Sara M."]);
    equal(board.equipment.refNo, "SC-101");
  });
});

test("with a competent crew, the scaffold fit through the window and the approved JSA, it is issued — and its crew is then fixed", async () => {
  await withProject(db, P, async () => {
    const long = await hse.requestPermit(db, { projectId: P, permitNo: "WAH-LONG", type: "work_at_height", area: "U-11 rack",
      description: "Longer than the tag", validFrom: hours(-1), validTo: hours(24 * 9), equipmentId: scaffold.id,
      jsaId: jsa0.id, crew: [reza.id], userId: alice.id });
    const e = await throws(() => hse.activatePermit(db, { projectId: P, permitId: long.id, userId: bob.id, now: NOW.toISOString() }), "تا پایان مجوز");
    equal(e.reasons.length, 1, e.reasons.join(" | "));
    const p = await hse.requestPermit(db, { projectId: P, permitNo: "WAH-002", type: "work_at_height", area: "U-11 rack",
      description: "Insulation on rack", validFrom: hours(-1), validTo: hours(6), equipmentId: scaffold.id,
      jsaId: jsa0.id, crew: [reza.id], userId: alice.id });
    const a = await hse.activatePermit(db, { projectId: P, permitId: p.id, userId: bob.id, now: NOW.toISOString() });
    equal(a.status, "active");
    await throws(() => sw.setPermitCrew(db, { projectId: P, permitId: p.id, personIds: [reza.id, sara.id] }), "INVALID_INPUT");
    await throws(() => db.query("INSERT INTO hse_permit_crew (project_id, permit_id, person_id) VALUES ($1,$2,$3)", [P, p.id, sara.id]),
      "crew is fixed", "the database too");
  });
});

test("an undeclared rule is a note, not a pass or a block; a superseded JSA and a red tag hold a request", async () => {
  await withProject(db, P, async () => {
    const cold = await hse.requestPermit(db, { projectId: P, permitNo: "CW-1", type: "excavation", area: "U-12", description: "Trench",
      validFrom: hours(-1), validTo: hours(6), userId: alice.id });
    let r = (await hse.listPermits(db, { projectId: P, now: NOW.toISOString() })).find((x) => x.id === cold.id).readiness;
    equal(r.ok, true, "excavation has no competence rule: reported, not blocked");
    assert(r.notes.some((n) => /صلاحیت/.test(n)), r.notes.join(" | "));
    assert(!r.notes.some((n) => /JSA/.test(n)), "the JSA list is stated — no note for it");
    await sw.setSafeWorkRules(db, { projectId: P, jsaRequiredTypes: null });
    r = (await hse.listPermits(db, { projectId: P, now: NOW.toISOString() })).find((x) => x.id === cold.id).readiness;
    assert(r.notes.some((n) => /لزوم JSA/.test(n)), `unstated, it is said: ${r.notes.join(" | ")}`);
    await sw.setSafeWorkRules(db, { projectId: P, jsaRequiredTypes: ["work_at_height"] });
    const pending = await hse.requestPermit(db, { projectId: P, permitNo: "WAH-003", type: "work_at_height", area: "U-11 rack",
      description: "Tomorrow", validFrom: hours(-1), validTo: hours(6), equipmentId: scaffold.id, jsaId: jsa0.id,
      crew: [reza.id], userId: alice.id });
    const rev1 = await sw.reviseJsa(db, { projectId: P, jsaId: jsa0.id, revision: "1", userId: alice.id });
    equal((await sw.jsaBoard(db, { projectId: P })).find((j) => j.id === rev1.id).steps.length, 1, "the revision starts from the steps");
    await throws(() => sw.reviseJsa(db, { projectId: P, jsaId: jsa0.id, revision: "2" }), "INVALID_INPUT", "one draft at a time");
    await sw.approveJsa(db, { projectId: P, jsaId: rev1.id, userId: bob.id, today: TODAY });
    r = (await hse.listPermits(db, { projectId: P, now: NOW.toISOString() })).find((x) => x.id === pending.id).readiness;
    assert(r.reasons.some((x) => /منسوخ/.test(x)), r.reasons.join(" | "));
    await sw.inspectEquipment(db, { projectId: P, equipmentId: scaffold.id, inspectedOn: TODAY, result: "fail",
      inspectorId: insp.id, findings: "Missing toe board, bay 3" });
    r = (await hse.listPermits(db, { projectId: P, now: NOW.toISOString() })).find((x) => x.id === pending.id).readiness;
    assert(r.reasons.some((x) => /برچسب قرمز/.test(x)), r.reasons.join(" | "));
  });
});

test("safe-work records belong to one project", async () => {
  await withProject(db, other.id, async () => {
    const b = await sw.safeWorkBoard(db, { projectId: other.id, today: TODAY });
    equal([b.people.length, b.equipment.length, b.jsas.length], [0, 0, 0]);
    await throws(() => sw.setPermitCrew(db, { projectId: other.id, permitId: jsa0.id, personIds: [] }), "not found");
  });
});

await run();
