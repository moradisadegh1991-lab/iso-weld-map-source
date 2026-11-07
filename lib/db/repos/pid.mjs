/**
 * P&ID drafts in the platform (docs/audit/phase-11-pid-intelligence.md). No new tables and no new registry:
 *   · a draft is an `extraction_run` (pass_name 'pid') bound to the DOCUMENT of one drawing revision (document control: doc_no, revision, sheet,
 *     file checksum); every item stamps that revision as its source;
 *   · a person's correction / approval is audited in `extraction_edit` (path, field, before, after, who, when), a stale edit is refused by the
 *     same `baseHash` contract as the isometric register (409 STALE_RUN), an approved run is locked (RUN_LOCKED: lib/platform/workflow.mjs);
 *   · the whole draft is signed off by the existing `approveRun` (approved_by / approved_at / approved_sha256 of what was signed);
 *   · asset links are PROPOSED from the existing registers (tag / instrument / line) — nothing is created from a reading.
 * Call inside `withProject`.
 */
import { assertEditable } from "../../platform/workflow.mjs";
import { approveRun } from "./runs.mjs";
import { payloadHash } from "../../review/payload-hash.mjs";
import { applyReview, undecided, summary } from "../../pid/review.mjs";
import { comparePid, confirmMapping } from "../../pid/compare.mjs";
import { validatePid } from "../../engineering/validation.mjs";

const text = (v) => String(v ?? "").trim();
const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const key = (s) => text(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

async function docRow(db, projectId, documentId) {
  const { rows: [d] } = await db.query("SELECT id, doc_no, revision, sheet_no, doc_type, file_sha256 FROM document WHERE id = $1 AND project_id = $2", [documentId, projectId]);
  if (!d) throw fail(404, "NOT_FOUND", "document not found");
  return d;
}
const asView = (r) => ({ id: r.id, documentId: r.document_id, status: r.status, createdAt: r.created_at, approvedBy: r.approved_by, approvedAt: r.approved_at, payloadHash: payloadHash(r.payload) });

/**
 * File a draft against a drawing revision. Idempotent: the same reading (its `source.hash`) of the same document returns the existing draft and
 * creates nothing — a retried extraction does not duplicate records. A different reading of a document whose draft is already signed off is refused
 * (RUN_LOCKED): change after approval is a new revision.
 */
export async function ingestDraft(db, { projectId, documentId, draft, userId = null, reader = "pid" }) {
  if (draft?.kind !== "pid" || !Array.isArray(draft.items)) throw fail(400, "INVALID_INPUT", "a P&ID draft is required");
  const d = await docRow(db, projectId, documentId);
  await db.query("SELECT id FROM document WHERE id = $1 AND project_id = $2 FOR UPDATE", [documentId, projectId]);       // two ingests of one revision are taken in turn
  const hash = text(draft.source?.hash);
  if (hash) {
    const { rows: [same] } = await db.query("SELECT * FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND pass_name = 'pid' AND payload->'source'->>'hash' = $3 ORDER BY created_at LIMIT 1", [projectId, documentId, hash]);
    if (same) return { run: asView(same), created: false };
  }
  const { rows: [signed] } = await db.query("SELECT id FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND pass_name = 'pid' AND status = 'approved' LIMIT 1", [projectId, documentId]);
  if (signed) throw fail(409, "RUN_LOCKED", "پیش‌نویس P&ID این رویژن تأیید شده؛ برای تغییر رویژن جدید ثبت کنید");
  // every record keeps its source document and revision
  const stamp = { documentId: d.id, docNo: d.doc_no, revision: d.revision, sheetNo: d.sheet_no, fileSha256: d.file_sha256 };
  const payload = { ...draft, meta: { ...draft.meta, drawingNo: draft.meta?.drawingNo || d.doc_no, revision: draft.meta?.revision ?? d.revision, document: stamp },
    items: draft.items.map((i) => ({ ...i, source: { ...(i.source || {}), revision: d.revision }, review: { status: "extracted" } })),
    edges: (draft.edges || []).map((e) => ({ ...e, review: { status: "extracted" } })), mappings: [] };
  const { rows: [run] } = await db.query(
    `INSERT INTO extraction_run (project_id, document_id, model_name, pass_name, payload, validation_checks, status, created_by)
     VALUES ($1,$2,$3,'pid',$4,'[]'::jsonb,'extracted',$5) RETURNING *`, [projectId, documentId, text(reader).slice(0, 80), JSON.stringify(payload), userId]);
  return { run: asView(run), created: true };
}

async function runOf(db, projectId, runId, { lock = false } = {}) {
  const { rows: [r] } = await db.query(`SELECT * FROM extraction_run WHERE id = $1 AND project_id = $2 AND pass_name = 'pid'${lock ? " FOR UPDATE" : ""}`, [runId, projectId]);
  if (!r) throw fail(404, "NOT_FOUND", "P&ID draft not found");
  return r;
}

/** The current draft of a document: the run, its draft, the validation (the same engine), the registers' inputs and the asset link proposals. */
export async function getDraft(db, { projectId, documentId = null, runId = null }) {
  const { rows: [r] } = runId
    ? await db.query("SELECT * FROM extraction_run WHERE id = $1 AND project_id = $2 AND pass_name = 'pid'", [runId, projectId])
    : await db.query("SELECT * FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND pass_name = 'pid' AND status <> 'failed' ORDER BY created_at DESC, id DESC LIMIT 1", [projectId, documentId]);
  if (!r) throw fail(404, "NOT_FOUND", "no P&ID draft for this document");
  const d = await docRow(db, projectId, r.document_id);
  const directory = (await db.query("SELECT DISTINCT doc_no FROM document WHERE project_id = $1 AND doc_type = 'pid'", [projectId])).rows.map((x) => ({ docNo: x.doc_no }));
  const links = await linkProposals(db, { projectId, draft: r.payload });
  const validation = validatePid({ draft: r.payload, revision: { documentId: d.id, docNo: d.doc_no, rev: d.revision, sheet: d.sheet_no, runId: r.id, status: r.status }, directory, source: "saved" });
  return { run: asView(r), document: { id: d.id, docNo: d.doc_no, revision: d.revision, sheetNo: d.sheet_no, docType: d.doc_type }, draft: r.payload, validation, links, directory, reviewSummary: summary(r.payload) };
}

/**
 * One person's action on one record: correct / approve / reject / flag / mark unresolved|ambiguous / reopen. One transaction: the run row is locked,
 * the base hash checked (409 STALE_RUN), the run's own lock respected (RUN_LOCKED), the audit edits written with the draft.
 */
export async function reviewItem(db, { projectId, runId, uid, action, value = null, reason = null, userId, baseHash = null }) {
  return db.transaction(async (tx) => {
    const r = await runOf(tx, projectId, runId, { lock: true });
    assertEditable(r.status);
    if (baseHash && payloadHash(r.payload) !== baseHash) throw fail(409, "STALE_RUN", "این پیش‌نویس از وقتی باز کردید تغییر کرده است؛ دوباره باز کنید");
    const { draft, edits } = applyReview(r.payload, { uid, action, value, reason, by: userId });
    if (!edits.length) return { run: asView(r), draft: r.payload, changed: false };
    const { rows: [n] } = await tx.query("UPDATE extraction_run SET payload = $1 WHERE id = $2 AND project_id = $3 RETURNING *", [JSON.stringify(draft), runId, projectId]);
    for (const e of edits) await tx.query(
      `INSERT INTO extraction_edit (project_id, extraction_run_id, document_id, path, field, kind, before_value, after_value, reason, edited_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [projectId, runId, r.document_id, e.path, e.field, e.kind, JSON.stringify(e.before ?? null), JSON.stringify(e.after ?? null), reason, userId]);
    return { run: asView(n), draft: n.payload, changed: true, edits: edits.length };
  });
}

/** Sign off the whole draft: every record decided by a person, no engineering ERROR left among the live ones. Uses the existing approval (hash of what was signed). */
export async function approveDraft(db, { projectId, runId, userId }) {
  return db.transaction(async (tx) => {
    const r = await runOf(tx, projectId, runId, { lock: true });
    if (r.status === "approved") return { run: asView(r), repeated: true };
    assertEditable(r.status);
    const open = undecided(r.payload);
    if (open.length) throw fail(409, "UNDECIDED", `${open.length} رکورد هنوز تعیین تکلیف نشده؛ تأیید کل پیش‌نویس ممکن نیست`, { details: { undecided: open } });
    const d = await docRow(tx, projectId, r.document_id);
    const v = validatePid({ draft: r.payload, revision: { documentId: d.id, docNo: d.doc_no, rev: d.revision, runId, status: r.status } });
    const errors = v.findings.filter((f) => f.severity === "error");
    if (errors.length) throw fail(409, "ENGINEERING_ERRORS", `${errors.length} خطای مهندسی هنوز باز است`, { details: { findings: errors.map((f) => ({ id: f.id, code: f.code, entityUid: f.entityUid })) } });
    const signed = await approveRun(tx, { projectId, runId, userId });
    return { run: asView(signed), repeated: false };
  });
}

/** Compare the latest drafts of two revisions of one drawing sheet (read-only). */
export async function compareDrafts(db, { projectId, fromDocumentId, toDocumentId }) {
  const a = await docRow(db, projectId, fromDocumentId), b = await docRow(db, projectId, toDocumentId);
  if (a.id === b.id) throw fail(400, "INVALID_INPUT", "choose two different revisions");
  if (a.doc_no !== b.doc_no || a.sheet_no !== b.sheet_no) throw fail(409, "INVALID_LINEAGE", "the two revisions are not of the same drawing sheet");
  const [fa, fb] = await Promise.all([getDraft(db, { projectId, documentId: a.id }), getDraft(db, { projectId, documentId: b.id })]);
  return { from: { documentId: a.id, revision: a.revision, runId: fa.run.id, hash: fa.run.payloadHash }, to: { documentId: b.id, revision: b.revision, runId: fb.run.id, hash: fb.run.payloadHash, locked: fb.run.status === "approved" },
    ...comparePid({ from: fa.draft, to: fb.draft }) };
}

/** A person confirms ONE mapping (source item → target item) on the TARGET draft. Refused on a signed-off target; stale-checked; audited. */
export async function confirmDraftMapping(db, { projectId, targetRunId, sourceRunId, fromUid, toUid, userId, baseHash = null }) {
  return db.transaction(async (tx) => {
    const t = await runOf(tx, projectId, targetRunId, { lock: true }), s = await runOf(tx, projectId, sourceRunId);
    assertEditable(t.status);
    const [dt, ds] = await Promise.all([docRow(tx, projectId, t.document_id), docRow(tx, projectId, s.document_id)]);
    if (dt.doc_no !== ds.doc_no || dt.sheet_no !== ds.sheet_no || dt.id === ds.id) throw fail(409, "INVALID_LINEAGE", "the two drafts are not two revisions of one drawing sheet");
    if (baseHash && payloadHash(t.payload) !== baseHash) throw fail(409, "STALE_RUN", "پیش‌نویس مقصد تغییر کرده است");
    const next = confirmMapping(t.payload, s.payload, { fromUid, toUid, by: userId });
    const { rows: [n] } = await tx.query("UPDATE extraction_run SET payload = $1 WHERE id = $2 AND project_id = $3 RETURNING *", [JSON.stringify(next), targetRunId, projectId]);
    await tx.query(`INSERT INTO extraction_edit (project_id, extraction_run_id, document_id, path, field, kind, before_value, after_value, reason, edited_by) VALUES ($1,$2,$3,$4,'mapping','added',NULL,$5,$6,$7)`,
      [projectId, targetRunId, t.document_id, `mappings[${(t.payload.mappings || []).length}]`, JSON.stringify({ fromUid, toUid }), `mapping from revision ${ds.revision}`, userId]);
    return { run: asView(n), draft: n.payload };
  });
}

/**
 * Asset link PROPOSALS for a draft's tagged items, against the project's existing registers (tag / instrument / line). A tag is compared in a
 * normalized form (case and punctuation ignored); exactly one match → `unique` (a link is proposed), several → `multiple` (a person resolves it),
 * none → `none` (nothing is created: a missing asset is the register's business). No record is written here.
 */
export async function linkProposals(db, { projectId, draft }) {
  const items = (draft?.items || []).filter((i) => ["equipment", "instrument", "line"].includes(i.cls) && text(i.tag));
  if (!items.length) return {};
  const [tags, inst, lines] = await Promise.all([
    db.query("SELECT id, tag_no FROM tag WHERE project_id = $1", [projectId]), db.query("SELECT id, tag_no FROM instrument WHERE project_id = $1", [projectId]),
    db.query("SELECT id, line_no FROM line WHERE project_id = $1", [projectId])]);
  const idx = (rows, f) => { const m = new Map(); for (const r of rows) m.set(key(r[f]), [...(m.get(key(r[f])) || []), { id: r.id, tagNo: r[f] }]); return m; };
  const maps = { equipment: idx(tags.rows, "tag_no"), instrument: idx(inst.rows, "tag_no"), line: idx(lines.rows, "line_no") };
  const out = {};
  for (const i of items) {
    const c = maps[i.cls].get(key(i.tag)) || [];
    out[i.uid] = { state: c.length === 0 ? "none" : c.length === 1 ? "unique" : "multiple", kind: i.cls, candidates: c };
  }
  return out;
}

/** The P&ID drawings of a project (documents filed as P&ID) with the state of their current draft — for choosing which one to work on. */
export async function listPidDocuments(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT d.id, d.doc_no, d.revision, d.sheet_no, d.file_sha256, d.storage_uri, d.content_type, d.created_at,
            r.id AS run_id, r.status AS run_status, r.created_at AS run_at,
            (SELECT count(*)::int FROM jsonb_array_elements(r.payload->'items')) AS items
       FROM document d
       LEFT JOIN LATERAL (SELECT id, status, payload, created_at FROM extraction_run
                           WHERE project_id = d.project_id AND document_id = d.id AND pass_name = 'pid' AND status <> 'failed'
                           ORDER BY created_at DESC, id DESC LIMIT 1) r ON true
      WHERE d.project_id = $1 AND d.doc_type = 'pid'
      ORDER BY d.doc_no, d.revision`, [projectId]);
  return rows.map((x) => ({ documentId: x.id, docNo: x.doc_no, revision: x.revision, sheetNo: x.sheet_no, hasFile: Boolean(x.storage_uri) && !String(x.storage_uri).startsWith("none://"), contentType: x.content_type,
    runId: x.run_id, runStatus: x.run_status, items: x.items ?? 0 }));
}
