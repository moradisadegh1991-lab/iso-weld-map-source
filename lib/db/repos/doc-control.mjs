/**
 * Document control: the MDR, issued revisions, transmittals, and the check
 * of uploaded sheets against the register.
 *
 * Every rule is lib/documents/control.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  PURPOSES, RETURN_CODES, issueProblems, currentOn, constructionOn, usedRevisionCheck, ifcLateness, transmittalItemState,
} from "../../documents/control.mjs";

export async function upsertMdr(db, {
  projectId, docNo, title, discipline = null, docType = null, originator = null, subsystemId = null, tagId = null,
  approvalRequired = false, plannedIfcOn = null,
}) {
  if (!String(docNo || "").trim() || !String(title || "").trim()) throw bad("شمارهٔ مدرک و عنوان لازم است.");
  const { rows: [d] } = await db.query(
    `INSERT INTO mdr_document (project_id, doc_no, title, discipline, doc_type, originator, subsystem_id, tag_id,
                               approval_required, planned_ifc_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (project_id, doc_no) DO UPDATE SET title = EXCLUDED.title, discipline = EXCLUDED.discipline,
        doc_type = EXCLUDED.doc_type, originator = EXCLUDED.originator, subsystem_id = EXCLUDED.subsystem_id,
        tag_id = EXCLUDED.tag_id, approval_required = EXCLUDED.approval_required, planned_ifc_on = EXCLUDED.planned_ifc_on
     RETURNING *`,
    [projectId, String(docNo).trim().toUpperCase(), title.trim(), discipline || null, docType || null, originator || null,
     subsystemId || null, tagId || null, !!approvalRequired, plannedIfcOn || null]);
  return d;
}

export async function issueRevision(db, { projectId, mdrId, revision, purpose, issuedOn, note = null, userId = null }) {
  const doc = await mdrRow(db, projectId, mdrId);
  const revs = await revisionsOf(db, mdrId);
  const next = { revision: String(revision || "").trim(), purpose, issuedOn };
  const problems = issueProblems(revs, next, { approvalRequired: doc.approval_required });
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: [r] } = await db.query(
    `INSERT INTO mdr_revision (project_id, mdr_id, revision, purpose, issued_on, note, issued_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [projectId, mdrId, next.revision, purpose, issuedOn, note || null, userId]);
  return r;
}

/** A transmittal of issued revisions. None may be issued after the day it is sent. */
export async function createTransmittal(db, {
  projectId, transmittalNo, toParty, purpose, sentOn, responseDue = null, revisionIds = [], userId = null,
}) {
  if (!String(transmittalNo || "").trim() || !String(toParty || "").trim() || !sentOn) throw bad("شمارهٔ ترانسمیتال، گیرنده و تاریخ لازم است.");
  if (!String(purpose || "").trim()) throw bad("هدف ارسال لازم است.");
  if (!revisionIds.length) throw bad("ترانسمیتال بدون مدرک ارسال نمی‌شود.");
  if (responseDue && responseDue < sentOn) throw bad("مهلت پاسخ پیش از تاریخ ارسال است.");
  const { rows: revs } = await db.query(
    `SELECT r.id, r.revision, r.issued_on, d.doc_no FROM mdr_revision r JOIN mdr_document d ON d.id = r.mdr_id
      WHERE r.project_id = $1 AND r.id = ANY($2::uuid[])`, [projectId, revisionIds]);
  if (revs.length !== new Set(revisionIds).size) throw bad("بعضی رویژن‌ها در رجیستر نیستند.");
  const late = revs.filter((r) => iso(r.issued_on) > sentOn);
  if (late.length) throw bad(`رویژن پیش از صدور ارسال نمی‌شود: ${late.map((r) => `${r.doc_no} Rev.${r.revision}`).join("، ")}`);
  const { rows: [t] } = await db.query(
    `INSERT INTO transmittal (project_id, transmittal_no, to_party, purpose, sent_on, response_due, sent_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, String(transmittalNo).trim().toUpperCase(), toParty.trim(), purpose.trim(), sentOn, responseDue || null, userId]);
  for (const id of new Set(revisionIds)) {
    await db.query("INSERT INTO transmittal_item (project_id, transmittal_id, revision_id) VALUES ($1,$2,$3)", [projectId, t.id, id]);
  }
  return t;
}

/** The client's return of one item: once, dated on or after sending, code 3 with a comment. */
export async function recordReturn(db, { projectId, itemId, code, returnedOn, comment = null }) {
  const { rows: [i] } = await db.query(
    `SELECT i.*, t.sent_on FROM transmittal_item i JOIN transmittal t ON t.id = i.transmittal_id
      WHERE i.id = $1 AND i.project_id = $2 AND t.direction = 'out'`, [itemId, projectId]);
  if (!i) throw notFound("transmittal item");
  if (i.return_code !== null) throw bad("پاسخ این مدرک پیش‌تر ثبت شده است.");
  const c = Number(code);
  if (!RETURN_CODES[c]) throw bad("کد برگشت باید ۱ تا ۴ باشد.");
  if (c === 3 && !String(comment || "").trim()) throw bad("رد (کد ۳) بدون کامنت ثبت نمی‌شود.");
  if (!returnedOn || returnedOn < iso(i.sent_on)) throw bad("تاریخ برگشت پیش از تاریخ ارسال است.");
  const { rows: [out] } = await db.query(
    "UPDATE transmittal_item SET return_code = $2, returned_on = $3, comment = $4 WHERE id = $1 RETURNING *",
    [itemId, c, returnedOn, comment || null]);
  return out;
}

/**
 * The register on a date: each document's revision history, the revision
 * in force and the one construction was to use on that date, lateness
 * against the planned IFC, and every uploaded sheet checked against it.
 */
export async function registerBoard(db, { projectId, onDate = null }) {
  const today = todayIso();
  const date = onDate || today;
  const { rows: docs } = await db.query(
    `SELECT d.*, s.code AS subsystem_code, t.tag_no FROM mdr_document d
       LEFT JOIN subsystem s ON s.id = d.subsystem_id LEFT JOIN tag t ON t.id = d.tag_id
      WHERE d.project_id = $1 ORDER BY d.doc_no`, [projectId]);
  const out = [];
  for (const d of docs) {
    const revs = await revisionsOf(db, d.id);
    out.push({
      ...d, revisions: revs, current: currentOn(revs, date), construction: constructionOn(revs, date),
      lateness: ifcLateness({ plannedIfcOn: iso(d.planned_ifc_on) }, revs, today),
    });
  }
  // Uploaded sheets whose drawing number is in the register: were they the
  // construction revision on the day they came in?
  const byNo = new Map(out.map((d) => [d.doc_no, d]));
  const { rows: uploads } = await db.query(
    `SELECT id, doc_no, revision, sheet_no, created_at FROM document WHERE project_id = $1 ORDER BY doc_no, created_at`, [projectId]);
  const sheets = uploads.filter((u) => byNo.has(String(u.doc_no).toUpperCase())).map((u) => {
    const d = byNo.get(String(u.doc_no).toUpperCase());
    return { id: u.id, docNo: u.doc_no, sheetNo: u.sheet_no, revision: u.revision, uploadedOn: iso(u.created_at),
      ...usedRevisionCheck(d.revisions, u.revision, iso(u.created_at)) };
  });
  const unregistered = uploads.filter((u) => !byNo.has(String(u.doc_no).toUpperCase())).map((u) => u.doc_no);
  return { onDate: date, today, documents: out, sheets, unregistered: [...new Set(unregistered)],
    transmittals: await transmittals(db, { projectId, today }), purposes: PURPOSES, returnCodes: RETURN_CODES };
}

export async function transmittals(db, { projectId, today = null }) {
  const d = today || todayIso();
  const { rows } = await db.query(
    `SELECT t.*, i.id AS item_id, i.return_code, i.returned_on, i.comment, r.revision, r.purpose AS rev_purpose, m.doc_no
       FROM transmittal t JOIN transmittal_item i ON i.transmittal_id = t.id
       JOIN mdr_revision r ON r.id = i.revision_id JOIN mdr_document m ON m.id = r.mdr_id
      WHERE t.project_id = $1 AND t.direction = 'out' ORDER BY t.sent_on DESC, t.transmittal_no, m.doc_no`, [projectId]);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.id)) by.set(r.id, { id: r.id, transmittalNo: r.transmittal_no, toParty: r.to_party, purpose: r.purpose,
      sentOn: iso(r.sent_on), responseDue: iso(r.response_due), items: [] });
    by.get(r.id).items.push({ id: r.item_id, docNo: r.doc_no, revision: r.revision, revPurpose: r.rev_purpose,
      returnCode: r.return_code, returnedOn: iso(r.returned_on), comment: r.comment,
      state: transmittalItemState({ returnCode: r.return_code, responseDue: iso(r.response_due) }, d) });
  }
  return [...by.values()];
}

// ── helpers ──────────────────────────────────────────────────────────────

/** Issued revisions, oldest first, with the best client return each received. */
async function revisionsOf(db, mdrId) {
  const { rows } = await db.query(
    `SELECT r.id, r.revision, r.purpose, r.issued_on, r.note,
            (SELECT min(i.return_code) FILTER (WHERE i.return_code IN (1, 2))
               FROM transmittal_item i WHERE i.revision_id = r.id) AS approved_code
       FROM mdr_revision r WHERE r.mdr_id = $1 ORDER BY r.issued_on, r.created_at`, [mdrId]);
  return rows.map((r) => ({ id: r.id, revision: r.revision, purpose: r.purpose, issuedOn: iso(r.issued_on), note: r.note,
    approvedCode: r.approved_code === null ? null : Number(r.approved_code) }));
}
async function mdrRow(db, projectId, id) {
  const { rows: [d] } = await db.query("SELECT * FROM mdr_document WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!d) throw notFound("document");
  return d;
}
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const todayIso = () => new Date().toISOString().slice(0, 10);
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
