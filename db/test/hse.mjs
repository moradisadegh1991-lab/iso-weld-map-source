#!/usr/bin/env node
/**
 * HSE: incident class from facts, rates on a stated base, permits that do
 * not activate on unstated limits, and observations that go overdue.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classifyIncident, rates, judgeGasTest, activationCheck, permitState, simops, observationState,
} from "../../lib/hse/hse.mjs";

// ── the engine ───────────────────────────────────────────────────────────

const inj = (o = {}) => ({ injured: true, fatal: false, daysAway: 0, restrictedDays: 0, treatment: "first_aid", ...o });

test("the class follows the facts, most severe first", async () => {
  equal(classifyIncident(inj({ fatal: true, daysAway: null })).cls, "FAT");
  equal(classifyIncident(inj({ daysAway: 2, restrictedDays: 3, treatment: "medical" })).cls, "LWC");
  equal(classifyIncident(inj({ restrictedDays: 3, treatment: "medical" })).cls, "RWC");
  equal(classifyIncident(inj({ treatment: "medical" })).cls, "MTC");
  equal(classifyIncident(inj()).cls, "FAC");
  equal(classifyIncident({ injured: false }).cls, "NM");
});

test("incomplete facts give no class, not the mildest one", async () => {
  equal(classifyIncident(inj({ treatment: null })).cls, null);
  equal(classifyIncident(inj({ restrictedDays: null, treatment: "medical" })).cls, null, "might be an RWC");
  equal(classifyIncident({ injured: null }).cls, null);
  equal(classifyIncident(inj({ treatment: "none" })).cls, null, "an injury with nothing done is not a class");
  equal(classifyIncident(inj({ daysAway: 3, treatment: null })).cls, "LWC", "a lost day decides it");
  equal(classifyIncident(inj({ fatal: null, daysAway: 3 })).cls, null, "but not while a fatality is open");
  equal(classifyIncident({ injured: false, treatment: "medical" }).cls, null, "contradictory facts");
});

test("rates are per million hours (IOGP) and per 200 000 (OSHA), and zero hours gives none", async () => {
  const r = rates(["LWC", "FAT", "RWC", "MTC", "MTC", "FAC", "NM", null], 500_000);
  equal([r.lti, r.recordable, r.fatalities, r.unclassified], [2, 5, 1, 1]);
  equal([r.ltif.iogp, r.ltif.osha, r.trir.iogp, r.trir.osha], [4, 0.8, 10, 2]);
  equal(rates(["LWC"], 0).ltif.iogp, null);
});

const limits = { hse_o2_min_pct: 19.5, hse_o2_max_pct: 23.5, hse_lel_max_pct: 0, hse_h2s_max_ppm: 5,
  hse_co_max_ppm: 25, hse_gas_test_validity_min: 120, hse_permit_max_hours: 12 };
const clean = { testedAt: "2026-09-20T07:30:00Z", o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0 };

test("a gas test is judged only against limits the project wrote down", async () => {
  const g = judgeGasTest(clean, { ...limits, hse_h2s_max_ppm: null });
  equal(g.ok, null);
  assert(/H2S/.test(g.reason));
  equal(judgeGasTest({ ...clean, coPpm: null }, limits).ok, null, "an unread gas is not a pass");
  equal(judgeGasTest(clean, limits).ok, true);
  equal(judgeGasTest({ ...clean, o2Pct: 19.4 }, limits).failures.length, 1);
  equal(judgeGasTest({ ...clean, o2Pct: 23.6 }, limits).ok, false, "enrichment fails too");
  equal(judgeGasTest({ ...clean, lelPct: 1 }, limits).ok, false);
  equal(judgeGasTest({ ...clean, h2sPpm: 5 }, limits).ok, true, "at the limit passes");
});

const hot = { id: "a", type: "hot", area: "U-12 rack", status: "requested", validFrom: "2026-09-20T08:00:00Z",
  validTo: "2026-09-20T18:00:00Z", requestedBy: "u1" };
const at = (iso) => ({ issuerId: "u2", now: iso, latestGasTest: clean, project: limits });

test("a permit activates only when every condition holds, and says all that do not", async () => {
  equal(activationCheck(hot, at("2026-09-20T08:10:00Z")).ok, true);
  equal(activationCheck(hot, { ...at("2026-09-20T08:10:00Z"), issuerId: "u1" }).ok, false, "issuer is not requester");
  equal(activationCheck(hot, at("2026-09-20T09:31:00Z")).ok, false, "the gas test is 121 minutes old");
  equal(activationCheck(hot, at("2026-09-20T09:30:00Z")).ok, true, "120 minutes is still valid");
  equal(activationCheck(hot, { ...at("2026-09-20T08:10:00Z"), latestGasTest: null }).ok, false);
  equal(activationCheck({ ...hot, validTo: "2026-09-20T20:01:00Z" }, at("2026-09-20T08:10:00Z")).ok, false, "over 12 h");
  const r = activationCheck({ ...hot, type: "confined_space", validTo: "2026-09-21T08:00:00Z" },
    { ...at("2026-09-20T08:10:00Z"), issuerId: "u1", project: { ...limits, hse_permit_max_hours: null } });
  equal(r.reasons.length, 3, "same person, no attendant, no maximum duration — all at once");
  equal(activationCheck({ ...hot, type: "cold" }, { ...at("2026-09-20T08:10:00Z"), latestGasTest: null }).ok, true,
    "cold work needs no gas test");
  equal(activationCheck({ ...hot, type: "electrical_isolation" }, at("2026-09-20T08:10:00Z")).ok, false, "no LOTO ref");
});

test("a permit expires at its end without anybody closing it", async () => {
  equal(permitState({ ...hot, status: "active" }, "2026-09-20T17:59:00Z"), "active");
  equal(permitState({ ...hot, status: "active" }, "2026-09-20T18:00:00Z"), "expired");
  equal(permitState(hot, "2026-09-21T00:00:00Z"), "lapsed");
  equal(permitState({ ...hot, status: "closed" }, "2026-09-21T00:00:00Z"), "closed");
});

test("hot work overlapping another open permit in the same area is SIMOPS", async () => {
  const b = { ...hot, id: "b", type: "confined_space", area: "u-12 RACK", validFrom: "2026-09-20T17:00:00Z", validTo: "2026-09-20T20:00:00Z" };
  const now = "2026-09-20T07:00:00Z";
  equal(simops([hot, b], now), [["a", "b"]]);
  equal(simops([hot, { ...b, validFrom: "2026-09-20T18:00:00Z" }], now), [], "touching ends do not overlap");
  equal(simops([hot, { ...b, validFrom: "2026-09-20T05:00:00Z", validTo: "2026-09-20T08:00:00Z" }], now), [], "either way round");
  equal(simops([hot, { ...b, area: "U-13" }], now), []);
  equal(simops([{ ...hot, type: "cold" }, b], now), [], "no hot work, no SIMOPS flag");
  equal(simops([hot, { ...b, status: "closed" }], now), []);
});

test("an observation goes overdue past its due date; good practice never does", async () => {
  equal(observationState({ kind: "unsafe_act", dueOn: "2026-09-20" }, "2026-09-20"), "open");
  equal(observationState({ kind: "unsafe_act", dueOn: "2026-09-20" }, "2026-09-21"), "overdue");
  equal(observationState({ kind: "unsafe_act", dueOn: "2026-09-20", closedOn: "2026-09-22" }, "2026-09-25"), "closed");
  equal(observationState({ kind: "good_practice" }, "2026-09-25"), "closed");
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "hse-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const contractors = await import("../../lib/db/repos/contractors.mjs");
const hse = await import("../../lib/db/repos/hse.mjs");
const { missingInformation } = await import("../../lib/db/repos/assumptions.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const proj = await projects.createProject(db, { code: "H120", name: "H120", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const P = proj.id;
let civ, mech, inc, permit;

await withProject(db, P, async () => {
  civ = await contractors.upsertContractor(db, { projectId: P, code: "CIV", name: "Civil Co" });
  mech = await contractors.upsertContractor(db, { projectId: P, code: "MEC", name: "Mech Co" });
});

test("the reporting view gives the engine's class on every combination", async () => {
  await withProject(db, P, async () => {
    const vals = { injured: [true, false, null], fatal: [true, false, null], days: [0, 2, null],
      restricted: [0, 3, null], treatment: ["none", "first_aid", "medical", null] };
    let k = 0;
    for (const injured of vals.injured) for (const fatal of vals.fatal) for (const daysAway of vals.days)
      for (const restrictedDays of vals.restricted) for (const treatment of vals.treatment) {
        await hse.reportIncident(db, { projectId: P, refNo: `M-${k++}`, occurredAt: "2025-01-01T00:00:00Z",
          description: "matrix", injured, fatal, daysAway, restrictedDays, treatment });
      }
    const { rows } = await db.query(
      `SELECT i.ref_no, v.incident_class FROM hse_incident i JOIN reporting.fact_hse_incident v ON v.incident_key = i.id
        WHERE i.ref_no LIKE 'M-%'`);
    const engine = Object.fromEntries((await hse.listIncidents(db, { projectId: P })).map((i) => [i.ref_no, i.cls]));
    equal(rows.length, 324);
    const differ = rows.filter((r) => (r.incident_class ?? null) !== engine[r.ref_no]).map((r) => r.ref_no);
    equal(differ, [], "SQL and JS disagree");
    await db.query("SELECT 1"); // the matrix stays; it is outside every date range below
  });
});

test("man-hours: one figure per contractor per day, a second entry corrects it", async () => {
  await withProject(db, P, async () => {
    await hse.recordManhours(db, { projectId: P, contractorId: civ.id, workDate: "2026-09-01", hours: 900, headcount: 100 });
    await hse.recordManhours(db, { projectId: P, contractorId: civ.id, workDate: "2026-09-01", hours: 1000, headcount: 100 });
    await hse.recordManhours(db, { projectId: P, contractorId: mech.id, workDate: "2026-09-01", hours: 400_000 / 1, headcount: 20_000 });
    await hse.recordManhours(db, { projectId: P, workDate: "2026-09-02", hours: 99_000 });
    await throws(() => hse.recordManhours(db, { projectId: P, contractorId: civ.id, workDate: "2026-09-03",
      hours: 250, headcount: 10 }), "INVALID_INPUT", "25 h a head is not a day");
    const { rows } = await db.query("SELECT count(*)::int AS n FROM hse_manhours WHERE contractor_id = $1", [civ.id]);
    equal(rows[0].n, 1);
  });
});

test("an incident's class moves with its facts, and every change is kept with its reason", async () => {
  await withProject(db, P, async () => {
    inc = await hse.reportIncident(db, { projectId: P, refNo: "INC-001", occurredAt: "2026-09-01T10:00:00Z",
      area: "U-12", contractorId: mech.id, description: "hand caught at flange", injured: true, fatal: false,
      daysAway: 0, restrictedDays: 0, treatment: "medical", userId: alice.id });
    equal(inc.cls, "MTC");
    await throws(() => hse.updateIncident(db, { projectId: P, incidentId: inc.id, patch: { daysAway: 2 } }), "INVALID_INPUT");
    const up = await hse.updateIncident(db, { projectId: P, incidentId: inc.id, patch: { daysAway: 2 },
      reason: "doctor's note: two days off", userId: alice.id });
    equal(up.cls, "LWC");
    const h = await hse.incidentHistory(db, { projectId: P, incidentId: inc.id });
    equal([h.length, h[0].before.days_away, h[0].after.days_away], [1, 0, 2]);
    await throws(() => db.query("UPDATE hse_incident_revision SET reason = 'x'"), "permission denied");
    await throws(() => db.query("DELETE FROM hse_incident"), "permission denied");
  });
});

test("rates per contractor on their own hours, and incidents without hours are named", async () => {
  await withProject(db, P, async () => {
    await hse.reportIncident(db, { projectId: P, refNo: "INC-002", occurredAt: "2026-09-02T09:00:00Z",
      contractorId: civ.id, description: "slip", injured: true, fatal: false, daysAway: 0, restrictedDays: 2, treatment: "first_aid" });
    const other = await contractors.upsertContractor(db, { projectId: P, code: "INS", name: "Insulation Co" });
    await hse.reportIncident(db, { projectId: P, refNo: "INC-003", occurredAt: "2026-09-02T09:00:00Z",
      contractorId: other.id, description: "cut", injured: true, fatal: false, daysAway: 0, restrictedDays: 0, treatment: "first_aid" });
    const s = await hse.statistics(db, { projectId: P, from: "2026-09-01", to: "2026-09-30", today: "2026-09-25" });
    equal([s.hours, s.lti, s.recordable], [500_000, 1, 2]);
    equal([s.ltif.iogp, s.trir.iogp, s.trir.osha], [2, 4, 0.8]);
    const mec = s.byContractor.find((c) => c.code === "MEC");
    equal([mec.hours, mec.lti, mec.ltif.iogp], [400_000, 1, 2.5]);
    equal(s.incidentsWithoutHours, ["INC-003"]);
    equal([s.lastLti, s.daysSinceLti], ["2026-09-01", 24]);
  });
});

const T0 = "2026-09-20T08:00:00Z";

test("a hot-work permit is not issued against limits nobody set", async () => {
  await withProject(db, P, async () => {
    permit = await hse.requestPermit(db, { projectId: P, permitNo: "HW-001", type: "hot", area: "U-12 rack",
      description: "weld shoe on 10-P-101", contractorId: mech.id, validFrom: T0, validTo: "2026-09-20T18:00:00Z", userId: alice.id });
    const g = await hse.recordGasTest(db, { projectId: P, permitId: permit.id, testedAt: "2026-09-20T07:40:00Z",
      o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0 });
    equal(g.verdict.ok, null);
    const e = await throws(() => hse.activatePermit(db, { projectId: P, permitId: permit.id, userId: bob.id, now: "2026-09-20T08:05:00Z" }),
      "INVALID_INPUT");
    assert(/حدود تست گاز/.test(e.message) && /حداکثر مدت/.test(e.message), e.message);
    const miss = (await missingInformation(db, { projectId: P })).filter((m) => m.key.startsWith("hse-"));
    equal(miss.map((m) => [m.key, m.count]), [["hse-gas", 1], ["hse-duration", 1]], "and the missing list says why");
    await projects.updateProjectProfile(db, { projectId: P, patch: { ...limits } });
    equal((await missingInformation(db, { projectId: P })).filter((m) => m.key.startsWith("hse-")).length, 0);
  });
});

test("a failed gas test holds the permit; a fresh pass by another person issues it", async () => {
  await withProject(db, P, async () => {
    await hse.recordGasTest(db, { projectId: P, permitId: permit.id, testedAt: "2026-09-20T07:50:00Z",
      o2Pct: 20.9, lelPct: 3, h2sPpm: 0, coPpm: 0 });
    let e = await throws(() => hse.activatePermit(db, { projectId: P, permitId: permit.id, userId: bob.id, now: "2026-09-20T08:05:00Z" }),
      "INVALID_INPUT");
    assert(/LEL/.test(e.message), "the latest test decides, not the earlier clean one");
    await hse.recordGasTest(db, { projectId: P, permitId: permit.id, testedAt: "2026-09-20T08:02:00Z",
      o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0 });
    e = await throws(() => hse.activatePermit(db, { projectId: P, permitId: permit.id, userId: alice.id, now: "2026-09-20T08:05:00Z" }),
      "INVALID_INPUT");
    assert(/یک نفرند/.test(e.message));
    const a = await hse.activatePermit(db, { projectId: P, permitId: permit.id, userId: bob.id, now: "2026-09-20T08:05:00Z" });
    equal([a.status, a.issued_by], ["active", bob.id]);
    await throws(() => db.query("UPDATE hse_gas_test SET lel_pct = 0"), "permission denied");
  });
});

test("the board flags SIMOPS and shows expiry without anybody closing the permit", async () => {
  await withProject(db, P, async () => {
    await hse.requestPermit(db, { projectId: P, permitNo: "CS-001", type: "confined_space", area: "u-12 RACK",
      description: "enter drain pit", validFrom: "2026-09-20T14:00:00Z", validTo: "2026-09-20T20:00:00Z", userId: alice.id });
    let list = await hse.listPermits(db, { projectId: P, now: "2026-09-20T12:00:00Z" });
    equal(list.find((p) => p.permit_no === "HW-001").simopsWith, ["CS-001"]);
    const cs = list.find((p) => p.permit_no === "CS-001");
    assert(cs.readiness.reasons.some((r) => /نگهبان/.test(r)), "the standby person is named before entry");
    list = await hse.listPermits(db, { projectId: P, now: "2026-09-20T18:00:00Z" });
    equal(list.find((p) => p.permit_no === "HW-001").state, "expired");
  });
});

test("a closed permit takes no more gas tests; a request is cancelled, not closed", async () => {
  await withProject(db, P, async () => {
    await hse.closePermit(db, { projectId: P, permitId: permit.id, userId: bob.id, now: "2026-09-20T17:00:00Z" });
    await throws(() => hse.recordGasTest(db, { projectId: P, permitId: permit.id, testedAt: "2026-09-20T17:10:00Z",
      o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0 }), "INVALID_INPUT");
    const cs = (await hse.listPermits(db, { projectId: P })).find((p) => p.permit_no === "CS-001");
    await throws(() => hse.closePermit(db, { projectId: P, permitId: cs.id }), "INVALID_INPUT");
    equal((await hse.closePermit(db, { projectId: P, permitId: cs.id, cancel: true })).status, "cancelled");
  });
});

test("an unsafe observation needs an action and a date, and goes overdue", async () => {
  await withProject(db, P, async () => {
    await throws(() => hse.recordObservation(db, { projectId: P, observedOn: "2026-09-10", kind: "unsafe_condition",
      severity: "high", description: "missing handrail" }), "INVALID_INPUT");
    const o = await hse.recordObservation(db, { projectId: P, observedOn: "2026-09-10", kind: "unsafe_condition",
      severity: "high", area: "PR-1201", description: "missing handrail", action: "install handrail", dueOn: "2026-09-12" });
    await hse.recordObservation(db, { projectId: P, observedOn: "2026-09-11", kind: "good_practice",
      description: "barricade around radiography" });
    let list = await hse.listObservations(db, { projectId: P, today: "2026-09-25" });
    equal(list.map((x) => x.state).sort(), ["closed", "overdue"]);
    await throws(() => hse.closeObservation(db, { projectId: P, observationId: o.id, closedOn: "2026-09-13" }), "INVALID_INPUT");
    await hse.closeObservation(db, { projectId: P, observationId: o.id, closedOn: "2026-09-13", note: "handrail fitted" });
    list = await hse.listObservations(db, { projectId: P, today: "2026-09-25" });
    equal(list.map((x) => x.state), ["closed", "closed"]);
  });
});

test("HSE records belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await hse.listIncidents(db, { projectId: other.id })).length, 0);
    equal((await hse.listPermits(db, { projectId: other.id })).length, 0);
  });
});

await run();
