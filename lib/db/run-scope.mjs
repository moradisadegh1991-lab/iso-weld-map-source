/**
 * Which extraction runs belong to an ISOMETRIC workflow (docs/audit/phase-12-sld-intelligence.md §15.1, §16.3).
 *
 * `extraction_run` is shared by every drawing discipline (P&ID drafts use pass 'pid', SLD drafts pass 'sld'), and `reporting.current_run` picks one run
 * per document with no type filter. A reader that counts, lists, corrects or approves "runs" for the weld register must therefore say so explicitly.
 * The authoritative discriminator is the DOCUMENT'S type (`document.doc_type`, set once at registration, closed set lib/documents/types.mjs) — not the
 * free-text `pass_name`, which a client can set. Every isometric-only query uses these helpers instead of its own deny-list.
 *
 * Backward compatibility: every document filed before Phase 12.2 is `isometric` or `pid` (the column default is 'isometric'), so for data with no
 * non-isometric document each predicate below is TRUE for every row and the guarded queries return what they returned before.
 * Call the async guards inside `withProject` (row level security scopes the lookups).
 */
export const ISOMETRIC = "isometric";

/** SQL fragment: the document alias is an isometric drawing. `alias` is a literal identifier chosen by the caller, never user input. */
export const isIsometricDoc = (alias = "d") => `${alias}.doc_type = '${ISOMETRIC}'`;

/** The pass names reserved for other disciplines: an isometric run may not carry one (POST /api/runs). */
export const RESERVED_PASS_NAMES = Object.freeze(["pid", "sld"]);

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });

/** An isometric run may not be filed under another discipline's pass name. @throws 400 INVALID_PASS_NAME */
export function assertPassNameAllowed(passName) {
  const p = String(passName ?? "").trim().toLowerCase();
  if (p && RESERVED_PASS_NAMES.includes(p)) throw fail(400, "INVALID_PASS_NAME", `pass name «${p}» is reserved for another drawing discipline`);
}

/**
 * The run must exist in this project and belong to an isometric drawing.
 * @throws 404 (no such run in this project) · 409 NOT_AN_ISOMETRIC_RUN
 * @returns {Promise<{id, document_id, doc_type, pass_name, status}>}
 */
export async function assertIsometricRun(db, { projectId, runId }) {
  const { rows: [r] } = await db.query(
    `SELECT r.id, r.document_id, r.pass_name, r.status, d.doc_type
       FROM extraction_run r JOIN document d ON d.id = r.document_id AND d.project_id = r.project_id
      WHERE r.id = $1 AND r.project_id = $2`, [runId, projectId]);
  if (!r) throw fail(404, "NOT_FOUND", "extraction run not found");
  if (r.doc_type !== ISOMETRIC) throw fail(409, "NOT_AN_ISOMETRIC_RUN", `this run belongs to a ${r.doc_type} drawing; the isometric register workflow does not apply`, { docType: r.doc_type });
  return r;
}

/**
 * The document must exist in this project and be an isometric drawing (routes addressed by DOCUMENT id).
 * @throws 404 (unless allowMissing) · 409 NOT_AN_ISOMETRIC_DOCUMENT
 */
export async function assertIsometricDocument(db, { projectId, documentId, allowMissing = false }) {
  const { rows: [d] } = await db.query("SELECT id, doc_no, doc_type FROM document WHERE id = $1 AND project_id = $2", [documentId, projectId]);
  // `allowMissing`: a routine that already answered "no such document" in its own way keeps doing so; only an EXISTING non-isometric drawing is refused
  if (!d) { if (allowMissing) return null; throw fail(404, "NOT_FOUND", "document not found"); }
  if (d.doc_type !== ISOMETRIC) throw fail(409, "NOT_AN_ISOMETRIC_DOCUMENT", `this document is a ${d.doc_type} drawing; the isometric register workflow does not apply`, { docType: d.doc_type });
  return d;
}

/** The refusal of every isometric-only record reached through a CHILD id: the owning drawing is not an isometric. */
const refuse = (docType) => fail(409, "NOT_AN_ISOMETRIC_DOCUMENT", `this record belongs to a ${docType} drawing; the isometric register workflow does not apply`, { docType });

/**
 * An isometric-only record addressed by its own id (an equipment accessory, a mark warning, a BOM allocation) must belong to an isometric drawing of THIS project:
 * the owning document is resolved from the database inside the project scope, never taken from the client. A record that does not exist (or is another project's)
 * keeps the caller's own not-found answer (`allowMissing`, the default here): only an EXISTING record of another discipline's drawing is refused.
 * @throws 409 NOT_AN_ISOMETRIC_DOCUMENT
 */
async function assertIsometricOwner(db, sql, params) {
  const { rows: [r] } = await db.query(sql, params);
  if (r && r.doc_type !== ISOMETRIC) throw refuse(r.doc_type);
  return r || null;
}
export const assertIsometricAccessory = (db, { projectId, accessoryId }) => assertIsometricOwner(db,
  `SELECT d.doc_type FROM iso_equipment_accessory a JOIN iso_equipment e ON e.id = a.equipment_id AND e.project_id = a.project_id
     JOIN document d ON d.id = e.document_id AND d.project_id = e.project_id WHERE a.id = $1 AND a.project_id = $2`, [accessoryId, projectId]);
export const assertIsometricWarning = (db, { projectId, warningId }) => assertIsometricOwner(db,
  `SELECT d.doc_type FROM sheet_mark_warning w JOIN document d ON d.id = w.document_id AND d.project_id = w.project_id WHERE w.id::text = $1::text AND w.project_id = $2`, [String(warningId), projectId]);
export const assertIsometricAllocation = (db, { projectId, allocationId }) => assertIsometricOwner(db,
  `SELECT d.doc_type FROM bom_allocation a JOIN document d ON d.id = a.document_id AND d.project_id = a.project_id WHERE a.id = $1 AND a.project_id = $2`, [allocationId, projectId]);
