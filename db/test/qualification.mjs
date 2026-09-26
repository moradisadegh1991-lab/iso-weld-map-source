#!/usr/bin/env node
/**
 * Welder qualification and traceability tests (EPIC-3).
 *
 * The checker decides whether a weld may be made. A wrong "yes" here is a
 * code violation that surfaces months later with the spool painted and in the
 * rack, so the cases below are written from the failure side: each one is a
 * way an unqualified weld gets made on a real site.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { diameterRange, baseThicknessRange, positionRange, continuityDeadline }
  from "../../lib/qualification/asme-ix.mjs";
import { checkAssignment } from "../../lib/qualification/check.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const welder = { stamp_no: "W-12", name: "رضایی" };
const months = (n, from = new Date("2026-09-01")) => {
  const d = new Date(from); d.setMonth(d.getMonth() + n); return d;
};
/** A 6G on 8" sch 40 pipe — the ticket a site pipe welder normally holds. */
const sixG = {
  process: "GTAW", qw_position: ["6G"],
  coupon_od_mm: 219.1, coupon_thickness_mm: 8.18, certificate_no: "WQT-001",
};
const codes = (list) => list.map((x) => x.code);

// ── the code tables ──────────────────────────────────────────────────────

test("QW-452.3 diameter bands", async () => {
  equal(diameterRange(21.3).min, 21.3, "under 1 inch qualifies that size and up");
  equal(diameterRange(60.3).min, 25.4, "1 to under 2-7/8 qualifies from 1 inch up");
  equal(diameterRange(219.1).min, 73, "2-7/8 and over qualifies from 2-7/8 up");
  equal(diameterRange(0), null);
});

test("QW-452.1 thickness is doubled below 3/8 inch and unlimited above", async () => {
  equal(baseThicknessRange(6).max, 12);
  equal(baseThicknessRange(9.5).max, Infinity);
  equal(baseThicknessRange(12).max, Infinity);
});

test("QW-461.9 position coverage", async () => {
  equal(positionRange(["6G"]).sort(), ["F", "H", "OH", "V"]);
  equal(positionRange(["5G"]).sort(), ["F", "OH", "V"], "5G does not cover horizontal");
  equal(positionRange(["1G"]), ["F"]);
  equal(positionRange(["2G", "5G"]).sort(), ["F", "H", "OH", "V"], "the pair covers everything");
});

test("QW-322.1 continuity is six months from last use", async () => {
  equal(continuityDeadline("2026-03-01").toISOString().slice(0, 10), "2026-09-01");
  equal(continuityDeadline(null), null);
});

// ── the checker, from the failure side ───────────────────────────────────

test("a welder with no qualification on file is refused", async () => {
  const v = checkAssignment({ weld: { nps: 8, process: "GTAW" }, welder, qualifications: [] });
  equal(v.ok, false);
  equal(codes(v.blocking), ["NO_QUALIFICATION"]);
});

test("a welder qualified on a different process is refused", async () => {
  const v = checkAssignment({
    weld: { nps: 8, process: "SMAW" }, welder, qualifications: [sixG],
    lastUsedByProcess: new Map([["GTAW", months(-1)]]),
  });
  equal(v.ok, false);
  equal(codes(v.blocking), ["PROCESS_NOT_QUALIFIED"]);
  assert(v.blocking[0].message.includes("GTAW"), "and says what they ARE qualified for");
});

test("a 6G ticket on 8\" pipe covers a 36\" weld", async () => {
  const v = checkAssignment({
    weld: { nps: 36, wallThicknessMm: 6.35, position: "V", process: "GTAW" },
    welder, qualifications: [sixG], weldDate: new Date("2026-09-01"),
    lastUsedByProcess: new Map([["GTAW", months(-1)]]),
  });
  equal(v.ok, true, "QW-452.3 has no upper diameter bound once the coupon is 2-7/8 or over");
  equal(v.blocking, []);
});

test("a small-bore weld below the qualified band is refused", async () => {
  const v = checkAssignment({
    weld: { nps: 0.5, odMm: 21.3, wallThicknessMm: 2.77, position: "F", process: "GTAW" },
    welder, qualifications: [sixG], weldDate: new Date("2026-09-01"),
    lastUsedByProcess: new Map([["GTAW", months(-1)]]),
  });
  equal(v.ok, false);
  assert(codes(v.blocking).includes("DIAMETER_OUT_OF_RANGE"));
  assert(v.blocking[0].clause === "QW-452.3", "and cites the clause");
});

test("thickness beyond twice a thin coupon is refused", async () => {
  const thin = { ...sixG, coupon_thickness_mm: 4 };     // qualifies to 8 mm
  const v = checkAssignment({
    weld: { nps: 8, wallThicknessMm: 12.7, position: "F", process: "GTAW" },
    welder, qualifications: [thin], weldDate: new Date("2026-09-01"),
    lastUsedByProcess: new Map([["GTAW", months(-1)]]),
  });
  equal(v.ok, false);
  assert(codes(v.blocking).includes("THICKNESS_OUT_OF_RANGE"));
});

test("a 5G welder may not make a horizontal weld", async () => {
  const fiveG = { ...sixG, qw_position: ["5G"] };
  const v = checkAssignment({
    weld: { nps: 8, wallThicknessMm: 8, position: "H", process: "GTAW" },
    welder, qualifications: [fiveG], weldDate: new Date("2026-09-01"),
    lastUsedByProcess: new Map([["GTAW", months(-1)]]),
  });
  equal(v.ok, false);
  assert(codes(v.blocking).includes("POSITION_NOT_QUALIFIED"));
});

test("continuity lapses after six months even with a valid certificate", async () => {
  // The failure a paper register never catches: the ticket says valid until
  // next year, and the welder has not touched the process since March.
  const v = checkAssignment({
    weld: { nps: 8, wallThicknessMm: 8, position: "F", process: "GTAW" },
    welder, qualifications: [{ ...sixG, expires_on: "2027-12-31" }],
    weldDate: new Date("2026-09-20"),
    lastUsedByProcess: new Map([["GTAW", "2026-03-01"]]),
  });
  equal(v.ok, false);
  const lapsed = v.blocking.find((b) => b.code === "CONTINUITY_LAPSED");
  assert(lapsed, "the continuity rule blocks");
  equal(lapsed.clause, "QW-322.1");
});

test("continuity running out inside thirty days warns without blocking", async () => {
  const v = checkAssignment({
    weld: { nps: 8, wallThicknessMm: 8, position: "F", process: "GTAW" },
    welder, qualifications: [sixG], weldDate: new Date("2026-09-01"),
    lastUsedByProcess: new Map([["GTAW", "2026-03-10"]]),   // deadline 2026-09-10
  });
  equal(v.ok, true);
  assert(codes(v.warnings).includes("CONTINUITY_EXPIRING"));
});

test("an expired certificate blocks, and one expiring soon warns", async () => {
  const base = { weld: { nps: 8, wallThicknessMm: 8, position: "F", process: "GTAW" },
                 welder, lastUsedByProcess: new Map([["GTAW", months(-1)]]),
                 weldDate: new Date("2026-09-01") };
  const expired = checkAssignment({ ...base, qualifications: [{ ...sixG, expires_on: "2026-08-01" }] });
  equal(expired.ok, false);
  assert(codes(expired.blocking).includes("QUALIFICATION_EXPIRED"));

  const soon = checkAssignment({ ...base, qualifications: [{ ...sixG, expires_on: "2026-09-20" }] });
  equal(soon.ok, true);
  assert(codes(soon.warnings).includes("QUALIFICATION_EXPIRING"));
});

test("a revoked qualification does not count at all", async () => {
  const v = checkAssignment({
    weld: { nps: 8, process: "GTAW" }, welder,
    qualifications: [{ ...sixG, revoked_at: "2026-07-01" }],
  });
  equal(v.ok, false);
  equal(codes(v.blocking), ["NO_QUALIFICATION"]);
});

test("holding two tickets means the covering one wins", async () => {
  const v = checkAssignment({
    weld: { nps: 8, wallThicknessMm: 8, position: "H", process: "GTAW" },
    welder,
    qualifications: [{ ...sixG, qw_position: ["5G"], certificate_no: "A" },
                     { ...sixG, qw_position: ["6G"], certificate_no: "B" }],
    weldDate: new Date("2026-09-01"),
    lastUsedByProcess: new Map([["GTAW", months(-1)]]),
  });
  equal(v.ok, true);
  assert(v.notes.some((n) => n.includes("B")), "and the register records which one");
});

test("missing data is reported as unverified, never as a pass", async () => {
  const v = checkAssignment({
    weld: { nps: 8, process: "GTAW" },              // no thickness, no position
    welder, qualifications: [sixG], weldDate: new Date("2026-09-01"),
    lastUsedByProcess: new Map([["GTAW", months(-1)]]),
  });
  equal(v.ok, true, "nothing in the code is violated by what IS known");
  const u = codes(v.unverified);
  assert(u.includes("NO_WALL_THICKNESS"), "but the gaps are named");
  assert(u.includes("NO_WELD_POSITION"));
  assert(u.includes("F_NUMBER_NOT_CHECKED"), "including the rule this module refuses to guess at");
  assert(u.includes("NO_WPS"));
});

test("a WPS for another process contradicts the weld", async () => {
  const v = checkAssignment({
    weld: { nps: 8, wallThicknessMm: 8, position: "F", process: "GTAW" },
    welder, qualifications: [sixG], weldDate: new Date("2026-09-01"),
    lastUsedByProcess: new Map([["GTAW", months(-1)]]),
    wps: { wps_no: "WPS-01", process: "SMAW" },
  });
  equal(v.ok, false);
  assert(codes(v.blocking).includes("WPS_PROCESS_MISMATCH"));
});

// ── persistence and the API ──────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "qual-db-"));
process.env.STORAGE_ROOT = await mkdtemp(path.join(tmpdir(), "qual-store-"));

const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const exec = await import("../../lib/db/repos/execution.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const project = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });

let welderId, qualId;

test("a welder and a qualification persist", async () => {
  await withProject(db, project.id, async () => {
    const w = await exec.upsertWelder(db, { projectId: project.id, stampNo: "W-12", name: "رضایی" });
    welderId = w.id;
    const q = await exec.addQualification(db, {
      projectId: project.id, welderId, process: "GTAW", positions: ["6G"],
      couponOdMm: 219.1, couponThicknessMm: 8.18, certificateNo: "WQT-001",
      qualifiedOn: "2026-08-01",
    });
    qualId = q.id;
    equal(q.qw_position, ["6G"]);
  });
});

test("assigning a weld outside the range is refused by the database layer too", async () => {
  await withProject(db, project.id, async () => {
    const e = await throws(() => exec.assignWeld(db, {
      projectId: project.id, weldUid: "W-aaa", welderId,
      weldedAt: "2026-09-10", process: "SMAW", nps: 8, wallThicknessMm: 8, position: "F",
    }), "NOT_QUALIFIED");
    equal(e.status, 422);
    assert(e.verdict.blocking.some((b) => b.code === "PROCESS_NOT_QUALIFIED"));
    const { rows } = await db.query("SELECT count(*) c FROM weld_execution WHERE project_id = $1",
      [project.id]);
    equal(Number(rows[0].c), 0, "and nothing was written");
  });
});

test("a valid assignment stores the verdict as it stood at the time", async () => {
  await withProject(db, project.id, async () => {
    const { execution, verdict } = await exec.assignWeld(db, {
      projectId: project.id, weldUid: "W-aaa", welderId,
      weldedAt: "2026-09-10", process: "GTAW", nps: 36, wallThicknessMm: 6.35, position: "V",
      userId: alice.id,
    });
    equal(verdict.ok, true);
    equal(execution.weld_uid, "W-aaa");
    assert(execution.qualification_verdict.unverified.length > 0,
      "an auditor asks what was known then, not what the rules say now");
  });
});

test("continuity is computed from the welds actually recorded", async () => {
  await withProject(db, project.id, async () => {
    const seen = await exec.lastUsedByProcess(db, { projectId: project.id, welderId });
    equal(seen.get("GTAW").toISOString().slice(0, 10), "2026-09-10");

    // Six months and ten days after that weld, the ticket has lapsed.
    const e = await throws(() => exec.assignWeld(db, {
      projectId: project.id, weldUid: "W-bbb", welderId,
      weldedAt: "2027-03-20", process: "GTAW", nps: 36, wallThicknessMm: 6.35, position: "V",
    }), "NOT_QUALIFIED");
    assert(e.verdict.blocking.some((b) => b.code === "CONTINUITY_LAPSED"));
  });
});

test("NDT repair cycles are numbered by the database, not by the caller", async () => {
  await withProject(db, project.id, async () => {
    const first = await exec.recordNdt(db, {
      projectId: project.id, weldUid: "W-aaa", method: "RT", result: "reject",
      defectType: "porosity", reportNo: "RT-100" });
    equal(first.repair_cycle, 0, "the first shot is cycle zero");
    const second = await exec.recordNdt(db, {
      projectId: project.id, weldUid: "W-aaa", method: "RT", result: "accept", reportNo: "RT-101" });
    equal(second.repair_cycle, 1, "the re-shot after a repair is cycle one");
    equal((await exec.ndtHistory(db, { projectId: project.id, weldUid: "W-aaa" })).length, 2);
  });
});

test("the repair rate counts first shots only", async () => {
  await withProject(db, project.id, async () => {
    const rates = await exec.repairRates(db, { projectId: project.id });
    const r = rates.find((x) => x.stampNo === "W-12");
    equal(r.shot, 1, "one weld radiographed for the first time");
    equal(r.rejected, 1);
    equal(r.repairRate, 100, "counting the passing re-shot too would have hidden the defect");
  });
});

test("welds with no NDT yet are listed, which is the handover gap found early", async () => {
  await withProject(db, project.id, async () => {
    await exec.assignWeld(db, {
      projectId: project.id, weldUid: "W-ccc", welderId,
      weldedAt: "2026-09-11", process: "GTAW", nps: 36, wallThicknessMm: 6.35, position: "V" });
    const waiting = await exec.weldsAwaitingNdt(db, { projectId: project.id });
    equal(waiting.map((w) => w.weld_uid), ["W-ccc"]);
  });
});

test("a revoked ticket immediately stops new assignments", async () => {
  await withProject(db, project.id, async () => {
    await exec.revokeQualification(db, {
      projectId: project.id, qualificationId: qualId, reason: "failed re-test" });
    const e = await throws(() => exec.assignWeld(db, {
      projectId: project.id, weldUid: "W-ddd", welderId,
      weldedAt: "2026-09-12", process: "GTAW", nps: 36, wallThicknessMm: 6.35, position: "V",
    }), "NOT_QUALIFIED");
    assert(e.verdict.blocking.some((b) => b.code === "NO_QUALIFICATION"));
  });
});

// ── the API surface ──────────────────────────────────────────────────────

const weldersRoute = await import("../../app/api/welders/route.js");
const qualRoute = await import("../../app/api/welders/[id]/qualifications/route.js");
const assignRoute = await import("../../app/api/welds/[uid]/assign/route.js");
const ndtRoute = await import("../../app/api/welds/[uid]/ndt/route.js");
const ratesRoute = await import("../../app/api/reports/repair-rates/route.js");
const { addMember } = await import("../../lib/db/repos/projects.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, { method,
    headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });

test("a welder registered through the API comes back with a resolved range", async () => {
  const w = await json(await weldersRoute.POST(req("http://x/api/welders", {
    method: "POST", body: { projectId: project.id, stampNo: "W-40", name: "کریمی" } })));
  equal(w.status, 201);
  const q = await json(await qualRoute.POST(
    req(`http://x/api/welders/${w.body.welder.id}/qualifications`, { method: "POST",
      body: { projectId: project.id, process: "SMAW", positions: ["5G"],
              couponOdMm: 168.3, couponThicknessMm: 5, certificateNo: "WQT-77" } }),
    { params: { id: w.body.welder.id } }));
  equal(q.status, 201);
  equal(q.body.range.positions.sort(), ["F", "OH", "V"], "5G, so horizontal is not covered");
  equal(q.body.range.baseThickness.max, 10, "a 5 mm coupon qualifies to 10 mm");
  globalThis.__w40 = w.body.welder.id;
});

test("a refused assignment returns 422 with the clause, not a generic error", async () => {
  const res = await json(await assignRoute.POST(
    req("http://x/api/welds/W-zzz/assign", { method: "POST",
      body: { projectId: project.id, welderId: globalThis.__w40, weldedAt: "2026-09-15",
              process: "SMAW", nps: 6, wallThicknessMm: 7.11, position: "H" } }),
    { params: { uid: "W-zzz" } }));
  equal(res.status, 422);
  equal(res.body.code, "NOT_QUALIFIED");
  const blocked = res.body.verdict.blocking.map((b) => b.code);
  assert(blocked.includes("POSITION_NOT_QUALIFIED"), "a 5G welder cannot weld horizontal");
  assert(res.body.verdict.blocking.some((b) => b.clause === "QW-461.9"),
    "and the supervisor is told which clause says so");
});

test("a viewer may not assign a weld", async () => {
  const db2 = await getDb();
  const mallory = await projects.ensureUser(db2, { subject: "kc|mallory" });
  await addMember(db2, { projectId: project.id, userId: mallory.id, role: "viewer" });
  const res = await json(await assignRoute.POST(
    req("http://x/api/welds/W-zzz/assign", { method: "POST", as: "kc|mallory",
      body: { projectId: project.id, welderId: globalThis.__w40, weldedAt: "2026-09-15" } }),
    { params: { uid: "W-zzz" } }));
  equal(res.status, 403);
});

test("NDT recorded through the API numbers its own cycles", async () => {
  const ok = await json(await assignRoute.POST(
    req("http://x/api/welds/W-eee/assign", { method: "POST",
      body: { projectId: project.id, welderId: globalThis.__w40, weldedAt: "2026-09-15",
              process: "SMAW", nps: 6, wallThicknessMm: 7.11, position: "V" } }),
    { params: { uid: "W-eee" } }));
  equal(ok.status, 201);

  for (const result of ["reject", "accept"]) {
    await ndtRoute.POST(req("http://x/api/welds/W-eee/ndt", { method: "POST",
      body: { projectId: project.id, method: "RT", result } }), { params: { uid: "W-eee" } });
  }
  const hist = await json(await ndtRoute.GET(
    req(`http://x/api/welds/W-eee/ndt?projectId=${project.id}`), { params: { uid: "W-eee" } }));
  equal(hist.body.records.map((r) => r.repair_cycle), [0, 1]);
});

test("the report names both the repair rate and the welds with no NDT at all", async () => {
  const { body } = await json(await ratesRoute.GET(
    req(`http://x/api/reports/repair-rates?projectId=${project.id}`)));
  const k = body.welders.find((w) => w.stampNo === "W-40");
  equal(k.shot, 1);
  equal(k.repairRate, 100);
  assert(Array.isArray(body.awaitingNdt), "and the handover gap is listed");
});

await run();
