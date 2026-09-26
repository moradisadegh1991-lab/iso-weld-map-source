#!/usr/bin/env node
/**
 * Reporting star schema tests (EPIC-8).
 *
 * The first test is the one that matters most. A PostgreSQL view runs with
 * its owner's privileges unless it is declared security_invoker, which means
 * a plain reporting view over these tables hands every project's rows to
 * anyone who can read it. That is a leak with no symptom — the numbers just
 * look bigger — so it is checked directly rather than trusted.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "rpt-db-"));

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
const k110 = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "Other", ownerUserId: alice.id });

/** Build a full picture on a project: class, line, register, welders, NDT. */
async function populate(project, { docNo, welders, rejectFirst = false }) {
  return withProject(db, project.id, async () => {
    const cls = await pc.upsertPipingClass(db, {
      projectId: project.id, code: "DX01", serviceCategory: "normal",
      ndtRules: [{ when: { shopField: "Field" }, method: "RT", percent: 100, reason: "سایت" }] });
    await pc.setClassSizes(db, { projectId: project.id, pipingClassId: cls.id,
      sizes: [{ nps: 36, schedule: "SCH 10", wallThicknessMm: 7.92 }] });

    const { rows: [line] } = await db.query(
      `INSERT INTO line (project_id, line_no, piping_class_id) VALUES ($1,$2,$3) RETURNING id`,
      [project.id, `${docNo}-LINE`, cls.id]);
    const { rows: [doc] } = await db.query(
      `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
       VALUES ($1,$2,'0',$3,'local://x') RETURNING id`,
      [project.id, docNo, docNo.padEnd(64, "0").slice(0, 64).replace(/[^0-9a-f]/g, "a")]);

    const model = buildModel(DEMO, {});
    const runRow = await runsRepo.createRun(db, {
      projectId: project.id, documentId: doc.id, lineId: line.id,
      payload: DEMO, validationChecks: model.checks });
    await runsRepo.saveRegister(db, {
      projectId: project.id, runId: runRow.id, documentId: doc.id, lineId: line.id, model });
    await pc.applyNdtRequirements(db, { projectId: project.id, runId: runRow.id, pipingClass: cls });

    const made = [];
    for (const [stamp, name] of welders) {
      const w = await exec.upsertWelder(db, { projectId: project.id, stampNo: stamp, name });
      await exec.addQualification(db, { projectId: project.id, welderId: w.id, process: "GTAW",
        positions: ["6G"], couponOdMm: 219.1, couponThicknessMm: 8.18 });
      made.push(w);
    }

    const { rows: welds } = await db.query(
      "SELECT weld_uid FROM weld WHERE extraction_run_id = $1 ORDER BY weld_no", [runRow.id]);
    // Weld all but the last, so there is always something left to do.
    for (const [i, wd] of welds.slice(0, -1).entries()) {
      await exec.assignWeld(db, {
        projectId: project.id, weldUid: wd.weld_uid, welderId: made[i % made.length].id,
        weldedAt: "2026-09-10", process: "GTAW", position: "V", lineId: line.id });
    }
    // Examine two of them; the rest become the handover gap.
    await exec.recordNdt(db, { projectId: project.id, weldUid: welds[0].weld_uid,
      method: "RT", result: rejectFirst ? "reject" : "accept" });
    await exec.recordNdt(db, { projectId: project.id, weldUid: welds[1].weld_uid,
      method: "RT", result: "accept" });
    return { runId: runRow.id, lineId: line.id, welds };
  });
}

const k110Data = await populate(k110, { docNo: "SW 265022A", welders: [["W-12", "رضایی"], ["W-13", "کریمی"]], rejectFirst: true });
await populate(other, { docNo: "SW 999999", welders: [["X-01", "دیگری"]] });

const asReport = async (sql, params, projectId) => {
  await db.query("SELECT set_config('app.project_id', $1, false)", [String(projectId)]);
  await db.query("SET ROLE app_report");
  try { return (await db.query(sql, params)).rows; }
  finally { await db.query("RESET ROLE"); await db.query("SELECT set_config('app.project_id','',false)"); }
};

// ── the isolation that everything else depends on ────────────────────────

test("a reporting view shows one project, not every project", async () => {
  const mine = await asReport("SELECT weld_no FROM reporting.fact_weld", [], k110.id);
  const theirs = await asReport("SELECT weld_no FROM reporting.fact_weld", [], other.id);
  equal(mine.length, 10);
  equal(theirs.length, 10);

  const lines = await asReport("SELECT line_no FROM reporting.dim_line", [], k110.id);
  equal(lines.map((l) => l.line_no), ["SW 265022A-LINE"],
    "security_invoker is what keeps the other project out of this report");
});

test("with no project scope a report sees nothing at all", async () => {
  const rows = await asReport("SELECT weld_no FROM reporting.fact_weld", [], "");
  equal(rows.length, 0, "an unscoped Power BI connection gets an empty model, not everyone's data");
});

// ── the grain is right ───────────────────────────────────────────────────

test("the governing register is the approved run, not the latest draft", async () => {
  await withProject(db, k110.id, async () => {
    const { rows: [doc] } = await db.query(
      "SELECT document_id FROM extraction_run WHERE id = $1", [k110Data.runId]);
    // A later draft over the same document must not replace the approved one.
    await runsRepo.approveRun(db, { projectId: k110.id, runId: k110Data.runId, userId: alice.id });
    const draft = await runsRepo.createRun(db, {
      projectId: k110.id, documentId: doc.document_id, payload: DEMO, validationChecks: [] });
    await runsRepo.saveRegister(db, {
      projectId: k110.id, runId: draft.id, documentId: doc.document_id, model: buildModel(DEMO, {}) });
  });
  const rows = await asReport(
    "SELECT run_id, status FROM reporting.current_run", [], k110.id);
  equal(rows.length, 1, "one governing run per document");
  equal(rows[0].status, "approved");
  equal(rows[0].run_id, k110Data.runId, "a superseded draft must not inflate a progress number");
});

test("fact_weld is one row per weld with the measures precomputed", async () => {
  const rows = await asReport(
    `SELECT weld_no, is_field_weld, is_welded, is_examined, awaiting_ndt, ndt_requirement
       FROM reporting.fact_weld ORDER BY weld_no`, [], k110.id);
  equal(rows.length, 10);
  equal(rows.filter((r) => r.is_field_weld).length, 4);
  equal(rows.filter((r) => r.is_welded).length, 9, "the last weld is not made yet");
  equal(rows.filter((r) => r.is_examined).length, 2);
  equal(rows.filter((r) => r.awaiting_ndt).length, 7,
    "welded but never examined — each one an ITR that will be missing at handover");
  assert(rows.some((r) => r.ndt_requirement === "RT 100%"), "the class rule reached the report");
});

// ── the KPI views ────────────────────────────────────────────────────────

test("line progress carries both percentages a construction manager asks for", async () => {
  const [row] = await asReport("SELECT * FROM reporting.kpi_line_progress", [], k110.id);
  equal(Number(row.welds_total), 10);
  equal(Number(row.welds_done), 9);
  equal(Number(row.pct_welded), 90);
  equal(Number(row.pct_examined), 20);
  equal(Number(row.awaiting_ndt), 7);
});

test("the repair rate counts first shots only", async () => {
  const rows = await asReport(
    "SELECT stamp_no, shots, rejects, repair_rate_pct FROM reporting.kpi_welder_performance ORDER BY stamp_no",
    [], k110.id);
  equal(rows.map((r) => r.stamp_no), ["W-12", "W-13"]);
  const total = rows.reduce((a, r) => a + Number(r.shots), 0);
  equal(total, 2, "two welds radiographed for the first time");
  assert(rows.some((r) => Number(r.rejects) === 1), "and one of them was rejected");
});

test("the handover gap lists the welds, not just a count", async () => {
  const rows = await asReport(
    "SELECT weld_no, stamp_no FROM reporting.kpi_handover_gap ORDER BY weld_no", [], k110.id);
  equal(rows.length, 7);
  assert(rows.every((r) => r.stamp_no), "each one names the welder, so somebody can chase it");
});

test("spool stage rolls up, derived from the work rather than set", async () => {
  // Nobody has recorded a single chain step on this project; the welds were
  // simply made. The stage and `built` must follow from that alone.
  const stages = await asReport(
    "SELECT stage, stage_seq, spools FROM reporting.kpi_spool_status ORDER BY stage_seq", [], k110.id);
  const spoolRows = await asReport(
    "SELECT spool_no, stage, built FROM reporting.dim_spool ORDER BY spool_no", [], k110.id);
  equal(stages.reduce((a, r) => a + Number(r.spools), 0), spoolRows.length,
    "every spool is in exactly one stage");

  const welded = await asReport(
    `SELECT DISTINCT spool_key FROM reporting.fact_weld WHERE is_welded`, [], k110.id);
  assert(welded.length > 0, "the fixture welds something");
  const builtCount = spoolRows.filter((r) => r.built).length;
  equal(builtCount, welded.length,
    "a spool with any weld made is built, even with no step ticked — "
    + "missing it would drop real rework off the revision warning");
});

test("extraction accuracy aggregates by field, with the index stripped", async () => {
  await withProject(db, k110.id, async () => {
    for (const p of ["nodes[0].E", "nodes[4].E", "meta.nps"]) {
      await db.query(
        `INSERT INTO extraction_edit (project_id, extraction_run_id, path, field, kind,
                                      before_value, after_value, edited_by)
         VALUES ($1,$2,$3,$4,'changed','1','2',$5)`,
        [k110.id, k110Data.runId, p, p.split(".").pop(), alice.id]);
    }
  });
  const rows = await asReport(
    "SELECT field_path, corrections FROM reporting.kpi_extraction_accuracy ORDER BY corrections DESC",
    [], k110.id);
  equal(rows[0].field_path, "nodes[].E");
  equal(Number(rows[0].corrections), 2, "the same field on two rows is one weakness, not two");
});

test("the welder dimension carries qualification state for a slicer", async () => {
  const rows = await asReport(
    "SELECT stamp_no, processes, live_qualifications FROM reporting.dim_welder ORDER BY stamp_no",
    [], k110.id);
  equal(rows.map((r) => r.stamp_no), ["W-12", "W-13"]);
  equal(rows[0].processes, "GTAW");
  equal(Number(rows[0].live_qualifications), 1);
});

// ── the HTTP channel reads the same views ────────────────────────────────

const dashboardRoute = await import("../../app/api/reports/dashboard/route.js");

test("the dashboard endpoint reports the same numbers as the views", async () => {
  const res = await dashboardRoute.GET(new Request(
    `http://x/api/reports/dashboard?projectId=${k110.id}`,
    { headers: { authorization: "Bearer kc|alice" } }));
  const body = await res.json();
  equal(res.status, 200);
  equal(body.totals.welds, 10);
  equal(body.totals.welded, 9);
  equal(body.totals.pctWelded, 90, "the definition cannot drift from the report's");
  equal(body.handoverGap.length, 7);
  assert(body.extractionAccuracy.some((r) => r.field_path === "nodes[].E"));
});

test("the dashboard is scoped like everything else", async () => {
  const res = await dashboardRoute.GET(new Request(
    `http://x/api/reports/dashboard?projectId=${other.id}`,
    { headers: { authorization: "Bearer kc|bob-the-stranger" } }));
  equal(res.status, 404, "a project you are not in does not exist as far as you know");
});

await run();
