#!/usr/bin/env node
/**
 * Performance test: guarantees read as the contract writes them, a test
 * only after start-up is certified, verdicts computed not entered, a
 * signed test fixed, and a guarantee's standing from its latest accepted
 * test.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  guaranteeProblems, judgeResult, testProblems, signProblems, guaranteeStatus,
} from "../../lib/completions/performance.mjs";

// ── the rules ────────────────────────────────────────────────────────────

const CAP = { id: "g1", code: "PG-01", uom: "kt/a", direction: "min", guaranteedValue: 500, minDurationH: null };
const SEC = { id: "g2", code: "PG-02", uom: "GJ/t", direction: "max", guaranteedValue: 14, minDurationH: 72 };

test("a guarantee states its parameter, unit, direction, value and clause", async () => {
  equal(guaranteeProblems({ code: "PG-01", parameter: "Ethylene capacity", uom: "kt/a", direction: "min", guaranteedValue: 500,
    basis: "Contract Annex G §2.1" }), []);
  equal(guaranteeProblems({ code: "P", parameter: "", uom: "", direction: "around", guaranteedValue: "lots", basis: "" }).length, 6);
  equal(guaranteeProblems({ code: "PG-02", parameter: "x", uom: "y", direction: "max", guaranteedValue: 1, basis: "b", minDurationH: 0 }).length, 1);
});

test("a result is judged against the guarantee as written, and over the contract's duration when it states one", async () => {
  equal(judgeResult(CAP, 512, 10), { ok: true });
  equal(judgeResult(CAP, 500, 10), { ok: true }, "exactly the guaranteed value meets a minimum");
  assert(/کمتر از 500/.test(judgeResult(CAP, 499.9, 10).reason));
  equal(judgeResult(SEC, 13.8, 72), { ok: true });
  equal(judgeResult(SEC, 14, 80).ok, true, "exactly the value meets a maximum");
  assert(/بیشتر از 14/.test(judgeResult(SEC, 14.2, 80).reason));
  const short = judgeResult(SEC, 13.8, 48);
  equal(short.ok, false, "a good value over too short a test proves nothing");
  assert(/دست‌کم 72 ساعت/.test(short.reason), short.reason);
  equal(judgeResult(CAP, null, 10).ok, null);
  equal(judgeResult(CAP, "", 10).ok, null);
});

test("a test waits for every subsystem in its scope to have its RFSU accepted", async () => {
  const ok = { scope: [{ code: "21-01", rfsuAccepted: true }], startedAt: "2026-09-01T00:00:00Z", endedAt: "2026-09-04T00:00:00Z" };
  equal(testProblems(ok), []);
  equal(testProblems({ ...ok, scope: [] }).length, 1, "a unit with no subsystem cannot be judged");
  const p = testProblems({ ...ok, scope: [...ok.scope, { code: "21-02", rfsuAccepted: false }] });
  assert(/21-02/.test(p[0]) && !/21-01/.test(p[0]), p[0]);
  equal(testProblems({ ...ok, endedAt: ok.startedAt }).length, 1);
  equal(testProblems({ ...ok, now: "2026-09-02T00:00:00Z" }).length, 1, "not ended in the future");
});

test("a test is signed only with every guarantee in scope measured", async () => {
  equal(signProblems({ guarantees: [], results: [] }).length, 1);
  equal(signProblems({ guarantees: [CAP, SEC], results: [{ guaranteeId: "g1" }] }), ["اندازه‌گیری نشده: PG-02"]);
  equal(signProblems({ guarantees: [CAP, SEC], results: [{ guaranteeId: "g1" }, { guaranteeId: "g2" }] }), []);
});

test("a guarantee stands on its latest accepted test; an unaccepted one does not count", async () => {
  const t = (id, end, acceptedAt, results) => ({ id, startedAt: "2026-09-01T00:00:00Z", endedAt: end, acceptedAt, results });
  const failed = t("t1", "2026-09-04T00:00:00Z", "2026-09-05", [{ guaranteeId: "g1", measured: 480 }]);
  const retest = t("t2", "2026-09-10T00:00:00Z", "2026-09-11", [{ guaranteeId: "g1", measured: 505 }]);
  const pending = t("t3", "2026-09-20T00:00:00Z", null, [{ guaranteeId: "g1", measured: 450 }]);
  equal(guaranteeStatus([CAP, SEC], [failed]).map((s) => s.status), ["not_met", "untested"]);
  equal(guaranteeStatus([CAP], [pending, retest, failed])[0].status, "met", "the retest decides; the unaccepted one does not");
  equal(guaranteeStatus([CAP], [pending])[0].status, "untested");
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "perf-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const pf = await import("../../lib/db/repos/performance.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const proj = await projects.createProject(db, { code: "PERF", name: "P", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "PERF2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
const at = (d, h = 0) => new Date(Date.UTC(2026, 8, d, h)).toISOString();
let u21, s1, s2, cap, sec, purity, t1;

await inP(async () => {
  const { rows: [u] } = await db.query("INSERT INTO unit (project_id, code, name) VALUES ($1,'21','Compression') RETURNING *", [P]);
  u21 = u;
  s1 = await spine.upsertSubsystem(db, { projectId: P, code: "21-01", systemCode: "21", unitId: u21.id });
  s2 = await spine.upsertSubsystem(db, { projectId: P, code: "60-01", systemCode: "60" });
});
const rfsu = (sub) => db.query(
  "INSERT INTO rfsu_certificate (project_id, subsystem_id, snapshot, signed_by, accepted_by, accepted_at) VALUES ($1,$2,'{}',$3,$4,now())",
  [P, sub.id, alice.id, bob.id]);

test("guarantees are the contract's: per unit or for the plant", async () => {
  await inP(async () => {
    cap = await pf.upsertGuarantee(db, { projectId: P, code: "pg-01", parameter: "Cracked gas compression capacity", unitId: u21.id,
      uom: "t/h", direction: "min", guaranteedValue: 212, basis: "Contract Annex G §2.1" });
    sec = await pf.upsertGuarantee(db, { projectId: P, code: "PG-02", parameter: "Specific energy consumption", unitId: u21.id,
      uom: "GJ/t", direction: "max", guaranteedValue: 14, minDurationH: 72, basis: "Annex G §2.4" });
    purity = await pf.upsertGuarantee(db, { projectId: P, code: "PG-10", parameter: "Ethylene purity", uom: "mol%",
      direction: "min", guaranteedValue: 99.95, basis: "Annex G §1.2" });
    equal(cap.code, "PG-01");
    await throws(() => pf.upsertGuarantee(db, { projectId: P, code: "PG-03", parameter: "x", uom: "y", direction: "about",
      guaranteedValue: 1, basis: "b" }), "INVALID_INPUT");
  });
});

test("no test before start-up is certified for every subsystem in scope", async () => {
  await inP(async () => {
    await throws(() => pf.recordTest(db, { projectId: P, testNo: "PT-21-01", unitId: u21.id, startedAt: at(1), endedAt: at(3),
      userId: alice.id }), "21-01");
    await rfsu(s1);
    await throws(() => pf.recordTest(db, { projectId: P, testNo: "PT-PLANT-01", startedAt: at(1), endedAt: at(3), userId: alice.id }),
      "60-01", "the plant waits for its utilities too");
    t1 = await pf.recordTest(db, { projectId: P, testNo: "pt-21-01", unitId: u21.id, startedAt: at(1), endedAt: at(3), userId: alice.id });
    equal(t1.test_no, "PT-21-01");
  });
});

test("results are for the test's own scope; a test is signed complete, then fixed", async () => {
  await inP(async () => {
    await throws(() => pf.recordResult(db, { projectId: P, testId: t1.id, guaranteeId: purity.id, measured: 99.97 }), "محدودهٔ");
    await throws(() => pf.recordResult(db, { projectId: P, testId: t1.id, guaranteeId: cap.id, measured: "a lot" }), "INVALID_INPUT");
    await pf.recordResult(db, { projectId: P, testId: t1.id, guaranteeId: cap.id, measured: 208, method: "FT-2101 totaliser" });
    await throws(() => pf.signTest(db, { projectId: P, testId: t1.id, userId: alice.id }), "PG-02");
    await pf.recordResult(db, { projectId: P, testId: t1.id, guaranteeId: sec.id, measured: 13.6 });
    await pf.recordResult(db, { projectId: P, testId: t1.id, guaranteeId: cap.id, measured: 209 });
    await pf.signTest(db, { projectId: P, testId: t1.id, userId: alice.id });
    await throws(() => pf.recordResult(db, { projectId: P, testId: t1.id, guaranteeId: cap.id, measured: 215 }), "INVALID_INPUT");
    await throws(() => db.query("UPDATE performance_result SET measured = 215 WHERE test_id = $1", [t1.id]), "fixed", "the database too");
    await throws(() => pf.acceptTest(db, { projectId: P, testId: t1.id, userId: alice.id }), "امضاکننده");
    await pf.acceptTest(db, { projectId: P, testId: t1.id, userId: bob.id });
    const b = await pf.performanceBoard(db, { projectId: P });
    const st = Object.fromEntries(b.status.map((s) => [s.code, s.status]));
    equal(st, { "PG-10": "untested", "PG-01": "not_met", "PG-02": "not_met" }, "209 < 212; 13.6 GJ/t over 48 h is not the 72 h the contract asks");
    assert(/72/.test(b.status.find((s) => s.code === "PG-02").reason));
    equal(b.tests[0].durationH, 48);
  });
});

test("the retest is a new test; the guarantee's terms stay what it was judged against", async () => {
  await inP(async () => {
    const t2 = await pf.recordTest(db, { projectId: P, testNo: "PT-21-02", unitId: u21.id, startedAt: at(10), endedAt: at(13, 6), userId: alice.id });
    await pf.recordResult(db, { projectId: P, testId: t2.id, guaranteeId: cap.id, measured: 213.5 });
    await pf.recordResult(db, { projectId: P, testId: t2.id, guaranteeId: sec.id, measured: 13.7 });
    await pf.signTest(db, { projectId: P, testId: t2.id, userId: alice.id });
    let b = await pf.performanceBoard(db, { projectId: P });
    equal(b.status.find((s) => s.code === "PG-01").status, "not_met", "signed but not yet accepted: the accepted test still stands");
    await pf.acceptTest(db, { projectId: P, testId: t2.id, userId: bob.id });
    b = await pf.performanceBoard(db, { projectId: P });
    equal(b.status.filter((s) => s.code !== "PG-10").map((s) => s.status), ["met", "met"]);
    await throws(() => pf.upsertGuarantee(db, { projectId: P, code: "PG-01", parameter: "Cracked gas compression capacity", unitId: u21.id,
      uom: "t/h", direction: "min", guaranteedValue: 200, basis: "Contract Annex G §2.1" }), "عوض نمی‌شود");
    await pf.upsertGuarantee(db, { projectId: P, code: "PG-01", parameter: "Cracked-gas compressor capacity", unitId: u21.id,
      uom: "t/h", direction: "min", guaranteedValue: 212, basis: "Contract Annex G §2.1 (Rev B)" });
    await throws(() => db.query("UPDATE performance_guarantee SET guaranteed_value = 200 WHERE id = $1", [cap.id]), "terms are fixed");
    // Since 049 an unsigned test entered by mistake can be deleted; a signed one never (db/test/removal.mjs).
    await throws(() => db.query("DELETE FROM performance_test"), "never deleted");
  });
});

test("performance records belong to one project", async () => {
  await withProject(db, other.id, async () => {
    const b = await pf.performanceBoard(db, { projectId: other.id });
    equal([b.guarantees.length, b.tests.length], [0, 0]);
    await throws(() => pf.signTest(db, { projectId: other.id, testId: t1.id, userId: alice.id }), "not found");
  });
});

await run();
