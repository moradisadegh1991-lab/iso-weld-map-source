#!/usr/bin/env node
/**
 * NDT of support, structural and equipment welds — the project's NDT
 * matrix, the joint register, samples, and the chain steps that read them.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ruleProblems, jointCompliance } from "../../lib/ndt/joints.mjs";

// ── the rules ────────────────────────────────────────────────────────────

test("a matrix rule needs a basis, and a volumetric method needs a groove", async () => {
  const ok = { scope: "structural", jointType: "cjp", method: "UT", percent: 10, extension: "full", basis: "Spec 01-ST-005 §7.3" };
  equal(ruleProblems(ok), []);
  equal(ruleProblems({ ...ok, basis: " " }).length, 1, "no percentage without its clause");
  equal(ruleProblems({ ...ok, jointType: "fillet" }).length, 1, "UT on a fillet weld");
  equal(ruleProblems({ ...ok, method: "RT", jointType: "fillet" }).length, 1);
  equal(ruleProblems({ ...ok, method: "MT", jointType: "fillet" }), []);
  equal(ruleProblems({ ...ok, percent: 0 }).length, 1);
  equal(ruleProblems({ ...ok, scope: "piping" }).length, 1, "piping has its own requirement engine");
});

const J = (id, o = {}) => ({ id, scope: "structural", jointType: "cjp", group: "tag:T", welderId: "A", welded: true, ...o });
const R = (jointId, method, result, at, o = {}) => ({ jointId, method, result, repairCycle: 0, at, ...o });
const sel = (method, ids) => [{ group: "tag:T", jointType: "cjp", method, selectedIds: ids, createdAt: "2026-09-01" }];
const VT = { scope: "structural", jointType: "cjp", method: "VT", percent: 100 };

test("a joint is complete when every method of its rules is met; no rule is unknown, not complete", async () => {
  const matrix = [VT, { scope: "structural", jointType: "cjp", method: "UT", percent: 100 }];
  let c = jointCompliance({ joints: [J("a")], matrix, records: [R("a", "VT", "accept", "1")] });
  equal([c.get("a").status, c.get("a").done], ["awaiting", false], "UT still owed");
  c = jointCompliance({ joints: [J("a")], matrix, records: [R("a", "VT", "accept", "1"), R("a", "UT", "accept", "2")] });
  equal([c.get("a").status, c.get("a").done], ["accepted", true]);
  c = jointCompliance({ joints: [J("f", { jointType: "fillet" })], matrix });
  equal([c.get("f").status, c.get("f").done], ["unknown", false]);
  equal(jointCompliance({ joints: [J("n", { welded: false })], matrix }).get("n").status, "not_welded");
});

test("a rejected random sample leads where the matrix says: every joint, or unknown when unstated", async () => {
  const joints = ["s", "u1", "u2"].map((i) => J(i));
  const rule = (extension) => [{ scope: "structural", jointType: "cjp", method: "UT", percent: 10, extension }];
  const recs = [R("s", "UT", "reject", "1")];
  equal(jointCompliance({ joints, matrix: rule("full"), selections: sel("UT", ["s"]), records: recs }).get("u1").status, "full_examination");
  equal(jointCompliance({ joints, matrix: rule(null), selections: sel("UT", ["s"]), records: recs }).get("u1").status, "extension_unknown");
  equal(jointCompliance({ joints, matrix: rule("progressive"), selections: sel("UT", ["s"]), records: recs }).get("u1").methods[0].lot.drawNeeded.count, 2);
  equal(jointCompliance({ joints, matrix: rule("full"), selections: sel("UT", ["s"]), records: [R("s", "UT", "accept", "1")] }).get("u2").status,
    "accepted", "sample passed: the lot is accepted");
});

test("lots are per group, joint type and welder", async () => {
  const joints = [J("a1"), J("a2"), J("b1", { group: "tag:U" }), J("b2", { group: "tag:U" })];
  const matrix = [{ scope: "structural", jointType: "cjp", method: "UT", percent: 10, extension: "full" }];
  const selections = [...sel("UT", ["a1"]), { group: "tag:U", jointType: "cjp", method: "UT", selectedIds: ["b1"], createdAt: "2026-09-01" }];
  const c = jointCompliance({ joints, matrix, selections, records: [R("a1", "UT", "reject", "1"), R("b1", "UT", "accept", "2")] });
  equal([c.get("a2").status, c.get("b2").status], ["full_examination", "accepted"]);
});

// ── against the database ─────────────────────────────────────────────────

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "jndt-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const steel = await import("../../lib/db/repos/structural.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const exec = await import("../../lib/db/repos/execution.mjs");
const pex = await import("../../lib/db/repos/piping-execution.mjs");
const jn = await import("../../lib/db/repos/joint-ndt.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "JND", name: "J", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
const D = (k) => `2026-09-${String(k).padStart(2, "0")}`;
const step = (s, code) => s.steps.find((x) => x.code === code);
let rack, vessel, w1, w2, sup, lineId;

await inP(async () => {
  rack = await steel.upsertStructure(db, { projectId: P, tagNo: "PR-01", structureType: "platform", columns: 2, boltedJoints: 4, fireproofingRequired: false });
  vessel = await spine.upsertTag(db, { projectId: P, tagNo: "C-2101", discipline: "equipment", kind: "static" });
  w1 = await exec.upsertWelder(db, { projectId: P, stampNo: "S-01", name: "Structural welder 1" });
  w2 = await exec.upsertWelder(db, { projectId: P, stampNo: "S-02", name: "Structural welder 2" });
  ({ rows: [{ id: lineId }] } = await db.query("INSERT INTO line (project_id, line_no) VALUES ($1,'8-P-1') RETURNING id", [P]));
  sup = await pex.upsertSupport(db, { projectId: P, supportNo: "T-01", kind: "shoe", lineId });
});

test("no field weld registered: the structure's weld NDT step does not apply, and says so", async () => {
  await inP(async () => {
    const s = step(await acts.tagStatus(db, { projectId: P, tagId: rack.id }), "weld_ndt");
    equal(s.na, true);
    assert(/ثبت نشده/.test(s.note.text));
  });
});

let joints;
test("the matrix is the specification's; a joint is registered against the right kind of tag", async () => {
  await inP(async () => {
    await throws(() => jn.setRule(db, { projectId: P, scope: "structural", jointType: "fillet", method: "UT", percent: 10, basis: "x" }), "INVALID_INPUT");
    await throws(() => db.query(`INSERT INTO ndt_matrix_rule (project_id, scope, joint_type, method, percent, basis)
      VALUES ($1,'structural','fillet','RT',10,'x')`, [P]), "ndt_rule_volumetric_groove", "the database says so too");
    await jn.setRule(db, { projectId: P, scope: "structural", jointType: "cjp", method: "VT", percent: 100, basis: "Spec ST-005 §7.1", userId: alice.id });
    await jn.setRule(db, { projectId: P, scope: "structural", jointType: "cjp", method: "UT", percent: 20, extension: "full", basis: "Spec ST-005 §7.3", userId: alice.id });
    await jn.setRule(db, { projectId: P, scope: "support", jointType: "fillet", method: "MT", percent: 100, basis: "Spec PI-020 §9", userId: alice.id });
    await jn.setRule(db, { projectId: P, scope: "equipment", jointType: "cjp", method: "RT", percent: 100, basis: "Vessel drawing, field seam", userId: alice.id });
    await throws(() => jn.upsertJoint(db, { projectId: P, scope: "structural", jointNo: "X", tagId: vessel.id, jointType: "cjp" }), "INVALID_INPUT",
      "a structural weld on an equipment tag");
    joints = [];
    for (let k = 1; k <= 5; k++) joints.push(await jn.upsertJoint(db, { projectId: P, scope: "structural", jointNo: `pr-01-cjp-${k}`, tagId: rack.id, jointType: "cjp", thicknessMm: 16 }));
    equal(joints[0].joint_no, "PR-01-CJP-1");
  });
});

test("NDT is recorded on a welded joint, the cycle is derived, a reject names its defect", async () => {
  await inP(async () => {
    await throws(() => jn.recordJointNdt(db, { projectId: P, jointId: joints[0].id, method: "VT", result: "accept" }), "INVALID_INPUT", "not welded");
    for (const [k, j] of joints.entries()) await jn.recordJointWeld(db, { projectId: P, jointId: j.id, welderId: k < 3 ? w1.id : w2.id, weldedOn: D(5) });
    await throws(() => jn.recordJointNdt(db, { projectId: P, jointId: joints[0].id, method: "UT", result: "reject" }), "INVALID_INPUT");
    const r0 = await jn.recordJointNdt(db, { projectId: P, jointId: joints[0].id, method: "VT", result: "reject", defectType: "undercut", userId: alice.id });
    const r1 = await jn.recordJointNdt(db, { projectId: P, jointId: joints[0].id, method: "VT", result: "accept", userId: alice.id });
    equal([r0.repair_cycle, r1.repair_cycle], [0, 1]);
    await throws(() => jn.recordJointWeld(db, { projectId: P, jointId: joints[0].id, welderId: w2.id, weldedOn: D(6) }), "INVALID_INPUT",
      "the welder of an examined joint stays");
    await throws(() => db.query("DELETE FROM joint_ndt_record"), "permission denied");
  });
});

test("the sample is drawn from the group; drawing again over the same welds gives the same sample", async () => {
  await inP(async () => {
    let b = await jn.jointBoard(db, { projectId: P });
    equal(b.needSample.map((x) => [x.method, x.percent]), [["UT", 20]]);
    const g = b.needSample[0];
    const s1 = await jn.drawJointSample(db, { projectId: P, group: g.group, jointType: "cjp", method: "UT", userId: alice.id });
    const s2 = await jn.drawJointSample(db, { projectId: P, group: g.group, jointType: "cjp", method: "UT", userId: alice.id });
    equal(s1.jointNos, s2.jointNos, "same population, same seed, same sample");
    equal(s1.jointNos.length, 2, "20% of five is one, but each welder is sampled once");
    await throws(() => jn.drawJointSample(db, { projectId: P, group: g.group, jointType: "cjp", method: "VT", userId: alice.id }), "INVALID_INPUT",
      "VT is 100%: nothing to draw");
    for (const j of joints) await jn.recordJointNdt(db, { projectId: P, jointId: j.id, method: "VT", result: "accept", userId: alice.id });
    const byNo = Object.fromEntries(joints.map((j) => [j.joint_no, j.id]));
    let s = step(await acts.tagStatus(db, { projectId: P, tagId: rack.id }), "weld_ndt");
    equal(s.status, "in_progress");
    // Welder S-02's sampled joint is rejected: the matrix says every joint of that lot.
    const s02 = s1.jointNos.find((n) => ["PR-01-CJP-4", "PR-01-CJP-5"].includes(n));
    const s01 = s1.jointNos.find((n) => n !== s02);
    await jn.recordJointNdt(db, { projectId: P, jointId: byNo[s01], method: "UT", result: "accept", userId: alice.id });
    await jn.recordJointNdt(db, { projectId: P, jointId: byNo[s02], method: "UT", result: "reject", defectType: "lack of fusion", userId: alice.id });
    b = await jn.jointBoard(db, { projectId: P });
    const other = ["PR-01-CJP-4", "PR-01-CJP-5"].find((n) => n !== s02);
    equal(b.joints.find((j) => j.jointNo === other).status, "full_examination");
    equal(b.joints.filter((j) => j.done).length, 3, "S-01's lot is accepted by its sample");
    await jn.recordJointNdt(db, { projectId: P, jointId: byNo[s02], method: "UT", result: "accept", userId: alice.id });
    await jn.recordJointNdt(db, { projectId: P, jointId: byNo[other], method: "UT", result: "accept", userId: alice.id });
    s = step(await acts.tagStatus(db, { projectId: P, tagId: rack.id }), "weld_ndt");
    equal(s.status, "done");
  });
});

test("painting waits for the weld NDT; a support is not inspected over open attachment welds", async () => {
  await inP(async () => {
    const { chainFor } = await import("../../lib/platform/precedence.mjs");
    assert(chainFor("structure").find((x) => x.code === "painting").after.includes("weld_ndt"));
    assert(chainFor("fired").find((x) => x.code === "coil_test").after.includes("weld_ndt"), "coil NDT before its hydrotest");
    const j = await jn.upsertJoint(db, { projectId: P, scope: "support", jointNo: "T-01-A", supportId: sup.id, jointType: "fillet" });
    await pex.markSupport(db, { projectId: P, supportId: sup.id, step: "installed", on: D(10) });
    await throws(() => pex.markSupport(db, { projectId: P, supportId: sup.id, step: "inspected", on: D(11) }), "T-01-A");
    await jn.recordJointWeld(db, { projectId: P, jointId: j.id, welderId: w1.id, weldedOn: D(10) });
    await jn.recordJointNdt(db, { projectId: P, jointId: j.id, method: "MT", result: "accept", userId: alice.id });
    await pex.markSupport(db, { projectId: P, supportId: sup.id, step: "inspected", on: D(11) });
  });
});

test("equipment field welds hold the vessel's readiness", async () => {
  await inP(async () => {
    const seam = await jn.upsertJoint(db, { projectId: P, scope: "equipment", jointNo: "C-2101-FS1", tagId: vessel.id, jointType: "cjp", thicknessMm: 22 });
    await jn.recordJointWeld(db, { projectId: P, jointId: seam.id, welderId: w2.id, weldedOn: D(12) });
    let s = step(await acts.tagStatus(db, { projectId: P, tagId: vessel.id }), "weld_ndt");
    equal(s.status, "in_progress");
    await jn.recordJointNdt(db, { projectId: P, jointId: seam.id, method: "RT", result: "accept", userId: alice.id });
    s = step(await acts.tagStatus(db, { projectId: P, tagId: vessel.id }), "weld_ndt");
    equal(s.status, "done");
  });
});

test("joints and their NDT belong to one project", async () => {
  const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: alice.id });
  await withProject(db, other.id, async () => {
    for (const t of ["ndt_matrix_rule", "weld_joint", "joint_ndt_record", "joint_ndt_selection"]) {
      equal((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0, t);
    }
  });
});

await run();
