/**
 * The review queue, the edit log, and the lock.
 *
 * Call inside `withProject`.
 */
import { diffPayload, editHotspots } from "../../review/payload-diff.mjs";
import { assertEditable } from "../../platform/workflow.mjs";
import { getRegister } from "./runs.mjs";
import { payloadHash } from "../../review/payload-hash.mjs";
import { persistRegister, touchesSheetData, prepareSheetPayload, recordMarkWarnings } from "./register-persistence.mjs";
import { modelFor } from "../../register/weld-list.mjs";

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
  projectId, runId, payload, reason = null, userId = null, options = {}, baseHash = null,
}) {
  const { rows: [run] } = await db.query(
    "SELECT * FROM extraction_run WHERE id = $1 AND project_id = $2", [runId, projectId]);
  if (!run) throw notFound("extraction run");
  // Who may be written to, and who may not, is decided by
  // lib/platform/workflow.mjs — not by a second copy of the rule here. The
  // database trigger on `extraction_run` refuses the same write independently,
  // so a future script that bypasses this repository is still stopped.
  assertEditable(run.status);

  // A row gaining its persistent identity (or a place keyed by it) is not a human correction of what was read
  const edits = diffPayload(run.payload, payload).filter((e) => !(e.kind === "added" && /^weldList\[\d+\]\.uid$/.test(e.path)) && !/^weldMarkup\.byUid\./.test(e.path));
  if (!edits.length) return { edits: [], run, register: await getRegister(db, { projectId, runId }), payloadHash: payloadHash(run.payload) };

  const model = modelFor(payload, options);

  return db.transaction(async (tx) => {
    // A correction made against a state that is no longer the stored one is refused, not merged over it: the run row is locked and read
    // again, so two engineers correcting the same run are taken in turn and the second learns it was working on an old copy.
    if (baseHash) {
      const { rows: [cur] } = await tx.query("SELECT payload FROM extraction_run WHERE id = $1 AND project_id = $2 FOR UPDATE", [runId, projectId]);
      if (!cur || payloadHash(cur.payload) !== baseHash) {
        throw Object.assign(new Error("این اجرا از وقتی باز کردید توسط کس دیگری (یا در پنجرهٔ دیگری) تغییر کرده است؛ تغییرات شما رویش نوشته نشد. اجرا را دوباره باز کنید و تغییر را روی نسخهٔ تازه انجام دهید."),
          { status: 409, code: "STALE_RUN" });
      }
    }
    // The marks keep the identity they carry; one typed in without any is settled against the marks this run had
    // (lib/sheet/mark-identity.mjs) BEFORE the payload is stored, so what is stored carries identities.
    let corrected = payload, markReport = null;
    if (!model.error) {
      ({ payload: corrected, report: markReport } = await prepareSheetPayload(tx, { projectId, documentId: run.document_id,
        previousItems: run.payload?.sheetMarkup?.items || [], previousRows: run.payload?.weldList || [], payload }));
    }
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
      [JSON.stringify(corrected), JSON.stringify(model.error ? [] : model.checks),
       model.error || null, runId, projectId]);

    // The register is derived, so it is replaced wholesale. Identity is
    // carried from what was there a moment ago, so a correction to one
    // coordinate does not orphan the NDT record on an untouched weld.
    const previous = await getRegister(tx, { projectId, runId });

    // What hangs off the sheet — BOM, equipment, allocations — is made from the payload's `bom` and `sheetMarkup`. A correction
    // that touches them re-makes them with the same rules a save has (lib/db/repos/register-persistence.mjs): `bom` absent
    // leaves the saved BOM, [] clears it only if nothing holds it, rows replace it; nothing installed is dropped; an approved
    // BOM is not changed. They belong to the DRAWING REVISION, so only the revision's current run may change them.
    const dependents = touchesSheetData(edits);
    if (dependents) {
      const { rows: [latest] } = await tx.query(
        `SELECT id FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND engine_error IS NULL
          ORDER BY created_at DESC, id DESC LIMIT 1`, [projectId, run.document_id]);
      if (latest && latest.id !== runId) {
        throw Object.assign(new Error("این اجرا آخرین اجرای این رویژن نیست؛ BOM و نشانه‌های نقشه فقط با آخرین اجرا تغییر می‌کنند. اصلاح را روی آخرین اجرا انجام دهید."),
          { status: 409, code: "RUN_NOT_CURRENT" });
      }
    }
    const { dependents: synced } = await persistRegister(tx, {
      projectId, runId, documentId: run.document_id, lineId: run.line_id, model, carryFrom: previous,
      payload: corrected, userId, replaceRegister: true, syncDependents: dependents && !model.error,
    });
    if (markReport) await recordMarkWarnings(tx, { projectId, documentId: run.document_id, runId, report: markReport });
    return { edits, register: await getRegister(tx, { projectId, runId }), engineError: model.error || null, payloadHash: payloadHash(corrected), ...(synced ? { sheetData: synced } : {}),
      ...(markReport && (markReport.matched.length || markReport.created.length || markReport.ambiguous.length) ? { markIdentity: { kept: markReport.kept, matched: markReport.matched.length, created: markReport.created.length, removed: markReport.removed, ambiguous: markReport.ambiguous } } : {}) };
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
