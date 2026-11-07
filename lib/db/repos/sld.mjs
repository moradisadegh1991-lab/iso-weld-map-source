/**
 * SLD drafts — Phase 12.2: document intake and ISOLATED persistence (docs/audit/phase-12-sld-intelligence.md §16.3). Call inside `withProject`.
 *
 *   · a draft is an `extraction_run` (pass_name 'sld') bound to the DOCUMENT of one sheet revision (document type 'sld': lib/documents/types.mjs);
 *   · its payload is the opaque envelope of lib/sld/envelope.mjs — nothing in `items`/`edges` is interpreted here;
 *   · ingest is idempotent by `source.hash`; an edit names the state it was made against (`baseHash`) and a stale one is refused (409 STALE_RUN);
 *   · approval (the shared `approveRun`: who, when, sha256) LOCKS the run — here (RUN_LOCKED) and in the database (trigger `refuse_locked_edit`);
 *   · approval PROMOTES NOTHING: no tag, asset, cable, subsystem or any register is written by anything in this file;
 *   · revisions: each revision is its own document and therefore its own draft; no state is copied from an earlier revision.
 * The isometric workflows never see these runs (lib/db/run-scope.mjs).
 */
import { assertEditable } from "../../platform/workflow.mjs";
import { approveRun } from "./runs.mjs";
import { payloadHash } from "../../review/payload-hash.mjs";
import { validateEnvelope } from "../../sld/envelope.mjs";

const PASS = "sld";
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const text = (v) => String(v ?? "").trim();
/** JSON with object keys sorted, so two equal documents compare equal whatever order a JSON column returned them in. */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

async function docRow(db, projectId, documentId, { lock = false } = {}) {
  const { rows: [d] } = await db.query(
    `SELECT id, doc_no, revision, sheet_no, doc_type FROM document WHERE id = $1 AND project_id = $2${lock ? " FOR UPDATE" : ""}`, [documentId, projectId]);
  if (!d) throw fail(404, "NOT_FOUND", "document not found");
  if (d.doc_type !== "sld") throw fail(409, "NOT_AN_SLD_DOCUMENT", `this document is a ${d.doc_type} drawing; SLD drafts are filed only against single-line-diagram documents`, { details: { docType: d.doc_type } });
  return d;
}

async function runOf(db, projectId, runId, { lock = false } = {}) {
  const { rows: [r] } = await db.query(`SELECT * FROM extraction_run WHERE id = $1 AND project_id = $2${lock ? " FOR UPDATE" : ""}`, [runId, projectId]);
  if (!r) throw fail(404, "NOT_FOUND", "run not found");
  if (r.pass_name !== PASS) throw fail(409, "NOT_AN_SLD_RUN", "this run is not an SLD draft");
  return r;
}

const counts = (p) => ({ items: Array.isArray(p?.items) ? p.items.length : 0, edges: Array.isArray(p?.edges) ? p.edges.length : 0 });
const view = (r) => ({ id: r.id, documentId: r.document_id, status: r.status, createdAt: r.created_at, createdBy: r.created_by ?? null,
  approvedBy: r.approved_by, approvedAt: r.approved_at, approvedSha256: r.approved_sha256 || null, lockedAt: r.locked_at ?? null,
  payloadHash: payloadHash(r.payload), sourceHash: r.payload?.source?.hash ?? null, reader: r.payload?.source?.reader ?? null, ...counts(r.payload) });
const stamp = (env, d) => ({ ...env, meta: { ...env.meta, document: { documentId: d.id, docNo: d.doc_no, revision: d.revision, sheetNo: d.sheet_no } } });

/**
 * File a draft against an SLD document revision. Idempotent: the same reading (its `source.hash`) of the same document returns the existing draft and
 * creates nothing. A different reading of a document whose draft is already signed off is refused (RUN_LOCKED): change after approval is a new revision.
 * @returns {{ run, created: boolean }}
 */
export async function ingestDraft(db, { projectId, documentId, draft, userId = null }) {
  const env = validateEnvelope(draft);                                   // shape and size only (400 INVALID_ENVELOPE / 413 PAYLOAD_TOO_LARGE)
  const d = await docRow(db, projectId, documentId, { lock: true });     // two ingests of one revision are taken in turn
  const { rows: [same] } = await db.query(
    "SELECT * FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND pass_name = $3 AND payload->'source'->>'hash' = $4 ORDER BY created_at LIMIT 1",
    [projectId, documentId, PASS, env.source.hash]);
  if (same) return { run: view(same), created: false };
  const { rows: [signed] } = await db.query("SELECT id FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND pass_name = $3 AND status = 'approved' LIMIT 1", [projectId, documentId, PASS]);
  if (signed) throw fail(409, "RUN_LOCKED", "this revision's SLD draft is signed off; a different reading needs a new document revision", { details: { runId: signed.id } });
  const { rows: [r] } = await db.query(
    `INSERT INTO extraction_run (project_id, document_id, model_name, pass_name, payload, validation_checks, status, created_by)
     VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,'extracted',$6) RETURNING *`,
    [projectId, documentId, text(env.source.reader).slice(0, 120) || null, PASS, JSON.stringify(stamp(env, d)), userId]);
  return { run: view(r), created: true };
}

/** The drafts of one SLD document, newest first (no payloads). */
export async function listDrafts(db, { projectId, documentId }) {
  const d = await docRow(db, projectId, documentId);
  const { rows } = await db.query(
    "SELECT * FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND pass_name = $3 AND status <> 'failed' ORDER BY created_at DESC, id DESC", [projectId, documentId, PASS]);
  return { document: { id: d.id, docNo: d.doc_no, revision: d.revision, sheetNo: d.sheet_no }, drafts: rows.map(view) };
}

/** One draft with its payload: the given run, else the document's latest. */
export async function getDraft(db, { projectId, documentId, runId = null }) {
  const d = await docRow(db, projectId, documentId);
  let r;
  if (runId) { r = await runOf(db, projectId, runId); if (r.document_id !== documentId) throw fail(404, "NOT_FOUND", "run not found for this document"); }
  else ({ rows: [r] } = await db.query("SELECT * FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND pass_name = $3 AND status <> 'failed' ORDER BY created_at DESC, id DESC LIMIT 1", [projectId, documentId, PASS]));
  if (!r) throw fail(404, "NO_DRAFT", "no SLD draft has been filed for this document");
  return { run: view(r), document: { id: d.id, docNo: d.doc_no, revision: d.revision, sheetNo: d.sheet_no }, draft: r.payload };
}

/** The project's SLD documents with the state of their latest draft (for choosing which one to open). */
export async function listSldDocuments(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT d.id, d.doc_no, d.revision, d.sheet_no, d.created_at, r.id AS run_id, r.status AS run_status,
            (SELECT count(*)::int FROM jsonb_array_elements(r.payload->'items')) AS items
       FROM document d
       LEFT JOIN LATERAL (SELECT id, status, payload FROM extraction_run WHERE project_id = d.project_id AND document_id = d.id AND pass_name = $2 AND status <> 'failed'
                           ORDER BY created_at DESC, id DESC LIMIT 1) r ON true
      WHERE d.project_id = $1 AND d.doc_type = 'sld' ORDER BY d.doc_no, d.sheet_no, d.created_at`, [projectId, PASS]);
  return rows.map((x) => ({ documentId: x.id, docNo: x.doc_no, revision: x.revision, sheetNo: x.sheet_no, runId: x.run_id, runStatus: x.run_status, items: x.items ?? 0 }));
}

/**
 * A person's replacement of the draft's envelope. `baseHash` (the run's `payloadHash` as last read) is REQUIRED: without it an edit would be last-write-wins.
 * 409 STALE_RUN when the run changed since; 409 RUN_LOCKED when it is signed off (the database refuses the same write independently).
 */
export async function editDraft(db, { projectId, runId, draft, baseHash, reason = null, userId = null }) {
  if (!text(baseHash)) throw fail(400, "INVALID_INPUT", "baseHash is required (the payloadHash of the draft you edited)");
  const env = validateEnvelope(draft);
  return db.transaction(async (tx) => {
    const r = await runOf(tx, projectId, runId, { lock: true });
    assertEditable(r.status);                                             // an approved run → 409 RUN_LOCKED
    if (payloadHash(r.payload) !== baseHash) throw fail(409, "STALE_RUN", "this draft changed since you opened it; reload it and edit again");
    const d = await docRow(tx, projectId, r.document_id);
    const next = stamp(env, d);
    if (canon(next) === canon(r.payload)) return { run: view(r), changed: false };      // same content (jsonb reorders keys: compared canonically)
    const { rows: [n] } = await tx.query("UPDATE extraction_run SET payload = $1 WHERE id = $2 AND project_id = $3 RETURNING *", [JSON.stringify(next), runId, projectId]);
    await tx.query(
      `INSERT INTO extraction_edit (project_id, extraction_run_id, document_id, path, field, kind, before_value, after_value, reason, edited_by)
       VALUES ($1,$2,$3,'/','draft','changed',$4,$5,$6,$7)`,
      [projectId, runId, r.document_id, JSON.stringify({ hash: payloadHash(r.payload), ...counts(r.payload) }), JSON.stringify({ hash: payloadHash(next), ...counts(next) }), reason, userId]);
    return { run: view(n), changed: true };
  });
}

/** Sign the draft (the existing approval: who, when, sha256 of what was signed) and lock it. Promotes nothing. Approving twice is a no-op. */
export async function approveDraft(db, { projectId, runId, userId }) {
  return db.transaction(async (tx) => {
    const r = await runOf(tx, projectId, runId, { lock: true });
    if (r.status === "approved") return { run: view(r), repeated: true };
    assertEditable(r.status);
    await approveRun(tx, { projectId, runId, userId });
    const { rows: [n] } = await tx.query("SELECT * FROM extraction_run WHERE id = $1 AND project_id = $2", [runId, projectId]);
    return { run: view(n), repeated: false };
  });
}
