#!/usr/bin/env node
/**
 * The painting and insulation module: surface preparation, application
 * conditions, ISO 19840 dry film thickness, insulation, and the spool's
 * paint step answered by its coating sign-off — in the engine and in
 * reporting alike.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  normalizeGrade, prepSatisfies, judgePrep, dewPoint, judgeConditions, minReadings, judgeDft,
  judgeInsulation, spoolAreaM2,
} from "../../lib/coating/coating.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";

// ── surface preparation ──────────────────────────────────────────────────

test("preparation grades are read as specifications write them", async () => {
  equal(["SA2.5", "sa 2 1/2", "Sa 2½", "St3", "Sa4"].map(normalizeGrade), ["Sa 2½", "Sa 2½", "Sa 2½", "St 3", null]);
});

test("blast cleaning meets a tool grade; tool cleaning never meets a blast grade", async () => {
  equal(prepSatisfies("Sa 2", "St 3"), true);
  equal(prepSatisfies("St 3", "Sa 2"), false);
  equal(prepSatisfies("Sa 2", "Sa 2½"), false);
  equal(prepSatisfies("Sa 3", "Sa 2½"), true);
});

const sys = { prepGrade: "Sa 2½", profileMin: 50, profileMax: 85 };

test("the profile must sit in the system's range, and be measured when required", async () => {
  equal(judgePrep({ grade: "Sa 2½", profile: [60, 70, 75] }, sys).ok, true);
  equal(judgePrep({ grade: "Sa 2½", profile: [60, 95] }, sys).ok, false);
  equal(judgePrep({ grade: "Sa 2½", profile: [] }, sys).valid, false);
  equal(judgePrep({ grade: "Sa 2", profile: [60] }, sys).ok, false);
});

// ── application conditions ───────────────────────────────────────────────

test("dew point by Magnus: 25 °C at 60% RH is 16.7 °C", async () => {
  assert(Math.abs(dewPoint(25, 60) - 16.69) < 0.05);
  assert(Math.abs(dewPoint(30, 85) - 27.2) < 0.05, "a humid Asalouyeh afternoon leaves almost no margin");
});

test("the steel must be 3 °C above the dew point", async () => {
  const td = Math.round(dewPoint(30, 85) * 10) / 10;             // 27.2
  equal(judgeConditions({ airC: 30, rh: 85, steelC: td + 3 }).ok, true, "on the margin");
  const r = judgeConditions({ airC: 30, rh: 85, steelC: td + 2.9 });
  equal(r.ok, false);
  assert(/نقطهٔ شبنم/.test(r.reason));
  equal(judgeConditions({ airC: 30, rh: 85, steelC: 32 }, { marginC: 5 }).ok, false, "a project may ask for more");
});

test("RH is judged only against a stated limit, and a missing value gets no verdict", async () => {
  equal(judgeConditions({ airC: 25, rh: 90, steelC: 35 }).ok, true, "no limit, no RH verdict");
  equal(judgeConditions({ airC: 25, rh: 90, steelC: 35 }, { maxRh: 85 }).ok, false);
  equal(judgeConditions({ airC: 25, rh: 60 }).valid, false);
});

// ── ISO 19840 ────────────────────────────────────────────────────────────

test("the number of readings follows the area inspected", async () => {
  equal([0.5, 1, 2, 5, 20, 50, 150, 250].map(minReadings), [5, 5, 10, 15, 20, 30, 40, 50]);
  equal(minReadings(null), null);
});

const spec = { ndft: 250, maxDft: 500, areaM2: 1 };

test("ISO 19840 (a): the mean must reach the nominal DFT", async () => {
  const r = judgeDft([240, 245, 250, 255, 245], spec);
  equal(r.ok, false);
  assert(/میانگین/.test(r.reason));
});

test("ISO 19840 (b): no reading below 80% of nominal", async () => {
  const r = judgeDft([199, 300, 300, 300, 300], spec);
  equal(r.ok, false, "mean 280 is fine; 199 < 200 is not");
  assert(/۸۰٪/.test(r.reason));
});

test("ISO 19840 (c): no more than 20% of readings between 80% and 100%", async () => {
  equal(judgeDft([240, 300, 300, 300, 300], spec).ok, true, "one of five is 20%");
  const r = judgeDft([240, 245, 300, 300, 300], spec);
  equal(r.ok, false, "two of five is 40%");
  assert(/۲۰٪/.test(r.reason));
});

test("ISO 19840 (d): nothing above the maximum", async () => {
  equal(judgeDft([260, 270, 280, 290, 510], spec).ok, false);
  equal(judgeDft([260, 270, 280, 290, 510], { ...spec, maxDft: null }).ok, true, "no maximum, no check");
});

test("too few readings for the area, or no area, gets no verdict", async () => {
  equal(judgeDft([260, 270, 280, 290, 300], { ...spec, areaM2: 4.1 }).valid, false, "4.1 m² needs 15");
  assert(/مساحت/.test(judgeDft([260, 270, 280, 290, 300], { ...spec, areaM2: null }).reason));
});

test("insulation is judged reading by reading", async () => {
  equal(judgeInsulation([50, 52, 51], 50).ok, true);
  equal(judgeInsulation([50, 48, 51], 50).ok, false);
  equal(judgeInsulation([], 50).valid, false);
});

test("a spool's area is π·OD·L from the exact OD table", async () => {
  equal(spoolAreaM2(219.1, 6000), 4.13);
  equal(spoolAreaM2(undefined, 6000), null, "no OD in the table, no area — never a guess");
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "coat-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const pe = await import("../../lib/db/repos/piping-execution.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const steel = await import("../../lib/db/repos/structural.mjs");
const coat = await import("../../lib/db/repos/coating.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "C110", name: "C110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const P = proj.id;
let spools, system, insulated, bare, rack;

await withProject(db, P, async () => {
  const { rows: [line] } = await db.query(
    "INSERT INTO line (project_id, line_no) VALUES ($1,'28-CWR-10') RETURNING id", [P]);
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
     VALUES ($1,'SW 265022A','0',$2,'local://x') RETURNING id`, [P, "c".repeat(64)]);
  const model = buildModel(DEMO, {});
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: line.id,
    payload: DEMO, validationChecks: model.checks });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: line.id, model });
  spools = (await db.query("SELECT id, spool_no, nps_max, length_mm FROM spool WHERE project_id = $1 ORDER BY spool_no",
    [P])).rows;
});

const status = (itemId) => coat.coatingStatus(db, { projectId: P, itemId });
const step = (s, code) => s.steps.find((x) => x.code === code);
const itemOf = async (spoolId) => (await db.query(
  "SELECT id FROM coating_item WHERE spool_id = $1", [spoolId])).rows[0].id;
const record = (itemId, kind, d) => coat.recordCoating(db, { projectId: P, itemId, kind, recordedOn: "2026-09-10", ...d });
const mark = (itemId, code) => coat.recordCoatingActivity(db, { projectId: P, itemId, code, doneAt: "2026-09-12" });
const readings = (n, v) => Array.from({ length: n }, (_, k) => v + (k % 3) * 5).join(" ");

test("a system is stored as the painting spec writes it, and refuses nonsense", async () => {
  await withProject(db, P, async () => {
    system = await coat.upsertSystem(db, { projectId: P, code: "ps-3", title: "Zinc / epoxy / PU",
      prepGrade: "sa2.5", profileMinUm: 50, profileMaxUm: 85, maxDftUm: 500,
      coats: [{ name: "Zinc-rich primer", ndftUm: 75 }, { name: "Epoxy MIO", ndftUm: 125 }, { name: "PU finish", ndftUm: 50 }] });
    equal([system.code, system.prep_grade], ["PS-3", "Sa 2½"]);
    await throws(() => coat.upsertSystem(db, { projectId: P, code: "X", prepGrade: "Sa 5", coats: [{ name: "a", ndftUm: 50 }] }),
      "INVALID_INPUT");
    await throws(() => coat.upsertSystem(db, { projectId: P, code: "X", prepGrade: "Sa 2", coats: [] }), "INVALID_INPUT");
  });
});

test("assigning a spool computes its area from the B36.10M table", async () => {
  await withProject(db, P, async () => {
    const r = await coat.assignCoating(db, { projectId: P, systemId: system.id,
      spoolIds: [spools[0].id], insulation: "hot", insulationThkMm: 50 });
    const r2 = await coat.assignCoating(db, { projectId: P, systemId: system.id, spoolIds: [spools[1].id] });
    equal(r.assigned + r2.assigned, 2);
    insulated = await itemOf(spools[0].id);
    bare = await itemOf(spools[1].id);
    const { rows: [i] } = await db.query("SELECT area_m2 FROM coating_item WHERE id = $1", [insulated]);
    assert(Number(i.area_m2) > 0, `area ${i.area_m2} m² from NPS ${spools[0].nps_max} × ${spools[0].length_mm} mm`);
  });
});

test("measured steps are never ticked, and ready waits for them", async () => {
  await withProject(db, P, async () => {
    for (const c of ["surface_prep", "coats", "insulation"]) await throws(() => mark(bare, c), "INVALID_INPUT");
    await throws(() => mark(bare, "ready"), "INVALID_INPUT");
    const s = await status(bare);
    equal([step(s, "insulation").na, step(s, "cladding").na], [true, true], "no insulation, no insulation steps");
  });
});

test("a coat applied too close to the dew point is rejected even if its DFT is fine", async () => {
  await withProject(db, P, async () => {
    await record(bare, "prep", { grade: "Sa 2½", profile: "60 65 70" });
    const need = (await db.query("SELECT area_m2 FROM coating_item WHERE id = $1", [bare])).rows[0].area_m2;
    const n = minReadings(Number(need));
    await record(bare, "coat", { coatNo: 1, airC: 30, rh: 85, steelC: 29, readings: readings(n, 80) });
    const s = await status(bare);
    equal(step(s, "surface_prep").status, "done");
    equal(step(s, "coats").status, "not_started");
    assert(/شبنم/.test(step(s, "coats").note.text));
  });
});

test("coats are judged cumulatively; all three passing completes the step", async () => {
  await withProject(db, P, async () => {
    const need = minReadings(Number((await db.query("SELECT area_m2 FROM coating_item WHERE id = $1", [bare])).rows[0].area_m2));
    const ok = { airC: 30, rh: 60, steelC: 32 };
    await record(bare, "coat", { coatNo: 1, ...ok, readings: readings(need, 80) });
    let s = await status(bare);
    equal(step(s, "coats").status, "in_progress", "one of three");
    await record(bare, "coat", { coatNo: 2, ...ok, readings: readings(need, 205) });      // cumulative, nominal 200
    await record(bare, "coat", { coatNo: 3, ...ok, readings: readings(need, 255) });      // cumulative, nominal 250
    s = await status(bare);
    equal(step(s, "coats").status, "done");
  });
});

test("a coat is judged against the nominal DFT up to it, not its own alone", async () => {
  // After the epoxy the gauge reads primer + epoxy: 180 µm clears the
  // epoxy's own 125 but not the 200 the system has by then.
  await withProject(db, P, async () => {
    const deck = await steel.upsertStructure(db, { projectId: P, tagNo: "PL-99", structureType: "platform" });
    await coat.assignCoating(db, { projectId: P, systemId: system.id, tagIds: [deck.id], areaM2: 1 });
    const it = (await db.query("SELECT id FROM coating_item WHERE tag_id = $1", [deck.id])).rows[0].id;
    const need = minReadings(1);
    const ok = { airC: 30, rh: 60, steelC: 32 };
    await record(it, "prep", { grade: "Sa 2½", profile: "60 70" });
    await record(it, "coat", { coatNo: 1, ...ok, readings: readings(need, 80) });
    await record(it, "coat", { coatNo: 2, ...ok, readings: readings(need, 180) });
    const s = await status(it);
    equal(step(s, "coats").status, "in_progress", "the primer passed; the epoxy did not");
    assert(/لایهٔ 2/.test(step(s, "coats").note.text) && /200 µm/.test(step(s, "coats").note.text));
  });
});

test("an uninsulated spool painted before its leak test is not flagged — B31.3 allows it", async () => {
  await withProject(db, P, async () => {
    await mark(bare, "final_inspection");
    await mark(bare, "ready");
    const sp = await pe.spoolStatus(db, { projectId: P, spoolId: spools[1].id });
    const painted = sp.steps.find((x) => x.code === "painted");
    equal([painted.status, painted.derived, painted.outOfOrder], ["done", true, false]);
    await throws(() => pe.recordSpoolActivity(db, { projectId: P, spoolId: spools[1].id, code: "painted",
      doneAt: "2026-09-12" }), "INVALID_INPUT", "no second, hand-ticked source");
  });
});

test("the database reads the same sign-off as the engine", async () => {
  await withProject(db, P, async () => {
    for (const s of spools.slice(0, 2)) {
      const js = await pe.spoolStatus(db, { projectId: P, spoolId: s.id });
      const { rows: [row] } = await db.query("SELECT stage FROM reporting.spool_stage WHERE spool_key = $1", [s.id]);
      equal(row.stage, js.headline, `spool ${s.spool_no}`);
    }
  });
});

test("a hand-ticked paint from before the coating item is ignored by both", async () => {
  await withProject(db, P, async () => {
    const s = spools[2];
    await pe.recordSpoolActivity(db, { projectId: P, spoolId: s.id, code: "painted", doneAt: "2026-08-01" });
    await coat.assignCoating(db, { projectId: P, systemId: system.id, spoolIds: [s.id] });
    const js = await pe.spoolStatus(db, { projectId: P, spoolId: s.id });
    const { rows: [row] } = await db.query("SELECT stage FROM reporting.spool_stage WHERE spool_key = $1", [s.id]);
    equal(js.steps.find((x) => x.code === "painted").status, "not_started");
    equal(row.stage, js.headline);
  });
});

test("insulation on an untested spool is held — B31.3 §345.3.1", async () => {
  await withProject(db, P, async () => {
    const need = minReadings(Number((await db.query("SELECT area_m2 FROM coating_item WHERE id = $1", [insulated])).rows[0].area_m2));
    const ok = { airC: 28, rh: 55, steelC: 30 };
    await record(insulated, "prep", { grade: "Sa 2½", profile: "60 70" });
    await record(insulated, "coat", { coatNo: 1, ...ok, readings: readings(need, 80) });
    await record(insulated, "coat", { coatNo: 2, ...ok, readings: readings(need, 205) });
    await record(insulated, "coat", { coatNo: 3, ...ok, readings: readings(need, 255) });
    await mark(insulated, "final_inspection");
    await record(insulated, "insulation", { thicknessMm: "50 51 52" });
    let s = await status(insulated);
    equal(step(s, "insulation").status, "not_started");
    assert(/345\.3\.1/.test(step(s, "insulation").note.text));
    equal(step(s, "insulation").note.level, "hold", "waiting on the test is not a defect");
    await pe.recordSpoolActivity(db, { projectId: P, spoolId: spools[0].id, code: "test", doneAt: "2026-09-11" });
    s = await status(insulated);
    equal(step(s, "insulation").status, "done", "after the test, the same measurements are accepted");
  });
});

test("a structure's paint step is answered by its coating item", async () => {
  await withProject(db, P, async () => {
    rack = await steel.upsertStructure(db, { projectId: P, tagNo: "PR-21", structureType: "pipe_rack" });
    const before = (await acts.tagStatus(db, { projectId: P, tagId: rack.id })).steps.find((x) => x.code === "painting");
    equal(before.derived, false, "no coating item yet: manual");
    await coat.assignCoating(db, { projectId: P, systemId: system.id, tagIds: [rack.id], areaM2: 120 });
    const after = (await acts.tagStatus(db, { projectId: P, tagId: rack.id })).steps.find((x) => x.code === "painting");
    equal([after.derived, after.status], [true, "not_started"]);
    await throws(() => acts.recordActivity(db, { projectId: P, tagId: rack.id, code: "painting",
      doneAt: "2026-09-01" }), "INVALID_INPUT");
  });
});

test("coating belongs to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await coat.coatingBoard(db, { projectId: other.id })).items.length, 0);
  });
});

await run();
