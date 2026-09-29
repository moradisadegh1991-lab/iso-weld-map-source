/**
 * Work outside the contract, and the changes behind it (migration 056).
 *
 *   TQ           site asks → designer answers (portal) → engineer closes:
 *                no change, or change required
 *   site change  site-run / field change / as-built: raised → approved by an
 *                engineer who did not raise it → the designer submits the
 *                as-built revision → closed once that revision is in the MDR
 *   work order   extra work for a contractor: prepared → issued by someone
 *                else (it adds a measured variation item to the contract,
 *                paid through the payment statement) → completed
 *
 * Every step goes to the «دستور کار و تغییرات» log. Call inside `withProject`.
 */
import { numberOr } from "./numbering.mjs";
import { logEvent } from "./log.mjs";
import { latestToday } from "../../civil/concrete.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (w) => Object.assign(new Error(`${w} not found`), { status: 404 });
const blank = (v) => { const s = String(v ?? "").trim(); return s || null; };
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const future = (d) => d && iso(d) > latestToday();

export const SITE_CHANGE_KIND = { site_run: "سایت‌ران (مسیر در سایت)", field_change: "تغییر در سایت", as_built: "انحراف As-built" };
export const TQ_STATUS = { open: "منتظر پاسخ طراح", answered: "پاسخ داده شد — منتظر بستن", closed: "بسته" };
export const TQ_OUTCOME = { no_change: "بدون تغییر", change_required: "تغییر لازم است" };
export const FCR_STATUS = { raised: "ثبت شد — منتظر تأیید", approved: "تأیید شد — منتظر As-built طراح", rejected: "رد شد",
  asbuilt_submitted: "As-built طراح رسید — منتظر بستن", closed: "بسته" };
export const WO_STATUS = { draft: "پیش‌نویس", issued: "ابلاغ‌شده به پیمانکار", completed: "انجام‌شده", cancelled: "لغو" };
export const WO_ORIGIN = { tq: "TQ", site_change: "تغییر سایت", client: "درخواست کارفرما", other: "سایر" };

const LOG = (db, projectId, entityType, row, no, action, extra = {}) =>
  logEvent(db, { projectId, section: "changes", entityType, entityId: row.id, label: no, action, ...extra });

async function one(db, table, projectId, id, what) {
  const { rows: [r] } = await db.query(`SELECT * FROM ${table} WHERE id = $1 AND project_id = $2`, [id, projectId]);
  if (!r) throw notFound(what);
  return r;
}

// ── TQ ───────────────────────────────────────────────────────────────────

export async function raiseTq(db, { projectId, tqNo = null, subject, question, proposal = null, discipline = null,
  mdrDocumentId = null, lineId = null, tagId = null, raisedOn, replyDue = null, userId }) {
  if (!blank(subject) || !blank(question)) throw bad("موضوع و پرسش TQ لازم است.");
  if (!raisedOn) throw bad("تاریخ ثبت لازم است.");
  if (future(raisedOn)) throw bad(`تاریخ ${iso(raisedOn)} هنوز نرسیده است.`);
  if (replyDue && iso(replyDue) < iso(raisedOn)) throw bad("مهلت پاسخ پیش از تاریخ ثبت است.");
  const no = await numberOr(db, { projectId, form: "tq", typed: tqNo });
  const { rows: [t] } = await db.query(
    `INSERT INTO tech_query (project_id, tq_no, subject, question, proposal, discipline, mdr_document_id, line_id, tag_id, raised_by, raised_on, reply_due)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projectId, no, blank(subject), blank(question), blank(proposal), blank(discipline), mdrDocumentId || null, lineId || null,
     tagId || null, userId, raisedOn, replyDue || null]);
  await LOG(db, projectId, "tq", t, no, "created", { to: "open", comment: blank(subject), userId });
  return t;
}

/** The designer's answer (designer portal). */
export async function answerTq(db, { projectId, tqId, answer, answeredOn, userId }) {
  const t = await one(db, "tech_query", projectId, tqId, "TQ");
  if (t.status === "closed") throw bad(`${t.tq_no} بسته است.`);
  if (!blank(answer) || !answeredOn) throw bad("پاسخ و تاریخ آن لازم است.");
  if (future(answeredOn) || iso(answeredOn) < iso(t.raised_on)) throw bad("تاریخ پاسخ باید میان تاریخ ثبت TQ و امروز باشد.");
  const { rows: [r] } = await db.query(
    "UPDATE tech_query SET status = 'answered', answer = $2, answered_by = $3, answered_on = $4 WHERE id = $1 RETURNING *",
    [tqId, blank(answer), userId, answeredOn]);
  await LOG(db, projectId, "tq", r, r.tq_no, "submitted", { from: t.status, to: "answered", comment: blank(answer), userId });
  return r;
}

/** The engineer closes an answered TQ: no change, or a change is required. */
export async function closeTq(db, { projectId, tqId, outcome, userId }) {
  const t = await one(db, "tech_query", projectId, tqId, "TQ");
  if (t.status !== "answered") throw bad(t.status === "open" ? `${t.tq_no} هنوز پاسخ طراح را ندارد.` : `${t.tq_no} بسته است.`);
  if (!TQ_OUTCOME[outcome]) throw bad("نتیجه را انتخاب کنید: بدون تغییر، یا تغییر لازم است.");
  if (t.answered_by === userId) throw bad("پاسخ‌دهندهٔ TQ آن را نمی‌بندد.");
  const { rows: [r] } = await db.query(
    "UPDATE tech_query SET status = 'closed', outcome = $2, closed_by = $3, closed_at = now() WHERE id = $1 RETURNING *", [tqId, outcome, userId]);
  await LOG(db, projectId, "tq", r, r.tq_no, "closed", { from: "answered", to: "closed", comment: TQ_OUTCOME[outcome], userId });
  return r;
}

// ── site changes ─────────────────────────────────────────────────────────

export async function raiseSiteChange(db, { projectId, fcrNo = null, kind, title, description, reason = null, tqId = null,
  mdrDocumentId = null, lineId = null, tagId = null, raisedOn, userId }) {
  if (!SITE_CHANGE_KIND[kind]) throw bad("نوع تغییر را انتخاب کنید: سایت‌ران، تغییر در سایت یا As-built.");
  if (!blank(title) || !blank(description)) throw bad("عنوان و شرح تغییر لازم است.");
  if (!raisedOn) throw bad("تاریخ ثبت لازم است.");
  if (future(raisedOn)) throw bad(`تاریخ ${iso(raisedOn)} هنوز نرسیده است.`);
  if (tqId) {
    const t = await one(db, "tech_query", projectId, tqId, "TQ");
    if (t.status !== "closed" || t.outcome !== "change_required") throw bad(`${t.tq_no} با نتیجهٔ «تغییر لازم است» بسته نشده است.`);
  }
  const no = await numberOr(db, { projectId, form: "site_change", typed: fcrNo });
  const { rows: [c] } = await db.query(
    `INSERT INTO site_change (project_id, fcr_no, kind, title, description, reason, tq_id, mdr_document_id, line_id, tag_id, raised_by, raised_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projectId, no, kind, blank(title), blank(description), blank(reason), tqId || null, mdrDocumentId || null, lineId || null,
     tagId || null, userId, raisedOn]);
  await LOG(db, projectId, "site_change", c, no, "created", { to: "raised", comment: `${SITE_CHANGE_KIND[kind]}: ${blank(title)}`, userId });
  return c;
}

/** Approve or reject a change; never by the one who raised it; a rejection says why. */
export async function decideSiteChange(db, { projectId, changeId, decision, note = null, userId }) {
  const c = await one(db, "site_change", projectId, changeId, "site change");
  if (c.status !== "raised") throw bad(`${c.fcr_no} «${FCR_STATUS[c.status]}» است.`);
  if (!["approve", "reject"].includes(decision)) throw bad("تصمیم باید تأیید یا رد باشد.");
  if (c.raised_by === userId) throw bad("ثبت‌کنندهٔ تغییر، آن را تأیید یا رد نمی‌کند.");
  if (decision === "reject" && !blank(note)) throw bad("رد تغییر دلیل می‌خواهد.");
  const to = decision === "approve" ? "approved" : "rejected";
  const { rows: [r] } = await db.query(
    "UPDATE site_change SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1 RETURNING *",
    [changeId, to, userId, blank(note)]);
  await LOG(db, projectId, "site_change", r, r.fcr_no, decision === "approve" ? "approved" : "returned", { from: "raised", to, comment: blank(note), userId });
  return r;
}

/** The designer puts the change on the drawing: the as-built revision (designer portal). */
export async function submitAsBuilt(db, { projectId, changeId, revision, note = null, submittedOn, userId }) {
  const c = await one(db, "site_change", projectId, changeId, "site change");
  if (c.status !== "approved") throw bad(`${c.fcr_no} «${FCR_STATUS[c.status]}» است؛ As-built پس از تأیید تغییر ثبت می‌شود.`);
  if (!c.mdr_document_id) throw bad(`برای ${c.fcr_no} نقشه‌ای در رجیستر مدارک مشخص نشده — کدام نقشه باید As-built شود؟`);
  if (!blank(revision) || !submittedOn) throw bad("رویژن As-built و تاریخ لازم است.");
  if (future(submittedOn)) throw bad(`تاریخ ${iso(submittedOn)} هنوز نرسیده است.`);
  const { rows: [r] } = await db.query(
    `UPDATE site_change SET status = 'asbuilt_submitted', asbuilt_revision = $2, asbuilt_note = $3, asbuilt_by = $4, asbuilt_on = $5
      WHERE id = $1 RETURNING *`, [changeId, blank(revision), blank(note), userId, submittedOn]);
  await LOG(db, projectId, "site_change", r, r.fcr_no, "submitted", { from: "approved", to: "asbuilt_submitted",
    comment: `As-built Rev.${blank(revision)}${blank(note) ? ` — ${blank(note)}` : ""}`, userId });
  return r;
}

/** Closed once the as-built revision is really in the MDR — received like any other revision. */
export async function closeSiteChange(db, { projectId, changeId, userId }) {
  const c = await one(db, "site_change", projectId, changeId, "site change");
  if (c.status !== "asbuilt_submitted") throw bad(`${c.fcr_no} «${FCR_STATUS[c.status]}» است.`);
  const { rows: [rev] } = await db.query(
    `SELECT r.id, d.doc_no FROM mdr_revision r JOIN mdr_document d ON d.id = r.mdr_id
      WHERE d.id = $1 AND r.project_id = $2 AND upper(r.revision) = upper($3)`, [c.mdr_document_id, projectId, c.asbuilt_revision]);
  if (!rev) {
    const { rows: [d] } = await db.query("SELECT doc_no FROM mdr_document WHERE id = $1", [c.mdr_document_id]);
    throw bad(`رویژن ${c.asbuilt_revision} نقشهٔ ${d?.doc_no} هنوز در رجیستر مدارک نیست — با ترانسمیتال طراح دریافت شود، بعد بسته می‌شود.`);
  }
  const { rows: [r] } = await db.query("UPDATE site_change SET status = 'closed', closed_by = $2, closed_at = now() WHERE id = $1 RETURNING *", [changeId, userId]);
  await LOG(db, projectId, "site_change", r, r.fcr_no, "closed", { from: "asbuilt_submitted", to: "closed", comment: `${rev.doc_no} Rev.${c.asbuilt_revision}`, userId });
  return r;
}

// ── work orders ──────────────────────────────────────────────────────────

export async function createWorkOrder(db, { projectId, woNo = null, contractId, title, description, origin, tqId = null,
  siteChangeId = null, accountId = null, unit, qty, rate, userId }) {
  const { rows: [c] } = await db.query("SELECT * FROM contract WHERE id = $1 AND project_id = $2", [contractId, projectId]);
  if (!c) throw bad("قرارداد را انتخاب کنید.");
  if (c.status !== "signed") throw bad(`دستور کار به قرارداد امضاشده ابلاغ می‌شود؛ ${c.contract_no} امضا نشده است.`);
  if (!blank(title) || !blank(description)) throw bad("عنوان و شرح کار لازم است.");
  if (!WO_ORIGIN[origin]) throw bad("منشأ دستور کار را انتخاب کنید.");
  if (origin === "tq") {
    if (!tqId) throw bad("TQ مبنای دستور کار را انتخاب کنید.");
    const t = await one(db, "tech_query", projectId, tqId, "TQ");
    if (t.status !== "closed" || t.outcome !== "change_required") throw bad(`${t.tq_no} با نتیجهٔ «تغییر لازم است» بسته نشده است.`);
  }
  if (origin === "site_change") {
    if (!siteChangeId) throw bad("تغییر سایت مبنای دستور کار را انتخاب کنید.");
    const s = await one(db, "site_change", projectId, siteChangeId, "site change");
    if (!["approved", "asbuilt_submitted", "closed"].includes(s.status)) throw bad(`${s.fcr_no} تأیید نشده است.`);
  }
  const q = Number(qty), r = Number(rate);
  if (!(q > 0) || !(r >= 0) || !blank(unit)) throw bad("مقدار (مثبت)، واحد و بهای واحد لازم است — بها پیش از ابلاغ با پیمانکار توافق می‌شود.");
  const no = await numberOr(db, { projectId, form: "work_order", typed: woNo });
  const { rows: [w] } = await db.query(
    `INSERT INTO work_order (project_id, wo_no, contract_id, title, description, origin, tq_id, site_change_id, account_id, unit, qty, rate, prepared_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [projectId, no, contractId, blank(title), blank(description), origin, origin === "tq" ? tqId : null,
     origin === "site_change" ? siteChangeId : null, accountId || null, blank(unit), q, r, userId]);
  await LOG(db, projectId, "work_order", w, no, "created", { to: "draft", comment: `${c.contract_no} · ${blank(title)} · ${q} ${blank(unit)} × ${r}`, userId });
  return w;
}

/**
 * Issue a work order to its contractor: by someone other than who prepared it.
 * The contract gains a variation item — measured by sheet, on the work
 * order's WBS element — that the next payment statement measures and pays.
 */
export async function issueWorkOrder(db, { projectId, workOrderId, issuedOn, userId }) {
  const w = await one(db, "work_order", projectId, workOrderId, "work order");
  if (w.status !== "draft") throw bad(`${w.wo_no} «${WO_STATUS[w.status]}» است.`);
  if (w.prepared_by === userId) throw bad("تهیه‌کنندهٔ دستور کار، آن را ابلاغ نمی‌کند.");
  if (!issuedOn) throw bad("تاریخ ابلاغ لازم است.");
  if (future(issuedOn)) throw bad(`تاریخ ${iso(issuedOn)} هنوز نرسیده است.`);
  const { rows: [c] } = await db.query("SELECT * FROM contract WHERE id = $1", [w.contract_id]);
  if (c.status !== "signed") throw bad(`قرارداد ${c.contract_no} امضاشده نیست.`);
  const { rows: [line] } = await db.query(
    `INSERT INTO contract_line (project_id, contract_id, item_no, description, unit, qty, rate, account_id, method, work_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'measured',$9) RETURNING *`,
    [projectId, w.contract_id, w.wo_no, `دستور کار ${w.wo_no}: ${w.title}`, w.unit, w.qty, w.rate, w.account_id, w.id]);
  const { rows: [r] } = await db.query(
    "UPDATE work_order SET status = 'issued', issued_by = $2, issued_on = $3, line_id = $4 WHERE id = $1 RETURNING *",
    [workOrderId, userId, issuedOn, line.id]);
  await LOG(db, projectId, "work_order", r, r.wo_no, "signed", { from: "draft", to: "issued", comment: `ابلاغ به ${c.contract_no}`, userId });
  await logEvent(db, { projectId, section: "contracts", entityType: "contract", entityId: c.id, label: `قرارداد ${c.contract_no}`,
    action: "updated", comment: `ردیف ${w.wo_no} از دستور کار: ${w.title} — ${Number(w.qty)} ${w.unit} × ${Number(w.rate)}`, userId });
  return r;
}

export async function completeWorkOrder(db, { projectId, workOrderId, completedOn, userId }) {
  const w = await one(db, "work_order", projectId, workOrderId, "work order");
  if (w.status !== "issued") throw bad(`${w.wo_no} «${WO_STATUS[w.status]}» است.`);
  if (!completedOn || future(completedOn) || iso(completedOn) < iso(w.issued_on)) throw bad("تاریخ انجام باید میان تاریخ ابلاغ و امروز باشد.");
  const { rows: [r] } = await db.query("UPDATE work_order SET status = 'completed', completed_on = $2 WHERE id = $1 RETURNING *", [workOrderId, completedOn]);
  await LOG(db, projectId, "work_order", r, r.wo_no, "closed", { from: "issued", to: "completed", userId });
  return r;
}

// ── boards ───────────────────────────────────────────────────────────────

export async function changesBoard(db, { projectId }) {
  const who = "LEFT JOIN app_user %A ON %A.id = x.%C";
  const u = (a, c) => who.replaceAll("%A", a).replace("%C", c);
  const { rows: tqs } = await db.query(
    `SELECT x.*, d.doc_no, l.line_no, t.tag_no, ur.display_name AS raised_name, ua.display_name AS answered_name, uc.display_name AS closed_name
       FROM tech_query x LEFT JOIN mdr_document d ON d.id = x.mdr_document_id LEFT JOIN line l ON l.id = x.line_id LEFT JOIN tag t ON t.id = x.tag_id
       ${u("ur", "raised_by")} ${u("ua", "answered_by")} ${u("uc", "closed_by")}
      WHERE x.project_id = $1 ORDER BY x.tq_no DESC`, [projectId]);
  const { rows: changes } = await db.query(
    `SELECT x.*, d.doc_no, l.line_no, t.tag_no, q.tq_no, ur.display_name AS raised_name, ud.display_name AS decided_name, ub.display_name AS asbuilt_name
       FROM site_change x LEFT JOIN mdr_document d ON d.id = x.mdr_document_id LEFT JOIN line l ON l.id = x.line_id LEFT JOIN tag t ON t.id = x.tag_id
       LEFT JOIN tech_query q ON q.id = x.tq_id ${u("ur", "raised_by")} ${u("ud", "decided_by")} ${u("ub", "asbuilt_by")}
      WHERE x.project_id = $1 ORDER BY x.fcr_no DESC`, [projectId]);
  const { rows: wos } = await db.query(
    `SELECT x.*, c.contract_no, k.code AS contractor, a.code AS wbs, q.tq_no, s.fcr_no, up.display_name AS prepared_name, ui.display_name AS issued_name,
            (SELECT max(sl.cum_qty)::float8 FROM pay_statement_line sl JOIN pay_statement p ON p.id = sl.statement_id
              WHERE sl.line_id = x.line_id AND p.status IN ('approved', 'paid')) AS certified_qty
       FROM work_order x JOIN contract c ON c.id = x.contract_id LEFT JOIN contractor k ON k.id = c.contractor_id
       LEFT JOIN control_account a ON a.id = x.account_id LEFT JOIN tech_query q ON q.id = x.tq_id LEFT JOIN site_change s ON s.id = x.site_change_id
       ${u("up", "prepared_by")} ${u("ui", "issued_by")}
      WHERE x.project_id = $1 ORDER BY x.wo_no DESC`, [projectId]);
  const d = (r, ...ks) => { for (const k of ks) r[k] = iso(r[k]); return r; };
  return {
    tqs: tqs.map((r) => ({ ...d(r, "raised_on", "reply_due", "answered_on"), statusFa: TQ_STATUS[r.status], outcomeFa: TQ_OUTCOME[r.outcome] || null,
      overdue: r.status === "open" && r.reply_due && iso(r.reply_due) < latestToday() })),
    changes: changes.map((r) => ({ ...d(r, "raised_on", "asbuilt_on"), kindFa: SITE_CHANGE_KIND[r.kind], statusFa: FCR_STATUS[r.status] })),
    workOrders: wos.map((r) => ({ ...d(r, "issued_on", "completed_on"), qty: Number(r.qty), rate: Number(r.rate), amount: Number(r.qty) * Number(r.rate),
      statusFa: WO_STATUS[r.status], originFa: WO_ORIGIN[r.origin] })),
    kinds: SITE_CHANGE_KIND, origins: WO_ORIGIN, outcomes: TQ_OUTCOME,
  };
}
