/**
 * Extraction runs and the register they produce.
 *
 * An extraction run is the audit record of one model pass over one document
 * revision: what was extracted, what the engine's checks said about it, what
 * it cost in tokens, and who — if anyone — signed it off. The weld and spool
 * rows hang off it, so the register is never a free-floating claim: it always
 * points back at the run that computed it and the document bytes that run
 * read.
 *
 * Call these inside `withProject`.
 */
import { weldUid, absolutePosition } from "../weld-uid.mjs";
import { createHash } from "node:crypto";

export async function createRun(db, {
  projectId, documentId, lineId = null,
  modelName = null, modelVersion = null, passName = null,
  inputTokens = null, outputTokens = null, rawOutputUri = null,
  payload, validationChecks = [], engineError = null, createdBy = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO extraction_run (
       project_id, document_id, line_id, model_name, model_version, pass_name,
       input_tokens, output_tokens, raw_output_uri, payload, validation_checks,
       engine_error, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [projectId, documentId, lineId, modelName, modelVersion, passName,
     inputTokens, outputTokens, rawOutputUri,
     JSON.stringify(payload), JSON.stringify(validationChecks),
     engineError, engineError ? "failed" : "extracted", createdBy]);
  return rows[0];
}

/**
 * Persist the register a `buildModel` result describes.
 *
 * Spools first, because welds reference them. Both in one transaction: half a
 * register on disk is worse than none, since it would look complete.
 */
export async function saveRegister(db, { projectId, runId, documentId, lineId = null, lineNo, model }) {
  if (model?.error) throw new Error(`refusing to save a register from a failed model: ${model.error}`);

  const lengthBySpool = new Map();
  const npsBySpool = new Map();
  for (const el of model.elements || []) {
    if (el.kind === "fitting") continue;
    lengthBySpool.set(el.spool, (lengthBySpool.get(el.spool) || 0) + (Number(el.length) || 0));
    npsBySpool.set(el.spool, Math.max(npsBySpool.get(el.spool) || 0, Number(el.nps) || 0));
  }

  return db.transaction(async (tx) => {
    const spoolIds = new Map();
    for (const spoolNo of model.spoolIds || []) {
      const { rows } = await tx.query(
        `INSERT INTO spool (project_id, extraction_run_id, line_id, spool_no, length_mm, nps_max)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [projectId, runId, lineId, spoolNo,
         round2(lengthBySpool.get(spoolNo) || 0), npsBySpool.get(spoolNo) || null]);
      spoolIds.set(spoolNo, rows[0].id);
    }

    const welds = [];
    for (const w of model.register || []) {
      const pos = absolutePosition(model.origin, w.at);
      const uid = weldUid({ lineNo, kind: w.kind, ...pos });
      const { rows } = await tx.query(
        `INSERT INTO weld (
           project_id, extraction_run_id, document_id, line_id, spool_id,
           weld_uid, weld_no, weld_kind, shop_field, joint_role,
           nps, elevation_mm, ndt_requirement, pos_e, pos_n, pos_el)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id, weld_uid, weld_no`,
        [projectId, runId, documentId, lineId, spoolIds.get(w.spool) || null,
         uid, w.no, w.kind, w.loc, w.role,
         Number(w.nps) || null, w.el, w.ndt,
         round3(pos.e), round3(pos.n), round3(pos.el)]);
      welds.push(rows[0]);
    }
    return { spools: spoolIds.size, welds };
  });
}

/**
 * Sign off a register.
 *
 * The hash of what was approved is stored with the approval. An approval that
 * did not record what it covered is not an approval — it is a timestamp.
 * Callers must check permission first (`assertCan(..., APPROVE_REGISTER)`);
 * this function enforces the data invariant, not the policy.
 */
export async function approveRun(db, { projectId, runId, userId }) {
  const { rows: [run] } = await db.query(
    "SELECT id, status, payload, validation_checks FROM extraction_run WHERE id = $1 AND project_id = $2",
    [runId, projectId]);
  if (!run) throw notFound("extraction run");
  if (run.status === "approved") return run;
  if (run.status === "failed") {
    const err = new Error("a failed run cannot be approved");
    err.status = 409;
    throw err;
  }

  const { rows: welds } = await db.query(
    `SELECT weld_no, weld_kind, shop_field, joint_role, nps, pos_e, pos_n, pos_el
       FROM weld WHERE extraction_run_id = $1 AND project_id = $2 ORDER BY weld_no`,
    [runId, projectId]);

  const digest = createHash("sha256")
    .update(JSON.stringify({ payload: run.payload, welds }))
    .digest("hex");

  const { rows } = await db.query(
    `UPDATE extraction_run
        SET status = 'approved', approved_by = $1, approved_at = now(), approved_sha256 = $2
      WHERE id = $3 AND project_id = $4
      RETURNING *`,
    [userId, digest, runId, projectId]);
  return rows[0];
}

export async function getRegister(db, { projectId, runId }) {
  const { rows } = await db.query(
    `SELECT w.weld_no, w.weld_uid, w.weld_kind, w.shop_field, w.joint_role,
            w.nps, w.elevation_mm, w.ndt_requirement, s.spool_no
       FROM weld w
       LEFT JOIN spool s ON s.id = w.spool_id
      WHERE w.extraction_run_id = $1 AND w.project_id = $2
      ORDER BY w.weld_no`,
    [runId, projectId]);
  return rows;
}

export async function latestRunForDocument(db, { projectId, documentId }) {
  const { rows } = await db.query(
    `SELECT * FROM extraction_run
      WHERE project_id = $1 AND document_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [projectId, documentId]);
  return rows[0] || null;
}

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const notFound = (what) => {
  const e = new Error(`${what} not found`);
  e.status = 404;
  return e;
};
