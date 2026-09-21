#!/usr/bin/env node
/**
 * Examination requirement and sampling tests (EPIC-4).
 *
 * Two things are being protected here. That a percentage on a weld register
 * can always be traced to the clause or the class rule it came from, and that
 * a random sample is reproducible and covers every welder — because a sample
 * nobody can reproduce is not auditable, and one that misses a welder defeats
 * the clause that asked for it.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { codeRequirement, isRadiographable, SERVICE } from "../../lib/ndt/b31-3.mjs";
import { ndtRequirement, matchesRule } from "../../lib/ndt/requirement.mjs";
import { selectSample, coverage, seedFrom } from "../../lib/ndt/sampling.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const normal = { code: "DX01", service_category: SERVICE.NORMAL, ndt_rules: [] };
const bw = (over = {}) => ({ kind: "BW", loc: "Shop", nps: 36, ...over });

// ── the code floor ───────────────────────────────────────────────────────

test("Normal Fluid Service is 5% random radiography", async () => {
  const r = codeRequirement(SERVICE.NORMAL);
  equal(r.method, "RT");
  equal(r.percent, 5);
  equal(r.randomSample, true, "and the sample is not just any 5%");
  equal(r.clause, "B31.3 §341.4.1");
});

test("Category D asks for visual examination, not radiography", async () => {
  const r = codeRequirement(SERVICE.CATEGORY_D);
  equal(r.method, "VT");
  equal(r.clause, "B31.3 §341.4.2");
});

test("severe cyclic and high pressure are both fully radiographed", async () => {
  equal(codeRequirement(SERVICE.SEVERE_CYCLIC).percent, 100);
  equal(codeRequirement(SERVICE.HIGH_PRESSURE).percent, 100);
});

test("Category M is left unresolved rather than given an invented number", async () => {
  const r = codeRequirement(SERVICE.CATEGORY_M);
  equal(r.unresolved, true);
  equal(r.percent, null, "an invented percentage would be worse than admitting there isn't one");
});

test("only circumferential butt welds carry a radiographic percentage", async () => {
  equal(isRadiographable({ kind: "BW" }), true);
  equal(isRadiographable({ kind: "Closure" }), true);
  equal(isRadiographable({ kind: "Tie-in" }), true);
  equal(isRadiographable({ kind: "Fillet" }), false);
});

// ── class rules over the code floor ──────────────────────────────────────

test("with no class, only the code floor applies and it says so", async () => {
  const r = ndtRequirement(bw(), null);
  equal(r.source, "code");
  equal(r.unresolved, true);
  assert(r.notes[0].includes("Piping Class"));
});

test("a stricter class rule wins and is attributed to the class", async () => {
  const cls = { ...normal, ndt_rules: [
    { when: { shopField: "Field" }, method: "RT", percent: 100,
      reason: "همهٔ جوش‌های سایت ۱۰۰٪ رادیوگرافی" }] };
  const field = ndtRequirement(bw({ loc: "Field" }), cls);
  equal(field.percent, 100);
  equal(field.source, "class");
  equal(field.deviations, [], "stricter than the code is not a deviation");

  const shop = ndtRequirement(bw({ loc: "Shop" }), cls);
  equal(shop.percent, 5, "a shop weld falls through to the code floor");
  equal(shop.source, "code");
});

test("a class rule BELOW the code is applied but never silently", async () => {
  const cls = { ...normal, ndt_rules: [
    { when: { kind: ["BW"] }, method: "RT", percent: 2, reason: "توافق پروژه" }] };
  const r = ndtRequirement(bw(), cls);
  equal(r.percent, 2, "the class is the contract, so it is applied");
  equal(r.deviations.length, 1, "and reported as a deviation somebody must own");
  equal(r.deviations[0].code, "CLASS_BELOW_CODE");
  assert(r.deviations[0].message.includes("341.4.1"), "citing the floor it fell below");
});

test("a weaker method counts as below the code even at 100 percent", async () => {
  const cls = { ...normal, ndt_rules: [
    { when: { kind: ["BW"] }, method: "PT", percent: 100, reason: "فقط سطحی" }] };
  equal(ndtRequirement(bw(), cls).deviations[0].code, "CLASS_BELOW_CODE");
});

test("a non-radiographable weld takes a surface examination whatever the class says", async () => {
  const cls = { ...normal, ndt_rules: [
    { when: {}, method: "RT", percent: 100, reason: "همه‌چیز" }] };
  const r = ndtRequirement({ kind: "Fillet", loc: "Shop", nps: 2 }, cls);
  equal(r.method, "PT");
  assert(r.notes.some((n) => n.includes("butt")), "and says why");
});

test("rules can be scoped by size", async () => {
  equal(matchesRule({ nps: 2 }, { npsMax: 2 }), true);
  equal(matchesRule({ nps: 36 }, { npsMax: 2 }), false);
  equal(matchesRule({ nps: 36, kind: "BW" }, { kind: ["BW"], npsMin: 24 }), true);
});

// ── sampling ─────────────────────────────────────────────────────────────

const pop = (n, welders) => Array.from({ length: n }, (_, i) => ({
  weldUid: `U${i}`, weldNo: `W-${String(i + 1).padStart(2, "0")}`,
  welderId: welders[i % welders.length], stampNo: welders[i % welders.length],
}));

test("the same seed draws the same welds every time", async () => {
  const p = pop(100, ["A", "B", "C"]);
  const one = selectSample(p, 5, { seed: "LINE-1 rev 0" });
  const two = selectSample(p, 5, { seed: "LINE-1 rev 0" });
  equal(one.selected.map((w) => w.weldNo), two.selected.map((w) => w.weldNo),
    "an inspector asking why these welds gets a procedure, not a shrug");
  const other = selectSample(p, 5, { seed: "LINE-1 rev B" });
  assert(other.selected.map((w) => w.weldNo).join() !== one.selected.map((w) => w.weldNo).join(),
    "and a different seed draws differently");
});

test("every welder appears in the sample, which is what the clause asks for", async () => {
  const p = pop(100, ["A", "B", "C", "D"]);
  const s = selectSample(p, 5, { seed: "x" });
  equal(new Set(s.selected.map((w) => w.stampNo)).size, 4,
    "five welds from one crew and none from a fourth welder is the failure this prevents");
  equal(s.required, 5);
  equal(s.selected.length, 5);
});

test("when there are more welders than the percentage allows, coverage wins", async () => {
  const p = pop(20, ["A", "B", "C", "D", "E", "F"]);   // 5% of 20 is 1 weld
  const s = selectSample(p, 5, { seed: "x" });
  equal(s.required, 1);
  equal(s.selected.length, 6, "the sample grows so no welder is missed — the clause working");
  assert(s.rate > 5);
});

test("welds with no welder assigned yet are listed, not silently sampled around", async () => {
  const p = [...pop(10, ["A", "B"]), { weldUid: "X", weldNo: "W-99", welderId: null }];
  const s = selectSample(p, 20, { seed: "x" });
  equal(s.unassigned.map((w) => w.weldNo), ["W-99"],
    "coverage cannot be claimed for a weld whose welder is unknown");
});

test("a zero percentage selects nothing rather than one weld", async () => {
  equal(selectSample(pop(10, ["A"]), 0, { seed: "x" }).selected, []);
});

test("the seed is a stable hash, not an object identity", async () => {
  equal(seedFrom("LINE-1"), seedFrom("LINE-1"));
  assert(seedFrom("LINE-1") !== seedFrom("LINE-2"));
});

test("coverage counts first shots and names the welder with nothing examined", async () => {
  const required = [
    { weldUid: "U1", stampNo: "A" }, { weldUid: "U2", stampNo: "A" },
    { weldUid: "U3", stampNo: "B" },
  ];
  const records = [
    { weld_uid: "U1", result: "accept", repair_cycle: 0 },
    { weld_uid: "U1", result: "accept", repair_cycle: 1 },   // a re-shot must not double count
  ];
  const c = coverage({ required, records });
  equal(c.required, 3);
  equal(c.examined, 1);
  equal(c.welderGaps.map((w) => w.stampNo), ["B"],
    "92 percent complete hides the welder whose spools will be held at handover");
});

// ── through the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "ndt-db-"));

const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runsRepo = await import("../../lib/db/repos/runs.mjs");
const exec = await import("../../lib/db/repos/execution.mjs");
const pc = await import("../../lib/db/repos/piping-class.mjs");
const { buildModel } = await import("../../lib/engine.js");
const { DEMO } = await import("../../lib/demo.js");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const project = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });

let classId, lineId, runId, welderId;

test("a piping class and its size table persist", async () => {
  await withProject(db, project.id, async () => {
    const cls = await pc.upsertPipingClass(db, {
      projectId: project.id, code: "DX01", serviceCategory: "normal",
      materialSpec: "API 5L Gr.B", pwhtAboveMm: 19,
      ndtRules: [{ when: { shopField: "Field" }, method: "RT", percent: 100,
                   reason: "جوش‌های سایت ۱۰۰٪" }],
    });
    classId = cls.id;
    const n = await pc.setClassSizes(db, { projectId: project.id, pipingClassId: classId,
      sizes: [{ nps: 36, schedule: "SCH 10", wallThicknessMm: 7.92, odMm: 914.4 },
              { nps: 8, schedule: "SCH 40", wallThicknessMm: 8.18, odMm: 219.1 }] });
    equal(n, 2);
    const t = await pc.wallThickness(db, { projectId: project.id, pipingClassId: classId, nps: 36 });
    equal(t.wallThicknessMm, 7.92);
    equal(await pc.wallThickness(db, { projectId: project.id, pipingClassId: classId, nps: 12 }), null,
      "a size the class does not list has no thickness, and is not interpolated");
  });
});

test("the requirement is written back over the engine's provisional value", async () => {
  await withProject(db, project.id, async () => {
    const { rows: [line] } = await db.query(
      `INSERT INTO line (project_id, line_no, piping_class_id) VALUES ($1,$2,$3) RETURNING id`,
      [project.id, "36-P-001", classId]);
    lineId = line.id;
    const { rows: [doc] } = await db.query(
      `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
       VALUES ($1,'SW 265022A','0',$2,'local://x') RETURNING id`, [project.id, "a".repeat(64)]);
    const runRow = await runsRepo.createRun(db, {
      projectId: project.id, documentId: doc.id, lineId, payload: DEMO, validationChecks: [] });
    runId = runRow.id;
    await runsRepo.saveRegister(db, {
      projectId: project.id, runId, documentId: doc.id, lineId, model: buildModel(DEMO, {}) });

    const cls = await pc.getPipingClass(db, { projectId: project.id, code: "DX01" });
    const { applied, deviations } = await pc.applyNdtRequirements(db, {
      projectId: project.id, runId, pipingClass: cls });
    equal(deviations, []);
    const field = applied.filter((a) => a.requirement === "RT 100%");
    equal(field.length, 4, "the four field welds, by the class rule");
    assert(applied.some((a) => a.requirement === "RT 5% random" && a.source === "code"),
      "and shop welds fall through to the code floor");
  });
});

test("the sample is drawn, stored with its seed, and covers both welders", async () => {
  await withProject(db, project.id, async () => {
    const w1 = await exec.upsertWelder(db, { projectId: project.id, stampNo: "W-12", name: "الف" });
    const w2 = await exec.upsertWelder(db, { projectId: project.id, stampNo: "W-13", name: "ب" });
    welderId = w1.id;
    for (const w of [w1, w2]) {
      await exec.addQualification(db, { projectId: project.id, welderId: w.id, process: "GTAW",
        positions: ["6G"], couponOdMm: 219.1, couponThicknessMm: 8.18 });
    }
    const { rows } = await db.query(
      "SELECT weld_uid, shop_field FROM weld WHERE extraction_run_id = $1 ORDER BY weld_no", [runId]);
    const shop = rows.filter((r) => r.shop_field === "Shop");
    for (const [i, r] of shop.entries()) {
      await exec.assignWeld(db, {
        projectId: project.id, weldUid: r.weld_uid, welderId: i % 2 ? w2.id : w1.id,
        weldedAt: "2026-09-10", process: "GTAW", position: "V", lineId });
    }

    const cls = await pc.getPipingClass(db, { projectId: project.id, code: "DX01" });
    const out = await pc.drawNdtSample(db, {
      projectId: project.id, runId, lineId, pipingClass: cls, seed: "36-P-001 rev 0" });
    equal(out.percent, 5);
    assert(out.selection.seed, "the seed is stored so the draw can be reproduced");
    equal(new Set(out.result.selected.map((w) => w.stampNo)).size, 2,
      "both welders are represented, as §341.4.1(b) requires");
    globalThis.__selectionId = out.selection.id;
  });
});

test("wall thickness now comes from the class, closing the EPIC-3 gap", async () => {
  await withProject(db, project.id, async () => {
    const { rows: [w] } = await db.query(
      "SELECT weld_uid FROM weld WHERE extraction_run_id = $1 AND shop_field = 'Shop' LIMIT 1", [runId]);
    const { verdict } = await exec.assignWeld(db, {
      projectId: project.id, weldUid: w.weld_uid, welderId,
      weldedAt: "2026-09-11", process: "GTAW", position: "V", lineId });
    const gaps = verdict.unverified.map((u) => u.code);
    assert(!gaps.includes("NO_WALL_THICKNESS"),
      "the qualification check no longer reports thickness as unverifiable");
  });
});

test("coverage reports the welder whose sampled weld has not been shot", async () => {
  await withProject(db, project.id, async () => {
    const c = await pc.ndtCoverage(db, { projectId: project.id, selectionId: globalThis.__selectionId });
    equal(c.examined, 0);
    assert(c.welderGaps.length > 0, "nothing shot yet, so every welder is a gap");

    const first = c.selection.selected_uids[0];
    await exec.recordNdt(db, { projectId: project.id, weldUid: first, method: "RT", result: "accept" });
    const after = await pc.ndtCoverage(db, { projectId: project.id, selectionId: globalThis.__selectionId });
    equal(after.examined, 1);
    assert(after.pct > 0);
  });
});

test("a selection that does not exist is a 404, not an empty report", async () => {
  await withProject(db, project.id, async () => {
    const e = await throws(() => pc.ndtCoverage(db, {
      projectId: project.id, selectionId: "00000000-0000-0000-0000-000000000000" }));
    equal(e.status, 404);
  });
});

await run();
