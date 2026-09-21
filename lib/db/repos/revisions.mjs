/**
 * Comparing two revisions of the same drawing.
 *
 * The expensive question an isometric revision raises is never "what is
 * different" on its own — it is "what have we already built that is now
 * wrong". So a comparison returns both: the weld-level diff, and the spools
 * the change lands in, split by whether they exist yet.
 *
 * Call inside `withProject`.
 */
import { diffRegisters, spoolImpact } from "../../register/diff.mjs";
import { fromDb } from "../../register/normalize.mjs";

async function loadRun(db, { projectId, runId }) {
  const { rows: [run] } = await db.query(
    `SELECT r.*, d.doc_no, d.revision, d.sheet_no, d.file_sha256
       FROM extraction_run r JOIN document d ON d.id = r.document_id
      WHERE r.id = $1 AND r.project_id = $2`,
    [runId, projectId]);
  if (!run) throw Object.assign(new Error("extraction run not found"), { status: 404 });

  const { rows } = await db.query(
    `SELECT w.weld_no, w.weld_uid, w.weld_kind, w.shop_field, w.joint_role,
            w.nps, w.elevation_mm, w.ndt_requirement,
            w.pos_e, w.pos_n, w.pos_el, s.spool_no, s.fab_status
       FROM weld w LEFT JOIN spool s ON s.id = w.spool_id
      WHERE w.extraction_run_id = $1 AND w.project_id = $2
      ORDER BY w.weld_no`,
    [runId, projectId]);
  return { run, rows };
}

export async function compareRuns(db, { projectId, fromRunId, toRunId }) {
  const before = await loadRun(db, { projectId, runId: fromRunId });
  const after = await loadRun(db, { projectId, runId: toRunId });

  if (before.run.doc_no !== after.run.doc_no || before.run.sheet_no !== after.run.sheet_no) {
    throw Object.assign(
      new Error(`نمی‌توان دو نقشهٔ متفاوت را مقایسه کرد: ${before.run.doc_no} در برابر ${after.run.doc_no}`),
      { status: 400, code: "DIFFERENT_DRAWINGS" });
  }

  const diff = diffRegisters(fromDb(before.rows), fromDb(after.rows));

  // Fabrication status comes from the OLD revision: those are the spools that
  // physically exist. The new revision's spools are, by definition, paper.
  const fabStatus = new Map();
  for (const r of before.rows) if (r.spool_no) fabStatus.set(r.spool_no, r.fab_status || "planned");

  return {
    from: revisionSummary(before.run),
    to: revisionSummary(after.run),
    diff,
    impact: spoolImpact(diff, fabStatus),
  };
}

/**
 * The comparison an engineer almost always wants: the newest run against the
 * one before it, for the same drawing sheet.
 */
export async function compareWithPrevious(db, { projectId, runId }) {
  const { rows: [current] } = await db.query(
    `SELECT r.id, d.doc_no, d.sheet_no, r.created_at
       FROM extraction_run r JOIN document d ON d.id = r.document_id
      WHERE r.id = $1 AND r.project_id = $2`,
    [runId, projectId]);
  if (!current) throw Object.assign(new Error("extraction run not found"), { status: 404 });

  const { rows: [previous] } = await db.query(
    `SELECT r.id FROM extraction_run r JOIN document d ON d.id = r.document_id
      WHERE r.project_id = $1 AND d.doc_no = $2 AND d.sheet_no = $3
        AND r.id <> $4 AND r.created_at < $5 AND r.engine_error IS NULL
      ORDER BY r.created_at DESC LIMIT 1`,
    [projectId, current.doc_no, current.sheet_no, runId, current.created_at]);

  if (!previous) return { from: null, to: null, diff: null, impact: null, reason: "NO_PREVIOUS_RUN" };
  return compareRuns(db, { projectId, fromRunId: previous.id, toRunId: runId });
}

const revisionSummary = (r) => ({
  runId: r.id,
  docNo: r.doc_no,
  revision: r.revision,
  sheetNo: r.sheet_no,
  fileSha256: r.file_sha256,
  status: r.status,
  createdAt: r.created_at,
});
