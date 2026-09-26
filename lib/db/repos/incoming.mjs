/**
 * Incoming transmittals from the designer and the project's review of them.
 * Rules: lib/documents/review.mjs (and lib/documents/control.mjs for the
 * revision sequence). Call inside `withProject`.
 */
import { PURPOSES, issueChecks } from "../../documents/control.mjs";
import { replyDue, incomingState, replyProblems, closeProblems, crsRows } from "../../documents/review.mjs";

const MAX_FILE = 200 * 1024 * 1024;
const EXT = { "application/pdf": ".pdf", "image/vnd.dwg": ".dwg", "application/acad": ".dwg", "application/zip": ".zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx" };

/**
 * Register a designer's transmittal: each item becomes a revision on the
 * register with its file, and an incoming item with its reply due date.
 *
 * items: [{ docNo, title?, revision, purpose, file?: { bytes, name, type } }]
 * Refused whole when any item is refused — half a transmittal logged is a
 * transmittal nobody can reconcile.
 */
export async function registerIncoming(db, {
  projectId, transmittalNo, fromParty, sentOn, receivedOn, purpose, items = [], store = null, userId = null,
}) {
  if (!blank(transmittalNo) || !blank(fromParty) || !sentOn || !receivedOn) throw bad("شمارهٔ ترانسمیتال طراح، فرستنده، تاریخ ارسال و تاریخ دریافت لازم است.");
  if (receivedOn < sentOn) throw bad("تاریخ دریافت پیش از تاریخ ارسال طراح است.");
  if (!blank(purpose)) throw bad("هدف ارسال لازم است.");
  if (!items.length) throw bad("ترانسمیتال بدون مدرک ثبت نمی‌شود.");
  const { rows: [p] } = await db.query("SELECT doc_review_days FROM project WHERE id = $1", [projectId]);
  const dueOn = replyDue(receivedOn, p.doc_review_days);

  // Check every item before writing any.
  const plan = [];
  const seen = new Set();
  for (const [k, it] of items.entries()) {
    const n = `ردیف ${k + 1}`;
    const docNo = blank(it.docNo)?.toUpperCase();
    const revision = blank(it.revision);
    if (!docNo || !revision) throw bad(`${n}: شمارهٔ مدرک و رویژن لازم است.`);
    if (!PURPOSES[it.purpose]) throw bad(`${n}: هدف صدور رویژن را انتخاب کنید.`);
    if (seen.has(`${docNo}|${revision}`)) throw bad(`${n}: ${docNo} Rev.${revision} دو بار در همین ترانسمیتال آمده.`);
    seen.add(`${docNo}|${revision}`);
    const { rows: [doc] } = await db.query("SELECT * FROM mdr_document WHERE project_id = $1 AND doc_no = $2", [projectId, docNo]);
    if (!doc && !blank(it.title)) throw bad(`${n}: ${docNo} در MDR نیست — عنوانش را بنویسید تا با برچسب «خارج از MDR» ثبت شود.`);
    const revs = doc ? await revisionsOf(db, doc.id) : [];
    const checks = issueChecks(revs, { revision, purpose: it.purpose, issuedOn: sentOn }, { approvalRequired: !!doc?.approval_required });
    // Refused: what cannot be true of a document. Flagged: what the designer did out of order.
    const hard = checks.filter((c) => c.hard).map((c) => c.text);
    if (hard.length) throw bad(`${n} (${docNo}): ${hard.join(" · ")}`);
    const flags = checks.filter((c) => !c.hard).map((c) => c.text);
    if (!doc) flags.push("خارج از MDR");
    let file = null;
    if (it.file) {
      if (!it.file.bytes?.length) throw bad(`${n}: فایل خالی است.`);
      if (it.file.bytes.length > MAX_FILE) throw bad(`${n}: فایل بزرگ‌تر از ۲۰۰ مگابایت است.`);
      file = it.file;
      const { createHash } = await import("node:crypto");
      file.sha256 = createHash("sha256").update(file.bytes).digest("hex");
      const same = doc && (await db.query(
        "SELECT revision FROM mdr_revision WHERE mdr_id = $1 AND file_sha256 = $2", [doc.id, file.sha256])).rows[0];
      if (same) throw bad(`${n}: فایل ${docNo} Rev.${revision} عیناً همان فایل Rev.${same.revision} است — بلوک رویژن آن نمی‌تواند درست باشد.`);
    } else flags.push("بدون فایل");
    plan.push({ docNo, revision, purpose: it.purpose, title: blank(it.title), doc, file, flags });
  }

  const { rows: [t] } = await db.query(
    `INSERT INTO transmittal (project_id, transmittal_no, direction, from_party, purpose, sent_on, received_on, response_due, received_by)
     VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, blank(transmittalNo).toUpperCase(), blank(fromParty), blank(purpose), sentOn, receivedOn, dueOn, userId]);
  const out = [];
  for (const x of plan) {
    let doc = x.doc;
    if (!doc) {
      ({ rows: [doc] } = await db.query(
        `INSERT INTO mdr_document (project_id, doc_no, title, originator, outside_mdr) VALUES ($1,$2,$3,$4,true) RETURNING *`,
        [projectId, x.docNo, x.title, blank(fromParty)]));
    }
    let blob = null;
    if (x.file) {
      if (!store) throw bad("انبارهٔ فایل پیکربندی نشده.");
      const type = x.file.type || "application/octet-stream";
      const ext = EXT[type] || (String(x.file.name || "").match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? "");
      blob = await store.put(x.file.bytes, { ext, contentType: type });
    }
    const { rows: [r] } = await db.query(
      `INSERT INTO mdr_revision (project_id, mdr_id, revision, purpose, issued_on, note, issued_by,
                                 file_uri, file_sha256, file_name, file_size, content_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [projectId, doc.id, x.revision, x.purpose, sentOn, `Received on ${t.transmittal_no}`, userId,
       blob?.uri ?? null, x.file?.sha256 ?? null, x.file?.name ?? null, x.file ? x.file.bytes.length : null, x.file?.type ?? null]);
    const { rows: [i] } = await db.query(
      `INSERT INTO transmittal_item (project_id, transmittal_id, revision_id, due_on, receipt_flags) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [projectId, t.id, r.id, dueOn, x.flags]);
    out.push({ itemId: i.id, docNo: x.docNo, revision: x.revision, flags: x.flags });
  }
  return { transmittal: t, items: out, dueOn };
}

/** Distribute an incoming item to the disciplines that must review it. */
export async function assignReview(db, { projectId, itemId, disciplines = [], reviewerId = null, userId = null }) {
  const item = await incomingItem(db, projectId, itemId);
  if (item.return_code) throw bad("به این مدرک پاسخ داده شده؛ توزیع بعد از پاسخ معنی ندارد.");
  const list = [...new Set(disciplines.map((d) => blank(d)).filter(Boolean))];
  if (!list.length) throw bad("دست‌کم یک رشته برای بررسی لازم است.");
  const out = [];
  for (const d of list) {
    const { rows: [r] } = await db.query(
      `INSERT INTO doc_review (project_id, item_id, discipline, reviewer_id, assigned_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (item_id, discipline) DO NOTHING RETURNING *`, [projectId, itemId, d, reviewerId || null, userId]);
    if (r) out.push(r);
  }
  return out;
}

/** A discipline finishes its review — with its comments already raised, or none. */
export async function finishReview(db, { projectId, reviewId, waive = false, reason = null, userId = null }) {
  const { rows: [r] } = await db.query("SELECT * FROM doc_review WHERE id = $1 AND project_id = $2", [reviewId, projectId]);
  if (!r) throw notFound("review");
  if (r.status !== "open") throw bad("این بررسی قبلاً بسته شده.");
  if (waive && !blank(reason)) throw bad("معاف کردن یک رشته از بررسی دلیل می‌خواهد.");
  const { rows: [out] } = await db.query(
    `UPDATE doc_review SET status = $2, waive_reason = $3, finished_by = $4, finished_at = now() WHERE id = $1 RETURNING *`,
    [reviewId, waive ? "waived" : "done", waive ? blank(reason) : null, userId]);
  return out;
}

/** Raise a comment on the revision in this incoming item. It stays with the document until closed. */
export async function raiseComment(db, { projectId, itemId, discipline, ref = null, text, userId = null }) {
  const item = await incomingItem(db, projectId, itemId);
  if (item.return_code) throw bad("پاسخ این رویژن داده شده؛ کامنت تازه روی رویژن بعدی ثبت می‌شود.");
  if (!blank(discipline) || !blank(text)) throw bad("رشته و متن کامنت لازم است.");
  const { rows: [open] } = await db.query(
    "SELECT status FROM doc_review WHERE item_id = $1 AND discipline = $2", [itemId, blank(discipline)]);
  if (open && open.status !== "open") throw bad(`بررسی ${discipline} بسته شده؛ کامنت پس از آن ثبت نمی‌شود.`);
  const { rows: [c] } = await db.query(
    `INSERT INTO doc_comment (project_id, mdr_id, item_id, discipline, ref, text, raised_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, item.mdr_id, itemId, blank(discipline), blank(ref), blank(text), userId]);
  return c;
}

/** Close a comment with the designer's reply, on the revision where it was resolved. */
export async function closeComment(db, { projectId, commentId, designerReply, onItemId = null, userId = null }) {
  const { rows: [c] } = await db.query("SELECT * FROM doc_comment WHERE id = $1 AND project_id = $2", [commentId, projectId]);
  if (!c) throw notFound("comment");
  const p = closeProblems(c, { designerReply });
  if (p.length) throw bad(p.join(" · "));
  let closedOn = onItemId;
  if (closedOn) {
    const it = await incomingItem(db, projectId, closedOn);
    if (it.mdr_id !== c.mdr_id) throw bad("کامنت روی رویژنی از مدرک دیگر بسته نمی‌شود.");
  } else {
    // The latest incoming revision of the document.
    const { rows: [last] } = await db.query(
      `SELECT i.id FROM transmittal_item i JOIN transmittal t ON t.id = i.transmittal_id JOIN mdr_revision r ON r.id = i.revision_id
        WHERE r.mdr_id = $1 AND t.direction = 'in' ORDER BY r.issued_on DESC, r.created_at DESC LIMIT 1`, [c.mdr_id]);
    closedOn = last?.id ?? c.item_id;
  }
  const { rows: [out] } = await db.query(
    `UPDATE doc_comment SET status = 'closed', designer_reply = $2, closed_item_id = $3, closed_by = $4, closed_at = now()
      WHERE id = $1 RETURNING *`, [commentId, blank(designerReply), closedOn, userId]);
  return out;
}

/**
 * Reply to an incoming transmittal: each listed item gets its code, all under
 * one reply number. Refused whole if any code contradicts the record.
 * codes: [{ itemId, code }]
 */
export async function sendReply(db, { projectId, incomingId, replyNo, sentOn, codes = [], userId = null }) {
  const { rows: [t] } = await db.query(
    "SELECT * FROM transmittal WHERE id = $1 AND project_id = $2 AND direction = 'in'", [incomingId, projectId]);
  if (!t) throw notFound("incoming transmittal");
  if (!blank(replyNo) || !sentOn) throw bad("شمارهٔ ترانسمیتال پاسخ و تاریخ لازم است.");
  if (sentOn < iso(t.received_on)) throw bad("پاسخ پیش از دریافت ترانسمیتال است.");
  if (!codes.length) throw bad("کد پاسخ دست‌کم یک مدرک لازم است.");
  if (!userId) throw bad("کد پاسخ را یک شخص می‌دهد.");
  const problems = [];
  for (const c of codes) {
    const item = await incomingItem(db, projectId, c.itemId);
    if (item.transmittal_id !== incomingId) { problems.push(`${item.doc_no}: از این ترانسمیتال نیست`); continue; }
    if (item.return_code) { problems.push(`${item.doc_no}: قبلاً پاسخ داده شده`); continue; }
    const ctx = await reviewContext(db, item);
    const p = replyProblems(c.code, ctx);
    if (p.length) problems.push(`${item.doc_no} Rev.${item.revision}: ${p.join(" · ")}`);
  }
  if (problems.length) throw bad(problems.join(" | "));
  const { rows: [reply] } = await db.query(
    `INSERT INTO doc_reply (project_id, reply_no, incoming_id, to_party, sent_on, sent_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [projectId, blank(replyNo).toUpperCase(), incomingId, t.from_party, sentOn, userId]);
  for (const c of codes) {
    await db.query("UPDATE transmittal_item SET return_code = $2, returned_on = $3, reply_id = $4 WHERE id = $1",
      [c.itemId, Number(c.code), sentOn, reply.id]);
  }
  return reply;
}

/** Every incoming transmittal with its items, reviews, comments and state. */
export async function incomingBoard(db, { projectId, today = todayIso() }) {
  const { rows: [p] } = await db.query("SELECT doc_review_days FROM project WHERE id = $1", [projectId]);
  const { rows } = await db.query(
    `SELECT t.id AS t_id, t.transmittal_no, t.from_party, t.purpose AS t_purpose, t.sent_on, t.received_on,
            i.id, i.due_on, i.return_code, i.returned_on, i.receipt_flags, rp.reply_no,
            r.id AS revision_id, r.revision, r.purpose, r.file_name, r.file_size, (r.file_uri IS NOT NULL) AS has_file,
            d.id AS mdr_id, d.doc_no, d.title, d.discipline, d.outside_mdr
       FROM transmittal t JOIN transmittal_item i ON i.transmittal_id = t.id
       JOIN mdr_revision r ON r.id = i.revision_id JOIN mdr_document d ON d.id = r.mdr_id
       LEFT JOIN doc_reply rp ON rp.id = i.reply_id
      WHERE t.project_id = $1 AND t.direction = 'in' ORDER BY t.received_on DESC, t.transmittal_no, d.doc_no`, [projectId]);
  const { rows: reviews } = await db.query(
    `SELECT v.*, u.display_name AS reviewer_name FROM doc_review v LEFT JOIN app_user u ON u.id = v.reviewer_id
      WHERE v.project_id = $1 ORDER BY v.discipline`, [projectId]);
  const { rows: comments } = await db.query(
    `SELECT c.*, r.revision, rc.revision AS closed_revision, u.display_name AS raised_name
       FROM doc_comment c JOIN transmittal_item i ON i.id = c.item_id JOIN mdr_revision r ON r.id = i.revision_id
       LEFT JOIN transmittal_item ic ON ic.id = c.closed_item_id LEFT JOIN mdr_revision rc ON rc.id = ic.revision_id
       LEFT JOIN app_user u ON u.id = c.raised_by
      WHERE c.project_id = $1 ORDER BY c.raised_at`, [projectId]);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.t_id)) by.set(r.t_id, { id: r.t_id, transmittalNo: r.transmittal_no, fromParty: r.from_party, purpose: r.t_purpose,
      sentOn: iso(r.sent_on), receivedOn: iso(r.received_on), items: [] });
    const rv = reviews.filter((v) => v.item_id === r.id).map((v) => ({ id: v.id, discipline: v.discipline, status: v.status,
      reviewer: v.reviewer_name, waiveReason: v.waive_reason }));
    const docComments = comments.filter((c) => c.mdr_id === r.mdr_id).map(asComment);
    by.get(r.t_id).items.push({
      id: r.id, revisionId: r.revision_id, mdrId: r.mdr_id, docNo: r.doc_no, title: r.title, discipline: r.discipline,
      outsideMdr: r.outside_mdr, revision: r.revision, purpose: r.purpose, hasFile: r.has_file, fileName: r.file_name, fileSize: r.file_size ? Number(r.file_size) : null,
      dueOn: iso(r.due_on), returnCode: r.return_code, returnedOn: iso(r.returned_on), replyNo: r.reply_no, flags: r.receipt_flags,
      reviews: rv, comments: docComments,
      state: incomingState({ returnCode: r.return_code, dueOn: iso(r.due_on), reviews: rv }, today),
    });
  }
  return { reviewDays: p.doc_review_days, today, transmittals: [...by.values()] };
}

/** The comment resolution sheet of a document, as CSV. */
export async function crsCsv(db, { projectId, mdrId }) {
  const { rows: [d] } = await db.query("SELECT doc_no FROM mdr_document WHERE id = $1 AND project_id = $2", [mdrId, projectId]);
  if (!d) throw notFound("document");
  const { rows } = await db.query(
    `SELECT c.*, r.revision, rc.revision AS closed_revision FROM doc_comment c
       JOIN transmittal_item i ON i.id = c.item_id JOIN mdr_revision r ON r.id = i.revision_id
       LEFT JOIN transmittal_item ic ON ic.id = c.closed_item_id LEFT JOIN mdr_revision rc ON rc.id = ic.revision_id
      WHERE c.mdr_id = $1 ORDER BY c.raised_at`, [mdrId]);
  const cols = ["no", "revision", "discipline", "ref", "comment", "designerReply", "status", "closedOn"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(","), ...crsRows(rows.map(asComment)).map((r) => cols.map((k) => q(r[k])).join(","))];
  return { fileName: `CRS-${d.doc_no}.csv`, csv: "﻿" + lines.join("\r\n") };
}

/** The stored file of a revision. */
export async function revisionFile(db, { projectId, revisionId, store }) {
  const { rows: [r] } = await db.query(
    `SELECT r.file_uri, r.file_name, r.content_type, r.file_sha256, d.doc_no, r.revision FROM mdr_revision r
       JOIN mdr_document d ON d.id = r.mdr_id WHERE r.id = $1 AND r.project_id = $2`, [revisionId, projectId]);
  if (!r?.file_uri) throw notFound("file");
  return { bytes: await store.get(r.file_uri), name: r.file_name || `${r.doc_no}-${r.revision}`, type: r.content_type || "application/octet-stream", sha256: r.file_sha256 };
}

// ── helpers ──────────────────────────────────────────────────────────────

async function reviewContext(db, item) {
  const { rows: reviews } = await db.query("SELECT discipline, status FROM doc_review WHERE item_id = $1", [item.id]);
  const { rows: [{ open }] } = await db.query(
    "SELECT count(*)::int AS open FROM doc_comment WHERE mdr_id = $1 AND status = 'open'", [item.mdr_id]);
  const { rows: [{ here }] } = await db.query("SELECT count(*)::int AS here FROM doc_comment WHERE item_id = $1", [item.id]);
  return { reviews, openComments: open, raisedHere: here };
}
async function incomingItem(db, projectId, itemId) {
  const { rows: [i] } = await db.query(
    `SELECT i.*, r.mdr_id, r.revision, d.doc_no FROM transmittal_item i JOIN transmittal t ON t.id = i.transmittal_id
       JOIN mdr_revision r ON r.id = i.revision_id JOIN mdr_document d ON d.id = r.mdr_id
      WHERE i.id = $1 AND i.project_id = $2 AND t.direction = 'in'`, [itemId, projectId]);
  if (!i) throw notFound("incoming item");
  return i;
}
async function revisionsOf(db, mdrId) {
  const { rows } = await db.query(
    `SELECT r.revision, r.purpose, r.issued_on,
            (SELECT min(i.return_code) FILTER (WHERE i.return_code IN (1, 2)) FROM transmittal_item i WHERE i.revision_id = r.id) AS approved_code
       FROM mdr_revision r WHERE r.mdr_id = $1 ORDER BY r.issued_on, r.created_at`, [mdrId]);
  return rows.map((r) => ({ revision: r.revision, purpose: r.purpose, issuedOn: iso(r.issued_on), approvedCode: r.approved_code === null ? null : Number(r.approved_code) }));
}
const asComment = (c) => ({ id: c.id, itemId: c.item_id, revision: c.revision, discipline: c.discipline, ref: c.ref, text: c.text,
  status: c.status, designerReply: c.designer_reply, closedRevision: c.closed_revision, raisedBy: c.raised_name });
const blank = (v) => (v === null || v === undefined || !String(v).trim() ? null : String(v).trim());
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const todayIso = () => new Date().toISOString().slice(0, 10);
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
