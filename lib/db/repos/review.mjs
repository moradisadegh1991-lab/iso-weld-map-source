/**
 * The review queue, the edit log, and the lock.
 *
 * Call inside `withProject`.
 */
import { diffPayload, editHotspots } from "../../review/payload-diff.mjs";
import { saveRegister, getRegister } from "./runs.mjs";
import { buildModel } from "../../engine.js";

/**
 * What is waiting for a piping engineer, worst first.
 *
 * Ordered by how many validation checks failed, because that is the honest
 * proxy for "how likely is this to be wrong". A queue ordered by arrival time
 * asks the engineer to find the bad ones themselves, which is the job the
 * validation engine already did.
 */
export async function reviewQueue(db, { projectId, limit = 50 }) {
  const { rows } = await db.query(
    `SELECT r.id, r.created_at, r.status, r.model_name, r.engine_error,
            d.doc_no, d.revision, d.sheet_no,
            COALESCE(jsonb_array_length(r.validation_checks), 0) AS check_count,
            (SELECT count(*) FROM jsonb_array_elements(r.validation_checks) c
              WHERE c->>'status' = 'warn') AS warn_count,
            (SELECT count(*) FROM weld w WHERE w.extraction_run_id = r.id) AS weld_count,
            (SELECT count(*) FROM extraction_edit e WHERE e.extraction_run_id = r.id) AS edit_count
       FROM extraction_run r
       JOIN document d ON d.id = r.document_id
      WHERE r.project_id = $1 AND r.status = 'extracted'
      ORDER BY r.engine_error IS NOT NULL DESC, warn_count DESC, r.created_at
      LIMIT $2`,
    [projectId, limit]);
  return rows.map((r) => ({
    runId: r.id,
    docNo: r.doc_no,
    revision: r.revision,
    sheetNo: r.sheet_no,
    status: r.status,
    model: r.model_name,
    engineError: r.engine_error,
    warnings: Number(r.warn_count),
    checks: Number(r.check_count),
    welds: Number(r.weld_count),
    edits: Number(r.edit_count),
    createdAt: r.created_at,
  }));
}

/**
 * Apply an engineer's correction to a run, recording every field they changed.
 *
 * The register is rebuilt from the corrected payload, not patched: the engine
 * is still the only thing that decides where a weld goes, and a corrected
 * coordinate can move a spool boundary two joints away.
 */
export async function applyCorrection(db, {
  projectId, runId, payload, reason = null, userId = null, options = {},
}) {
  const { rows: [run] } = await db.query(
    "SELECT * FROM extraction_run WHERE id = $1 AND project_id = $2", [runId, projectId]);
  if (!run) throw notFound("extraction run");
  if (run.locked_at) {
    throw Object.assign(
      new Error("این اجرا تأیید و قفل شده است. تغییر بعدی نیاز به رویژن جدید نقشه دارد."),
      { status: 409, code: "RUN_LOCKED" });
  }

  const edits = diffPayload(run.payload, payload);
  if (!edits.length) return { edits: [], run, register: await getRegister(db, { projectId, runId }) };

  const model = buildModel(payload, options);

  return db.transaction(async (tx) => {
    for (const e of edits) {
      await tx.query(
        `INSERT INTO extraction_edit (
           project_id, extraction_run_id, document_id, path, field, kind,
           before_value, after_value, reason, edited_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [projectId, runId, run.document_id, e.path, e.field, e.kind,
         JSON.stringify(e.before ?? null), JSON.stringify(e.after ?? null), reason, userId]);
    }

    await tx.query(
      `UPDATE extraction_run
          SET payload = $1, validation_checks = $2, engine_error = $3,
              status = (CASE WHEN $3::text IS NULL THEN 'extracted' ELSE 'failed' END)::run_status
        WHERE id = $4 AND project_id = $5`,
      [JSON.stringify(payload), JSON.stringify(model.error ? [] : model.checks),
       model.error || null, runId, projectId]);

    // The register is derived, so it is replaced wholesale. Identity is
    // carried from what was there a moment ago, so a correction to one
    // coordinate does not orphan the NDT record on an untouched weld.
    const previous = await getRegister(tx, { projectId, runId });
    await tx.query("DELETE FROM weld WHERE extraction_run_id = $1 AND project_id = $2",
      [runId, projectId]);
    await tx.query("DELETE FROM spool WHERE extraction_run_id = $1 AND project_id = $2",
      [runId, projectId]);

    if (!model.error) {
      await saveRegister(tx, {
        projectId, runId, documentId: run.document_id, lineId: run.line_id,
        model, carryFrom: previous,
      });
    }
    return { edits, register: await getRegister(tx, { projectId, runId }), engineError: model.error || null };
  });
}

export async function editsOf(db, { projectId, runId }) {
  const { rows } = await db.query(
    `SELECT e.*, u.display_name, u.subject
       FROM extraction_edit e LEFT JOIN app_user u ON u.id = e.edited_by
      WHERE e.project_id = $1 AND e.extraction_run_id = $2
      ORDER BY e.edited_at, e.path`,
    [projectId, runId]);
  return rows;
}

/**
 * Which fields the engineers keep correcting.
 *
 * This is the report that improves extraction. Aggregate accuracy tells you
 * the model is 94% right; this tells you WHICH field the other 6% is in, and
 * that is the one you can act on.
 */
export async function hotspots(db, { projectId, since = null }) {
  const { rows } = await db.query(
    `SELECT path, before_value, after_value FROM extraction_edit
      WHERE project_id = $1 AND ($2::timestamptz IS NULL OR edited_at >= $2::timestamptz)`,
    [projectId, since]);
  const spots = editHotspots(rows.map((r) => ({
    path: r.path, before: r.before_value, after: r.after_value })));
  const total = rows.length;
  return {
    totalEdits: total,
    fields: spots.map((s) => ({ ...s, share: total ? Math.round((s.count / total) * 1000) / 10 : 0 })),
  };
}

/** Is there already a signed register for this exact document revision? */
export async function approvedRunFor(db, { projectId, documentId }) {
  const { rows } = await db.query(
    `SELECT id, approved_at, approved_sha256 FROM extraction_run
      WHERE project_id = $1 AND document_id = $2 AND status = 'approved'
      ORDER BY approved_at DESC LIMIT 1`,
    [projectId, documentId]);
  return rows[0] || null;
}

const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
