#!/usr/bin/env node
/**
 * The structural module: erection tolerance, bolt pretension, and a steel
 * structure standing on civil's foundations.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  plumbCheck, surveyVerdict, minPretension, judgeBolting, boltingVerdict,
  BOLT_GRADES, STRESS_AREA,
} from "../../lib/structural/steel.mjs";

// ── plumbness ────────────────────────────────────────────────────────────

test("AISC 303 allows 1:500 of the column height, in each direction", async () => {
  const c = (dx, dy = 0) => plumbCheck({ heightMm: 6000, dxMm: dx, dyMm: dy }, "AISC303");
  equal(c(12).limitMm, 12);
  equal(c(12).ok, true, "on the limit is within it");
  equal(c(12.1).ok, false);
  equal(c(0, -12.5).ok, false, "either direction, either sign");
});

test("EN 1090-2 allows h/300 — the project's standard decides, not this file", async () => {
  const r = plumbCheck({ heightMm: 6000, dxMm: 15, dyMm: 0 }, "EN1090-2");
  equal([r.limitMm, r.ok], [20, true]);
  equal(plumbCheck({ heightMm: 6000, dxMm: 15, dyMm: 0 }, "AISC303").ok, false,
    "the same column fails 1:500");
});

test("no erection standard on the project, no verdict on any column", async () => {
  equal(plumbCheck({ heightMm: 6000, dxMm: 1, dyMm: 1 }, null).valid, false);
  const v = surveyVerdict([{ columnMark: "A1", heightMm: 6000, dxMm: 1, dyMm: 1 }], { standard: null });
  equal(v.judged, false);
  assert(/استاندارد/.test(v.reason));
});

test("a column read in one direction only is not plumb, it is unmeasured", async () => {
  // Number(null) is 0 — perfectly plumb. That is the trap this guards.
  const r = plumbCheck({ heightMm: 6000, dxMm: 3, dyMm: null }, "AISC303");
  equal(r.valid, false);
  assert(/هر دو جهت/.test(r.reason));
  equal(plumbCheck({ heightMm: 6000, dxMm: 3, dyMm: "" }, "AISC303").valid, false);
});

test("a re-shoot after correction replaces the column's earlier reading", async () => {
  const v = surveyVerdict([
    { columnMark: "A1", heightMm: 6000, dxMm: 18, dyMm: 0 },
    { columnMark: "a1 ", heightMm: 6000, dxMm: 4, dyMm: 2 },
  ], { standard: "AISC303", columns: 1 });
  equal(v.surveyed, 1);
  equal(v.out.length, 0);
  equal(v.complete, true);
});

test("without a column count, complete is unknown rather than true", async () => {
  const v = surveyVerdict([{ columnMark: "A1", heightMm: 6000, dxMm: 1, dyMm: 1 }],
    { standard: "AISC303", columns: null });
  equal(v.complete, null);
});

// ── bolt pretension ──────────────────────────────────────────────────────

test("AISC 360 Table J3.1M is 0.70·Fu·As, row by row", async () => {
  // Holds the typed table to the formula it was computed from, so a
  // mistyped row cannot survive.
  let rows = 0;
  for (const grade of ["A325M", "A490M"]) {
    for (const size of Object.keys(STRESS_AREA)) {
      const t = minPretension(grade, size);
      if (t === null) continue;
      rows++;
      const f = (0.7 * BOLT_GRADES[grade].fu * STRESS_AREA[size]) / 1000;
      assert(Math.abs(t - f) < 1, `${grade} ${size}: table ${t}, formula ${f.toFixed(1)}`);
    }
  }
  equal(rows, 14, "seven sizes in each grade");
  equal(minPretension("A325M", "M20"), 142);
  equal(minPretension("A490M", "M24"), 257);
});

test("EN 1090-2 preload is Fp,C = 0.7·fub·As", async () => {
  equal(minPretension("8.8", "M20"), 137.2);
  equal(minPretension("10.9", "M24"), 247.1);
});

test("a size the table does not list has no minimum, and none is guessed", async () => {
  equal(minPretension("A325M", "M12"), null);
  const r = judgeBolting({ jointType: "pretensioned", boltGrade: "A325M", boltSize: "M12",
    method: "turn_of_nut", joints: 4, verifiedKn: 80 });
  equal(r.valid, false);
});

const pt = (over = {}) => ({ jointType: "pretensioned", boltGrade: "A325M", boltSize: "M20",
  method: "calibrated_wrench", joints: 10, verifiedKn: 150, ...over });

test("a snug-tight joint needs no pretension and no verification", async () => {
  equal(judgeBolting({ jointType: "snug", boltGrade: "8.8", boltSize: "M16", joints: 20 }).valid, true);
});

test("a pretensioned joint with no pre-installation verification is not accepted", async () => {
  const r = judgeBolting(pt({ verifiedKn: null }));
  equal(r.valid, false);
  equal(r.target, 149.1, "1.05 × 142 kN");
});

test("RCSC verification must reach 1.05 × the minimum pretension", async () => {
  equal(judgeBolting(pt({ verifiedKn: 149 })).valid, false, "above the minimum, below the margin");
  equal(judgeBolting(pt({ verifiedKn: 149.1 })).valid, true);
});

test("EN verification must reach Fp,C", async () => {
  const en = (v) => judgeBolting({ jointType: "slip_critical", boltGrade: "8.8", boltSize: "M20",
    method: "torque", joints: 6, verifiedKn: v });
  equal(en(137.2).valid, true);
  equal(en(137).valid, false);
});

test("a tightening method from the other standard is refused", async () => {
  equal(judgeBolting(pt({ method: "torque" })).valid, false, "the EN torque method on ASTM bolts");
  equal(judgeBolting(pt({ method: null })).valid, false, "and no method at all");
  equal(judgeBolting(pt({ method: "dti" })).valid, true, "DTIs belong to both");
});

test("a failed batch is cleared only by a later valid batch of the same bolts", async () => {
  const failed = pt({ verifiedKn: 140, lotRef: "L1" });
  let v = boltingVerdict([failed, pt({ boltSize: "M24", verifiedKn: 220, lotRef: "L1" })],
    { boltedJoints: 20 });
  equal(v.failed.length, 1, "M24 bolts say nothing about the M20 lot");
  v = boltingVerdict([failed, pt({ verifiedKn: 150, lotRef: "L2" })], { boltedJoints: 20 });
  equal(v.failed.length, 1, "another lot does not clear this one");
  v = boltingVerdict([failed, pt({ verifiedKn: 150, lotRef: "L1" })], { boltedJoints: 20 });
  equal(v.failed.length, 0);
  equal(v.joints, 10, "the failed batch's joints were never validly tightened");
  equal(v.complete, false);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "steel-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const civil = await import("../../lib/db/repos/civil.mjs");
const steel = await import("../../lib/db/repos/structural.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "S110", name: "S110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const P = proj.id;

const status = (tagId) => acts.tagStatus(db, { projectId: P, tagId });
const step = (s, code) => s.steps.find((x) => x.code === code);
const tick = (tagId, code) =>
  acts.recordActivity(db, { projectId: P, tagId, code, doneAt: "2026-08-01", userId: alice.id });
const shoot = (tagId, columnMark, dxMm, dyMm = 0, surveyedOn = "2026-08-10") =>
  steel.recordPlumbReading(db, { projectId: P, tagId, columnMark, heightMm: 6000, dxMm, dyMm, surveyedOn });
const bolt = (tagId, over = {}) => steel.recordBolting(db, { projectId: P, tagId,
  jointType: "pretensioned", boltGrade: "A325M", boltSize: "M20", method: "calibrated_wrench",
  joints: 24, verifiedKn: 152, inspectedOn: "2026-08-12", ...over });

let rack, deck;

test("a pipe rack stands on civil's foundations, which answer its first step", async () => {
  await withProject(db, P, async () => {
    rack = await steel.upsertStructure(db, { projectId: P, tagNo: "PR-21", structureType: "pipe_rack",
      columns: 2, boltedJoints: 48, fireproofingRequired: true });
    await civil.upsertFoundation(db, { projectId: P, tagNo: "FDN-PR-01", carriesTagId: rack.id,
      concreteClass: "C30", fcMpa: 30 });
    const s = await status(rack.id);
    equal(step(s, "foundation").derived, true);
    equal(step(s, "foundation").status, "not_started", "nothing poured yet");
    await throws(() => tick(rack.id, "foundation"), "INVALID_INPUT");
  });
});

test("plumb and bolting come from the survey and the records, never a tick", async () => {
  await withProject(db, P, async () => {
    for (const code of ["plumb", "bolting"]) await throws(() => tick(rack.id, code), "INVALID_INPUT");
  });
});

test("an unknown structure type and a one-direction reading are refused", async () => {
  await withProject(db, P, async () => {
    await throws(() => steel.upsertStructure(db, { projectId: P, tagNo: "X", structureType: "tower" }),
      "INVALID_INPUT");
    await throws(() => steel.recordPlumbReading(db, { projectId: P, tagId: rack.id, columnMark: "A1",
      heightMm: 6000, dxMm: 3, dyMm: "", surveyedOn: "2026-08-10" }), "INVALID_INPUT");
  });
});

test("fireproofing not required is not applicable: not waited for, not offered, not tickable", async () => {
  await withProject(db, P, async () => {
    deck = await steel.upsertStructure(db, { projectId: P, tagNo: "PL-31", structureType: "platform",
      columns: 2, boltedJoints: 24, fireproofingRequired: false });
    const s = await status(deck.id);
    equal([step(s, "fireproofing").status, step(s, "fireproofing").na], ["done", true]);
    equal(step(s, "fireproofing").outOfOrder, false, "nobody recorded it, so not out of order");
    equal(s.progress.total, 7, "and it is out of scope, not progress");
    assert(!s.next.some((n) => n.code === "fireproofing"));
    await throws(() => tick(deck.id, "fireproofing"), "INVALID_INPUT");
  });
});

test("fireproofing not stated stays a manual step, not a silent N/A", async () => {
  await withProject(db, P, async () => {
    const t = await steel.upsertStructure(db, { projectId: P, tagNo: "SH-60", structureType: "shelter",
      fireproofingRequired: null });
    const s = await status(t.id);
    equal([step(s, "fireproofing").status, step(s, "fireproofing").na], ["not_started", false]);
    // An update that does not mention it leaves the stated value alone.
    await steel.upsertStructure(db, { projectId: P, tagNo: "PL-31", structureType: "platform",
      columns: 2, boltedJoints: 24 });
    equal(step(await status(deck.id), "fireproofing").na, true);
  });
});

test("a survey is not judged until the project names its erection standard", async () => {
  await withProject(db, P, async () => {
    await tick(deck.id, "foundation");
    await tick(deck.id, "erection");
    await shoot(deck.id, "A1", 5);
    await shoot(deck.id, "A2", 3, -4);
    let s = await status(deck.id);
    equal(step(s, "plumb").status, "not_started");
    equal(step(s, "plumb").note.level, "warn");
    await throws(() => projects.updateProjectProfile(db, { projectId: P,
      patch: { steel_erection_standard: "BS5950" } }), "INVALID_INPUT");
    await projects.updateProjectProfile(db, { projectId: P, patch: { steel_erection_standard: "AISC303" } });
    s = await status(deck.id);
    equal(step(s, "plumb").status, "done", "both columns within 12 mm");
  });
});

test("a column out of tolerance holds the structure until it is re-shot", async () => {
  await withProject(db, P, async () => {
    await shoot(deck.id, "A2", 14, 0, "2026-08-11");
    let s = await status(deck.id);
    equal(step(s, "plumb").status, "not_started");
    assert(/A2: 14 mm، مجاز 12 mm/.test(step(s, "plumb").note.text));
    await shoot(deck.id, "A2", 6, 2, "2026-08-12");
    s = await status(deck.id);
    equal(step(s, "plumb").status, "done");
  });
});

test("bolting counts verified joints against the drawing's total", async () => {
  await withProject(db, P, async () => {
    await bolt(deck.id, { joints: 12 });
    let s = await status(deck.id);
    equal(step(s, "bolting").status, "in_progress");
    assert(/12 از 24/.test(step(s, "bolting").note.text));
    await bolt(deck.id, { joints: 12, verifiedKn: 145, lotRef: "L7" });
    s = await status(deck.id);
    equal(step(s, "bolting").status, "not_started", "a failed verification holds it");
    assert(/145 kN به 149.1 kN نرسید/.test(step(s, "bolting").note.text));
    await bolt(deck.id, { joints: 12, verifiedKn: 151, lotRef: "L7", inspectedOn: "2026-08-14" });
    s = await status(deck.id);
    equal(step(s, "bolting").status, "done");
  });
});

test("grout waits for plumb and bolting; the deck is ready once painted and grouted", async () => {
  await withProject(db, P, async () => {
    let s = await status(deck.id);
    equal(s.next.map((n) => n.code).sort(), ["grout", "painting"]);
    await tick(deck.id, "grout");
    await tick(deck.id, "painting");
    await tick(deck.id, "ready");
    s = await status(deck.id);
    equal(s.why.ready, true);
    equal(s.progress.pct, 100);
  });
});

test("structures belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await steel.listStructures(db, { projectId: other.id })).length, 0);
  });
  await withProject(db, P, async () => {
    const list = await steel.listStructures(db, { projectId: P });
    equal(list.map((x) => x.tag_no), ["PL-31", "PR-21", "SH-60"]);
    equal(list.find((x) => x.tag_no === "PR-21").foundations, "FDN-PR-01");
  });
});

await run();
