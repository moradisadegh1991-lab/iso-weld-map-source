/**
 * Revision lineage, comparison and controlled carry-forward (docs/audit/phase-8-revision-lifecycle.md). Call inside `withProject`.
 *
 * The revisions of a drawing are `document` rows (unchanged). What this adds: the direct SOURCE of a revision (`document.parent_document_id`,
 * write-once, same drawing sheet, one child per parent), and the identity mapping a carry-forward establishes (`revision_carry_*`, append-only).
 * The SOURCE revision is never written to by anything here.
 */
import { diffRevisions, applyCarry, CARRY_FIELDS } from "../../revision/revision-diff.mjs";
import { effectiveItems } from "../../sheet/weld-projection.mjs";
import { payloadHash } from "../../review/payload-hash.mjs";
import { latestRunForDocument } from "./runs.mjs";
import { listEquipment } from "./iso-equipment.mjs";
import { availability } from "./bom-allocation.mjs";
import { applyCorrection, approvedRunFor } from "./review.mjs";
import { registerDocument, supersedePrevious } from "./documents.mjs";
import { isUid } from "../../sheet/mark-identity.mjs";
import { KINDS } from "../../sheet/markup.mjs";

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const text = (v) => String(v ?? "").trim();

async function docRow(db, projectId, documentId) {
  const { rows: [d] } = await db.query(
    `SELECT d.*, u.display_name AS created_by_name FROM document d LEFT JOIN app_user u ON u.id = d.created_by WHERE d.id = $1 AND d.project_id = $2`, [documentId, projectId]);
  if (!d) throw fail(404, "NOT_FOUND", "revision not found");
  return d;
}

/** The chain this revision belongs to, oldest first: every revision of the sheet with its lineage, status and approval — in four queries. */
export async function lineageOf(db, { projectId, documentId }) {
  const d = await docRow(db, projectId, documentId);
  const { rows: docs } = await db.query(
    `SELECT d.id, d.revision, d.revision_date, d.created_at, d.parent_document_id, d.superseded_by, d.change_note, d.storage_uri, u.display_name AS created_by_name
       FROM document d LEFT JOIN app_user u ON u.id = d.created_by
      WHERE d.project_id = $1 AND d.doc_no = $2 AND d.sheet_no = $3 ORDER BY d.created_at, d.id`, [projectId, d.doc_no, d.sheet_no]);
  const ids = docs.map((x) => x.id);
  const { rows: runs } = await db.query(
    `SELECT DISTINCT ON (document_id) id, document_id, status, created_at, approved_at, approved_by, engine_error FROM extraction_run
      WHERE project_id = $1 AND document_id = ANY($2) AND engine_error IS NULL ORDER BY document_id, created_at DESC, id DESC`, [projectId, ids]);
  const { rows: approved } = await db.query(
    `SELECT DISTINCT ON (r.document_id) r.document_id, r.approved_at, u.display_name FROM extraction_run r LEFT JOIN app_user u ON u.id = r.approved_by
      WHERE r.project_id = $1 AND r.document_id = ANY($2) AND r.status = 'approved' ORDER BY r.document_id, r.approved_at DESC`, [projectId, ids]);
  const { rows: ops } = await db.query(
    "SELECT id, from_document_id, to_document_id, created_at, summary FROM revision_carry_op WHERE project_id = $1 AND to_document_id = ANY($2) ORDER BY created_at", [projectId, ids]);
  const run = new Map(runs.map((r) => [r.document_id, r])), ap = new Map(approved.map((r) => [r.document_id, r]));
  const chain = docs.map((x) => ({ documentId: x.id, revision: x.revision, createdAt: x.created_at, createdBy: x.created_by_name || null, revisionDate: x.revision_date, parentDocumentId: x.parent_document_id,
    supersededBy: x.superseded_by, changeNote: x.change_note, hasFile: !String(x.storage_uri).startsWith("none://") && !String(x.storage_uri).startsWith("pending://"),
    runId: run.get(x.id)?.id || null, status: ap.has(x.id) ? "approved" : run.get(x.id)?.status || "no-run", runAt: run.get(x.id)?.created_at || null,
    approvedAt: ap.get(x.id)?.approved_at || null, approvedBy: ap.get(x.id)?.display_name || null, carryOps: ops.filter((o) => o.to_document_id === x.id).map((o) => ({ id: o.id, fromDocumentId: o.from_document_id, at: o.created_at, summary: o.summary })) }));
  // the chain in lineage order: follow parent pointers; revisions with no link are reported as such, never guessed into the chain
  const byId = new Map(chain.map((c) => [c.documentId, c]));
  const roots = chain.filter((c) => !c.parentDocumentId || !byId.has(c.parentDocumentId));
  const ordered = [], seen = new Set();
  const child = new Map(chain.filter((c) => c.parentDocumentId).map((c) => [c.parentDocumentId, c]));
  for (const r of roots) { let cur = r; while (cur && !seen.has(cur.documentId)) { ordered.push({ ...cur, linked: Boolean(cur.parentDocumentId) || ordered.length === 0 || roots.length === 1 }); seen.add(cur.documentId); cur = child.get(cur.documentId); } }
  return { docNo: d.doc_no, sheetNo: d.sheet_no, current: documentId, chain: ordered, unlinked: roots.filter((r) => !r.parentDocumentId && roots.length > 1).map((r) => r.documentId) };
}

/** Make `documentId` a revision made from `parentDocumentId` (set once; same drawing sheet; a line, not a tree). */
export async function linkRevision(db, { projectId, documentId, parentDocumentId, changeNote = null }) {
  const d = await docRow(db, projectId, documentId), p = await docRow(db, projectId, parentDocumentId);
  if (d.id === p.id) throw fail(400, "INVALID_LINEAGE", "a revision cannot be its own source");
  if (d.doc_no !== p.doc_no || d.sheet_no !== p.sheet_no) throw fail(409, "INVALID_LINEAGE", "the source must be another revision of the same drawing sheet");
  if (d.parent_document_id === p.id) return { document: d, linked: false };           // the same request again
  if (d.parent_document_id) throw fail(409, "REVISION_HAS_SOURCE", "این رویژن قبلاً از رویژن دیگری ساخته شده و منبعش عوض نمی‌شود");
  const { rows: [other] } = await db.query("SELECT id, revision FROM document WHERE project_id = $1 AND parent_document_id = $2 AND id <> $3", [projectId, p.id, d.id]);
  if (other) throw fail(409, "SOURCE_HAS_SUCCESSOR", `رویژن ${p.revision} قبلاً رویژن ${other.revision} را ساخته است`);
  // no cycles: the source must not descend from this revision
  const { rows: [cyc] } = await db.query(
    `WITH RECURSIVE up AS (SELECT id, parent_document_id FROM document WHERE id = $1 UNION SELECT d.id, d.parent_document_id FROM document d JOIN up ON d.id = up.parent_document_id)
     SELECT 1 FROM up WHERE id = $2`, [p.id, d.id]);
  if (cyc) throw fail(409, "INVALID_LINEAGE", "lineage would form a cycle");
  const { rows: [row] } = await db.query("UPDATE document SET parent_document_id = $2, change_note = COALESCE($3, change_note) WHERE id = $1 AND project_id = $4 RETURNING *", [d.id, p.id, changeNote ? text(changeNote).slice(0, 500) : null, projectId]);
  return { document: row, linked: true };
}

/** A new revision of the same drawing sheet, made from `sourceDocumentId`: its own document row, linked to its source. Nothing of the source is copied or touched. */
export async function createRevision(db, { projectId, sourceDocumentId, revision, changeNote = null, blob, userId, revisionDate = null }) {
  const src = await docRow(db, projectId, sourceDocumentId);
  if (!text(revision)) throw fail(400, "INVALID_INPUT", "revision is required");
  const { rows: [exists] } = await db.query("SELECT id, parent_document_id FROM document WHERE project_id = $1 AND doc_no = $2 AND sheet_no = $3 AND revision = $4", [projectId, src.doc_no, src.sheet_no, text(revision)]);
  if (exists && exists.parent_document_id !== src.id) throw fail(409, "REVISION_EXISTS", `رویژن ${text(revision)} این نقشه از قبل ثبت شده است (با لینک دیگر)؛ آن را از مسیر پیوند دادن ببندید`);
  const { document, created } = await registerDocument(db, { projectId, unitId: src.unit_id, docNo: src.doc_no, docType: src.doc_type, revision: text(revision), revisionDate, sheetNo: src.sheet_no,
    fileSha256: blob?.digest, storageUri: blob?.uri, contentType: blob?.contentType || null, byteSize: blob?.size ?? null, createdBy: userId, noFile: !blob || blob.noFile });
  const link = await linkRevision(db, { projectId, documentId: document.id, parentDocumentId: src.id, changeNote });
  const superseded = created ? await supersedePrevious(db, { projectId, documentId: document.id }) : [];
  return { document: link.document, created, superseded };
}

async function loadSide(db, projectId, documentId) {
  const run = await latestRunForDocument(db, { projectId, documentId });
  if (!run?.payload) throw fail(404, "NO_REGISTER", "یکی از دو رویژن هنوز رجیستر ذخیره‌شده ندارد");
  const [equipment, ledger] = await Promise.all([listEquipment(db, { projectId, documentId }), availability(db, { projectId, documentId })]);
  return { run, payload: run.payload, equipment, ledger };
}
async function mappingsFor(db, projectId, fromDocumentId, toDocumentId) {
  const { rows } = await db.query("SELECT cls, from_uid, to_uid, op_id FROM revision_carry_map WHERE project_id = $1 AND from_document_id = $2 AND to_document_id = $3", [projectId, fromDocumentId, toDocumentId]);
  return rows.map((r) => ({ cls: r.cls, fromUid: r.from_uid, toUid: r.to_uid, opId: r.op_id }));
}

/** The comparison of two revisions of one drawing sheet (read-only). */
export async function compareRevisions(db, { projectId, fromDocumentId, toDocumentId }) {
  const a = await docRow(db, projectId, fromDocumentId), b = await docRow(db, projectId, toDocumentId);
  if (a.id === b.id) throw fail(400, "INVALID_INPUT", "choose two different revisions");
  if (a.doc_no !== b.doc_no || a.sheet_no !== b.sheet_no) throw fail(409, "INVALID_LINEAGE", "the two revisions are not of the same drawing sheet");
  const [from, to, mappings] = await Promise.all([loadSide(db, projectId, a.id), loadSide(db, projectId, b.id), mappingsFor(db, projectId, a.id, b.id)]);
  const diff = diffRevisions({ from: { payload: from.payload, ledger: from.ledger, equipment: from.equipment }, to: { payload: to.payload }, mappings });
  const approvedTo = await approvedRunFor(db, { projectId, documentId: b.id });
  return { from: { documentId: a.id, revision: a.revision, runId: from.run.id, hash: payloadHash(from.payload) }, to: { documentId: b.id, revision: b.revision, runId: to.run.id, hash: payloadHash(to.payload), locked: Boolean(approvedTo) },
    linked: b.parent_document_id === a.id, mappings, ...diff };
}

const chk = (cond, status, code, msg) => { if (!cond) throw fail(status, code, msg); };

/**
 * Carry the chosen descriptive fields from the source revision into the target revision — one transaction, nothing half done.
 *   decisions: [{ key, pair?: { fromUid, toUid }, fields?: [names] }]
 *     key    a change id of the comparison; `pair` confirms a candidate / settles an ambiguous item (the person's explicit choice, stored as a mapping)
 *   The plan is made AGAIN here from the stored state; the request only chooses among what that plan allows.
 */
export async function carryForward(db, { projectId, fromDocumentId, toDocumentId, fromHash, toHash, requestKey, decisions = [], userId }) {
  chk(text(requestKey).length >= 8, 400, "INVALID_INPUT", "requestKey is required");
  chk(Array.isArray(decisions), 400, "INVALID_INPUT", "decisions must be a list");
  return db.transaction(async (tx) => {
    // the same request again → the recorded outcome, nothing new (the unique key also holds under a race)
    const { rows: [done] } = await tx.query("SELECT id, summary, created_at, to_hash_after FROM revision_carry_op WHERE project_id = $1 AND to_document_id = $2 AND request_key = $3", [projectId, toDocumentId, requestKey]);
    if (done) return { op: { id: done.id, createdAt: done.created_at, summary: done.summary }, payloadHash: done.to_hash_after, repeated: true };
    await tx.query("SELECT id FROM document WHERE id = ANY($1) AND project_id = $2 ORDER BY id FOR UPDATE", [[fromDocumentId, toDocumentId], projectId]);
    const a = await docRow(tx, projectId, fromDocumentId), b = await docRow(tx, projectId, toDocumentId);
    chk(a.id !== b.id, 400, "INVALID_INPUT", "source and target must differ");
    chk(a.doc_no === b.doc_no && a.sheet_no === b.sheet_no, 409, "INVALID_LINEAGE", "the two revisions are not of the same drawing sheet");
    chk(b.parent_document_id === a.id, 409, "INVALID_LINEAGE", "رویژن مقصد از این رویژن مبدأ ساخته نشده است؛ ابتدا پیوند رویژن‌ها را برقرار کنید");
    chk(!(await approvedRunFor(tx, { projectId, documentId: b.id })), 409, "RUN_LOCKED", "رجیستر رویژن مقصد تأیید شده؛ انتقال فقط روی رویژن تأییدنشده ممکن است");
    const from = await loadSide(tx, projectId, a.id), to = await loadSide(tx, projectId, b.id);
    chk(fromHash && fromHash === payloadHash(from.payload), 409, "STALE_SOURCE", "رویژن مبدأ از وقتی مقایسه را دیدید عوض شده؛ مقایسه را تازه کنید");
    chk(toHash && toHash === payloadHash(to.payload), 409, "STALE_RUN", "رویژن مقصد از وقتی مقایسه را دیدید عوض شده؛ مقایسه را تازه کنید");
    const mappings = await mappingsFor(tx, projectId, a.id, b.id);
    const plan = diffRevisions({ from: { payload: from.payload, ledger: from.ledger, equipment: from.equipment }, to: { payload: to.payload }, mappings });
    const byId = new Map(plan.changes.map((c) => [c.id, c]));
    const newMaps = [], toApply = [], carried = [], held = [], skipped = [];
    const usedTo = new Set(mappings.map((m) => String(m.toUid).toLowerCase())), usedFrom = new Set(mappings.map((m) => String(m.fromUid).toLowerCase()));
    const { items: toItems } = effectiveItems(to.payload), { items: fromItems } = effectiveItems(from.payload);
    const asKey = (m) => (isUid(m?.uid) ? m.uid.toLowerCase() : text(m?.id));
    // 1. pairs: confirmations and settled ambiguities — each an explicit, validated person's choice
    const confirmed = [];
    for (const d of decisions) {
      const c = byId.get(d.key);
      chk(c, 409, "UNKNOWN_CHANGE", `تغییر ${d.key} در مقایسهٔ فعلی نیست؛ مقایسه را تازه کنید`);
      if (c.kind === "candidate") {
        if (!d.pair) continue;
        chk(String(d.pair.fromUid).toLowerCase() === c.fromUid && String(d.pair.toUid).toLowerCase() === c.toUid, 409, "INVALID_MAPPING", "تطبیق انتخابی همان پیشنهاد مقایسه نیست");
        confirmed.push({ cls: c.cls, fromUid: c.fromUid, toUid: c.toUid, change: c });
      } else if (c.kind === "ambiguous") {
        if (!d.pair) { held.push(d.key); continue; }
        const fu = String(d.pair.fromUid).toLowerCase(), tu = String(d.pair.toUid).toLowerCase();
        chk(c.candidates.from.some((x) => x.uid === fu) && c.candidates.to.some((x) => x.uid === tu), 409, "INVALID_MAPPING", "تطبیق انتخابی بین گزینه‌های این مورد مبهم نیست");
        confirmed.push({ cls: c.cls, fromUid: fu, toUid: tu, change: null });
      }
    }
    for (const m of confirmed) {
      chk(!usedFrom.has(m.fromUid) && !usedTo.has(m.toUid), 409, "INVALID_MAPPING", "یکی از این دو مورد قبلاً به مورد دیگری نگاشت شده است");
      usedFrom.add(m.fromUid); usedTo.add(m.toUid); newMaps.push({ cls: m.cls, fromUid: m.fromUid, toUid: m.toUid, fields: [] });
    }
    // 2. with the confirmed mappings in, plan again so equipment → weld links can use them (still explicit-only)
    const allMaps = [...mappings, ...newMaps];
    const plan2 = diffRevisions({ from: { payload: from.payload, ledger: from.ledger, equipment: from.equipment }, to: { payload: to.payload }, mappings: allMaps });
    const byTo = new Map(plan2.changes.filter((c) => c.fromUid && c.toUid && c.category !== "geometry" && c.category !== "identity").map((c) => [c.toUid, c]));
    const selected = decisions.filter((d) => Array.isArray(d.fields) && d.fields.length);
    for (const d of selected) {
      const old = byId.get(d.key);
      chk(old, 409, "UNKNOWN_CHANGE", `تغییر ${d.key} در مقایسهٔ فعلی نیست`);
      const c = old.kind === "candidate" || old.kind === "ambiguous" ? (newMaps.find((m) => m.fromUid === old.fromUid) ? byTo.get(newMaps.find((m) => m.fromUid === old.fromUid).toUid) : null) : byTo.get(old.toUid);
      chk(c && c.carry, 409, "NOT_CARRYABLE", `«${old.label}» هنوز با نگاشت صریح به مورد جدید وصل نیست؛ ابتدا تطبیق را تأیید کنید`);
      const values = {};
      for (const f of d.fields) {
        chk(CARRY_FIELDS[c.cls]?.includes(f), 409, "FIELD_NOT_CARRYABLE", `فیلد «${f}» قابل انتقال نیست (وضعیت، تاریخچه، هندسه و شماره منتقل نمی‌شوند)`);
        const r = c.carry.ready.find((x) => x.field === f);
        chk(r, 409, "FIELD_NOT_READY", `فیلد «${f}» از ${old.label} الان قابل انتقال نیست (${c.carry.blocked.find((x) => x.field === f)?.reason || "مقدار ندارد"})`);
        values[f] = r.value;
      }
      toApply.push({ klass: c.cls, toUid: c.toUid, values });
      carried.push({ key: d.key, toUid: c.toUid, fields: d.fields });
      const mp = newMaps.find((m) => m.toUid === c.toUid) || { cls: c.cls, fromUid: c.fromUid, toUid: c.toUid, fields: [] };
      if (!allMaps.some((m) => String(m.toUid).toLowerCase() === c.toUid) ) { /* mapped earlier */ }
      if (!newMaps.includes(mp) && !mappings.some((m) => String(m.toUid).toLowerCase() === c.toUid)) { usedFrom.add(c.fromUid); usedTo.add(c.toUid); newMaps.push(mp); }
      mp.fields = [...new Set([...(mp.fields || []), ...d.fields])];
    }
    // equipment links carried by a field need their welds' mapping to exist already (they do: `ready` only lists mapped ones)
    const targetBefore = payloadHash(to.payload);
    let after = targetBefore, applied = null;
    if (toApply.length) {
      const edited = applyCarry(to.payload, toApply);
      applied = await applyCorrection(tx, { projectId, runId: to.run.id, payload: edited, reason: `carry-forward from revision ${a.revision}`, userId, baseHash: targetBefore });
      after = payloadHash((await latestRunForDocument(tx, { projectId, documentId: b.id }))?.payload);   // the STORED payload's hash (jsonb order), what a later request names
    }
    for (const d of decisions) if (!carried.some((x) => x.key === d.key) && !newMaps.some((m) => byId.get(d.key)?.fromUid === m.fromUid) && !held.includes(d.key)) skipped.push(d.key);
    const summary = { carried: carried.length, fields: carried.reduce((n, x) => n + x.fields.length, 0), mappingsConfirmed: confirmed.length, held: held.length, skipped: skipped.length, fromRevision: a.revision, toRevision: b.revision };
    if (!newMaps.length && !toApply.length) throw fail(409, "NOTHING_TO_CARRY", "هیچ موردی برای انتقال یا تأیید انتخاب نشده یا قابل انتقال نیست");
    const { rows: [op] } = await tx.query(
      `INSERT INTO revision_carry_op (project_id, from_document_id, to_document_id, from_run_id, to_run_id, from_hash, to_hash_before, to_hash_after, request_key, summary, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`, [projectId, a.id, b.id, from.run.id, to.run.id, fromHash, targetBefore, after, requestKey, JSON.stringify(summary), userId]);
    for (const m of newMaps) await tx.query(
      `INSERT INTO revision_carry_map (project_id, op_id, from_document_id, to_document_id, cls, from_uid, to_uid, fields, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [projectId, op.id, a.id, b.id, m.cls, m.fromUid, m.toUid, m.fields || [], userId]);
    return { op: { id: op.id, createdAt: op.created_at, summary }, payloadHash: after, repeated: false, carried, mapped: newMaps.map((m) => ({ cls: m.cls, fromUid: m.fromUid, toUid: m.toUid })) };
  });
}

/** What the validation engine needs to know about this revision's lineage (fixed queries). */
export async function lineageFacts(db, { projectId, documentId }) {
  const d = await docRow(db, projectId, documentId);
  const { rows: siblings } = await db.query("SELECT id, revision, parent_document_id, created_at FROM document WHERE project_id = $1 AND doc_no = $2 AND sheet_no = $3 AND id <> $4", [projectId, d.doc_no, d.sheet_no, d.id]);
  const parent = d.parent_document_id ? siblings.find((s) => s.id === d.parent_document_id) || null : null;
  const children = siblings.filter((s) => s.parent_document_id === d.id);
  const { rows: ops } = await db.query("SELECT id, from_document_id, from_hash, to_hash_after, created_at FROM revision_carry_op WHERE project_id = $1 AND to_document_id = $2 ORDER BY created_at", [projectId, d.id]);
  const { rows: maps } = await db.query("SELECT cls, from_uid, to_uid FROM revision_carry_map WHERE project_id = $1 AND to_document_id = $2", [projectId, d.id]);
  let parentHash = null, planSummary = null, histAsDemand = [];
  if (parent) {
    const run = await latestRunForDocument(db, { projectId, documentId: parent.id });
    parentHash = run?.payload ? payloadHash(run.payload) : null;
    const { rows } = await db.query("SELECT pt, owner_ref, owner_no, status FROM bom_allocation WHERE project_id = $1 AND document_id = $2 AND status = ANY($3) AND owner_ref = ANY($4)", [projectId, d.id, ["reserved", "installed"], maps.map((m) => m.from_uid)]);
    histAsDemand = rows.map((r) => ({ pt: r.pt, ownerRef: r.owner_ref, ownerNo: r.owner_no, status: r.status }));
    if (run?.payload) {
      const mine = await latestRunForDocument(db, { projectId, documentId: d.id });
      if (mine?.payload) planSummary = diffRevisions({ from: { payload: run.payload }, to: { payload: mine.payload }, mappings: maps.map((m) => ({ cls: m.cls, fromUid: m.from_uid, toUid: m.to_uid })) });
    }
  }
  const pending = planSummary ? { candidates: planSummary.changes.filter((c) => c.kind === "candidate").map((c) => ({ cls: c.cls, fromUid: c.fromUid, toUid: c.toUid, no: c.toNo })),
    ambiguous: planSummary.changes.filter((c) => c.kind === "ambiguous").map((c) => ({ cls: c.cls, no: c.fromNo })),
    carryable: planSummary.changes.filter((c) => c.kind !== "candidate" && c.kind !== "ambiguous" && c.carry?.ready?.length).length } : null;
  return { revision: d.revision, parent: parent ? { documentId: parent.id, revision: parent.revision } : null, hasParentColumn: Boolean(d.parent_document_id),
    siblings: siblings.map((s) => ({ documentId: s.id, revision: s.revision, linked: Boolean(s.parent_document_id), older: new Date(s.created_at) < new Date(d.created_at) })), children: children.map((c) => ({ documentId: c.id, revision: c.revision })),
    ops: ops.map((o) => ({ id: o.id, fromDocumentId: o.from_document_id, fromHash: o.from_hash, at: o.created_at })), mappings: maps.map((m) => ({ cls: m.cls, fromUid: m.from_uid, toUid: m.to_uid })), parentHash, pending, histAsDemand };
}
