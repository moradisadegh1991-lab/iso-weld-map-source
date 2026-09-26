/**
 * Drawings and their revisions.
 *
 * Call these inside `withProject` — row level security means a query issued
 * without a project scope returns nothing at all.
 */

/**
 * Register an uploaded sheet.
 *
 * Content addressing does the deduplication: if these exact bytes are already
 * on file for this project under the same drawing/revision/sheet, the
 * existing row comes back untouched and `created` is false. The caller uses
 * that to skip a model call, which is the expensive half.
 */
export async function registerDocument(db, {
  projectId, unitId = null, docNo, docType = "isometric",
  revision, revisionDate = null, sheetNo = "1/1",
  fileSha256, storageUri, contentType = null, byteSize = null, createdBy = null,
}) {
  const existing = await db.query(
    `SELECT * FROM document
      WHERE project_id = $1 AND doc_no = $2 AND revision = $3 AND sheet_no = $4`,
    [projectId, docNo, revision, sheetNo]);

  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.file_sha256 === fileSha256) return { document: row, created: false };
    // Same drawing number and revision, different bytes. That is a revision
    // discipline problem on the project, not something to paper over.
    const err = new Error(
      `${docNo} rev ${revision} sheet ${sheetNo} is already on file with different content ` +
      `(${row.file_sha256.slice(0, 12)} vs ${fileSha256.slice(0, 12)}). ` +
      `Issue a new revision rather than replacing one.`);
    err.code = "REVISION_CONTENT_CONFLICT";
    err.status = 409;
    throw err;
  }

  const { rows } = await db.query(
    `INSERT INTO document (project_id, unit_id, doc_no, doc_type, revision, revision_date,
                           sheet_no, file_sha256, storage_uri, content_type, byte_size, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [projectId, unitId, docNo, docType, revision, revisionDate, sheetNo,
     fileSha256, storageUri, contentType, byteSize, createdBy]);
  return { document: rows[0], created: true };
}

/** The revision currently in force for a drawing sheet, if any. */
export async function currentRevision(db, { projectId, docNo, sheetNo = "1/1" }) {
  const { rows } = await db.query(
    `SELECT * FROM document
      WHERE project_id = $1 AND doc_no = $2 AND sheet_no = $3 AND superseded_by IS NULL
      ORDER BY revision_date DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [projectId, docNo, sheetNo]);
  return rows[0] || null;
}

/**
 * Mark older revisions of the same sheet as superseded by this one.
 *
 * EPIC-2 builds the register diff on top of this; EPIC-1 only needs the
 * pointer to exist and be set exactly once per superseded row.
 */
export async function supersedePrevious(db, { projectId, documentId }) {
  const { rows: [doc] } = await db.query(
    "SELECT doc_no, sheet_no FROM document WHERE id = $1 AND project_id = $2",
    [documentId, projectId]);
  if (!doc) return [];
  const { rows } = await db.query(
    `UPDATE document SET superseded_by = $1
      WHERE project_id = $2 AND doc_no = $3 AND sheet_no = $4
        AND id <> $1 AND superseded_by IS NULL
      RETURNING id, revision`,
    [documentId, projectId, doc.doc_no, doc.sheet_no]);
  return rows;
}

export async function findBySha(db, { projectId, fileSha256 }) {
  const { rows } = await db.query(
    "SELECT * FROM document WHERE project_id = $1 AND file_sha256 = $2 ORDER BY created_at",
    [projectId, fileSha256]);
  return rows;
}
