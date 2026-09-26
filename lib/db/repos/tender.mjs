/**
 * Material requisitions, tenders, awards, and the Vendor Data Template.
 *
 * Every rule is lib/procurement/tender.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  bidProblems, rankBids, awardProblems, templateProblems, submissionProblems, masterFromSubmission, vdtState, TECH_STATUS,
} from "../../procurement/tender.mjs";
import { createPo, addPoLine } from "./procurement.mjs";
import { setAssetMaster } from "./handover.mjs";

// ── material requisition ──────────────────────────────────────────────────

export async function createMr(db, { projectId, mrNo, title, discipline = null, userId = null }) {
  if (!blank(mrNo) || !blank(title)) throw bad("شماره و عنوان MR لازم است.");
  const { rows: [m] } = await db.query(
    `INSERT INTO material_requisition (project_id, mr_no, title, discipline, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [projectId, blank(mrNo).toUpperCase(), blank(title), blank(discipline), userId]);
  return m;
}

/** A line is edited only while the MR is in draft; after issue, change it by a new revision. */
export async function addMrLine(db, { projectId, mrId, itemId = null, tagId = null, description = null, qty, uom = null, needOn = null, fatRequired = false }) {
  const mr = await mrRow(db, projectId, mrId);
  if (mr.status !== "draft") throw bad(`MR ${mr.mr_no} صادر شده؛ برای تغییر، بازنگری (رویژن جدید) باز کنید.`);
  if (!!itemId === !!tagId) throw bad("هر ردیف یا یک کالای انبار است یا یک تگ تجهیز — یکی از این دو.");
  if (!(Number(qty) > 0)) throw bad("مقدار باید مثبت باشد.");
  let unit = blank(uom);
  if (itemId) {
    const { rows: [i] } = await db.query("SELECT uom FROM material_item WHERE id = $1 AND project_id = $2", [itemId, projectId]);
    if (!i) throw notFound("material item");
    if (unit && unit !== i.uom) throw bad(`واحد کالا ${i.uom} است.`);
    unit = i.uom;
  } else {
    const { rows: [t] } = await db.query("SELECT id FROM tag WHERE id = $1 AND project_id = $2", [tagId, projectId]);
    if (!t) throw notFound("tag");
    unit = unit || "EA";
  }
  const { rows: [{ n }] } = await db.query("SELECT COALESCE(max(line_no), 0)::int AS n FROM mr_line WHERE mr_id = $1", [mrId]);
  const { rows: [l] } = await db.query(
    `INSERT INTO mr_line (project_id, mr_id, line_no, item_id, tag_id, description, qty, uom, need_on, fat_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [projectId, mrId, n + 1, itemId || null, tagId || null, blank(description), Number(qty), unit, needOn || null, !!fatRequired]);
  return l;
}

export async function removeMrLine(db, { projectId, lineId }) {
  const { rows: [l] } = await db.query("SELECT mr_id FROM mr_line WHERE id = $1 AND project_id = $2", [lineId, projectId]);
  if (!l) throw notFound("MR line");
  const mr = await mrRow(db, projectId, l.mr_id);
  if (mr.status !== "draft") throw bad("ردیف MR صادرشده حذف نمی‌شود.");
  await db.query("DELETE FROM mr_line WHERE id = $1", [lineId]);
}

/** Issue the draft as the next revision: the lines are frozen with the reason. */
export async function issueMr(db, { projectId, mrId, reason, userId = null }) {
  const mr = await mrRow(db, projectId, mrId);
  if (mr.status !== "draft") throw bad("فقط MR در حالت پیش‌نویس صادر می‌شود.");
  if (!blank(reason)) throw bad("دلیل صدور لازم است (مثلاً «برای استعلام» یا تغییر نسبت به رویژن قبل).");
  const lines = await mrLines(db, projectId, mrId);
  if (!lines.length) throw bad("MR بدون ردیف صادر نمی‌شود.");
  const rev = mr.current_rev === null ? 0 : mr.current_rev + 1;
  await db.query(`INSERT INTO mr_revision (project_id, mr_id, rev, reason, lines, issued_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [projectId, mrId, rev, blank(reason), JSON.stringify(lines), userId]);
  const { rows: [m] } = await db.query(
    "UPDATE material_requisition SET status = 'issued', current_rev = $2 WHERE id = $1 RETURNING *", [mrId, rev]);
  return m;
}

/** Open an issued MR for a revision. Bids on the issued revision stay, and stop counting once the next is issued. */
export async function reviseMr(db, { projectId, mrId }) {
  const mr = await mrRow(db, projectId, mrId);
  if (mr.status !== "issued") throw bad(mr.status === "awarded" ? "MR واگذار شده؛ تغییر از طریق PO است." : "فقط MR صادرشده بازنگری می‌شود.");
  const { rows: [m] } = await db.query("UPDATE material_requisition SET status = 'draft' WHERE id = $1 RETURNING *", [mrId]);
  return m;
}

// ── bids ──────────────────────────────────────────────────────────────────

export async function recordBid(db, {
  projectId, mrId, vendorId, bidRef = null, receivedOn, validUntil = null, currency = null, totalPrice = null,
  deliveryWeeks = null, userId = null,
}) {
  const mr = await mrRow(db, projectId, mrId);
  if (mr.current_rev === null) throw bad("MR هنوز صادر نشده؛ پیشنهادی نمی‌تواند به آن پاسخ دهد.");
  if (mr.status === "awarded" || mr.status === "cancelled") throw bad("مناقصهٔ این MR بسته است.");
  if (!vendorId || !receivedOn) throw bad("فروشنده و تاریخ دریافت لازم است.");
  const price = num(totalPrice);
  if (price !== null && !(price > 0)) throw bad("قیمت باید مثبت باشد.");
  if (price !== null && !blank(currency)) throw bad("ارز پیشنهاد را بنویسید — قیمت بدون ارز مقایسه نمی‌شود.");
  const { rows: [b] } = await db.query(
    `INSERT INTO bid (project_id, mr_id, vendor_id, mr_rev, bid_ref, received_on, valid_until, currency, total_price,
                      delivery_weeks, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [projectId, mrId, vendorId, mr.current_rev, blank(bidRef), receivedOn, validUntil || null,
     blank(currency)?.toUpperCase() ?? null, price, num(deliveryWeeks), userId]);
  return b;
}

/** A person's technical judgement. "Not acceptable" says why. */
export async function evaluateBid(db, { projectId, bidId, techStatus, note = null, userId = null }) {
  if (!TECH_STATUS[techStatus] || techStatus === "pending") throw bad("نتیجهٔ ارزیابی فنی: قابل‌قبول یا مردود.");
  if (techStatus === "not_acceptable" && !blank(note)) throw bad("دلیل مردودی فنی را بنویسید.");
  const { rows: [b] } = await db.query("SELECT b.*, m.status AS mr_status FROM bid b JOIN material_requisition m ON m.id = b.mr_id WHERE b.id = $1 AND b.project_id = $2", [bidId, projectId]);
  if (!b) throw notFound("bid");
  if (b.mr_status === "awarded") throw bad("مناقصه واگذار شده؛ ارزیابی تغییر نمی‌کند.");
  const { rows: [r] } = await db.query(
    `UPDATE bid SET tech_status = $2, tech_note = $3, tech_by = $4, tech_at = now() WHERE id = $1 RETURNING *`,
    [bidId, techStatus, blank(note), userId]);
  return r;
}

/** The MR's bids, each with why it is not evaluated, and the ranking. */
export async function tenderOf(db, { projectId, mrId, today = todayIso() }) {
  const mr = await mrRow(db, projectId, mrId);
  const { rows } = await db.query(
    `SELECT b.*, v.code AS vendor_code, v.name AS vendor_name FROM bid b JOIN vendor v ON v.id = b.vendor_id
      WHERE b.mr_id = $1 ORDER BY b.received_on, v.code`, [mrId]);
  const bids = rows.map(asBid);
  const ctx = { currentRev: mr.current_rev, today, bids };
  const rank = rankBids(bids, ctx);
  return {
    bids: bids.map((b) => ({ ...b, problems: bidProblems(b, ctx), rank: rank.ranked?.find((r) => r.id === b.id)?.rank ?? null,
      lowest: rank.lowestIds.includes(b.id) })),
    ranking: rank,
  };
}

/**
 * Award: a person picks the bid; the platform refuses what the rules refuse,
 * places the PO from the MR's issued lines, and keeps the ranking as it was.
 */
export async function awardMr(db, { projectId, mrId, bidId, poNo, placedOn, justification = null, userId = null, today = todayIso() }) {
  const mr = await mrRow(db, projectId, mrId);
  if (mr.status !== "issued") throw bad(mr.status === "awarded" ? "این MR قبلاً واگذار شده." : "فقط MR صادرشده واگذار می‌شود.");
  if (!userId) throw bad("واگذاری را یک شخص انجام می‌دهد.");
  const t = await tenderOf(db, { projectId, mrId, today });
  const bid = t.bids.find((b) => b.id === bidId);
  if (!bid) throw notFound("bid");
  const problems = awardProblems(bid, { currentRev: mr.current_rev, today, bids: t.bids }, { justification });
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: [rev] } = await db.query("SELECT lines FROM mr_revision WHERE mr_id = $1 AND rev = $2", [mrId, mr.current_rev]);
  const po = await createPo(db, { projectId, poNo, vendorId: bid.vendorId, title: mr.title, currency: bid.currency, placedOn, userId });
  await db.query("UPDATE purchase_order SET mr_id = $2 WHERE id = $1", [po.id, mrId]);
  for (const l of rev.lines) {
    await addPoLine(db, { projectId, poId: po.id, itemId: l.item_id, tagId: l.tag_id, description: l.description,
      // A revision issued before 050 has no fat_required: it asked for none.
      qty: l.qty, uom: l.uom, needOn: l.need_on, fatRequired: !!l.fat_required });
  }
  await db.query(
    `INSERT INTO mr_award (project_id, mr_id, bid_id, po_id, justification, ranking, awarded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [projectId, mrId, bidId, po.id, blank(justification), JSON.stringify(t.ranking), userId]);
  await db.query("UPDATE material_requisition SET status = 'awarded' WHERE id = $1", [mrId]);
  return { po, lines: rev.lines.length };
}

export async function mrBoard(db, { projectId, today = todayIso() }) {
  const { rows } = await db.query(
    `SELECT m.*, (SELECT count(*)::int FROM mr_line l WHERE l.mr_id = m.id) AS line_count,
            (SELECT count(*)::int FROM bid b WHERE b.mr_id = m.id) AS bid_count,
            a.po_id, a.justification, a.awarded_at, po.po_no, v.code AS awarded_vendor
       FROM material_requisition m LEFT JOIN mr_award a ON a.mr_id = m.id
       LEFT JOIN purchase_order po ON po.id = a.po_id LEFT JOIN vendor v ON v.id = po.vendor_id
      WHERE m.project_id = $1 ORDER BY m.mr_no`, [projectId]);
  const out = [];
  for (const m of rows) {
    const { rows: revisions } = await db.query(
      `SELECT r.rev, r.reason, r.issued_at, u.display_name AS by_name FROM mr_revision r LEFT JOIN app_user u ON u.id = r.issued_by
        WHERE r.mr_id = $1 ORDER BY r.rev`, [m.id]);
    out.push({ ...m, lines: await mrLines(db, projectId, m.id), revisions, tender: await tenderOf(db, { projectId, mrId: m.id, today }) });
  }
  return out;
}

// ── Vendor Data Template ─────────────────────────────────────────────────

/** A new revision of a class's template — the project's, not a built-in list. */
export async function setTemplate(db, { projectId, isoClass, attributes, reason, userId = null }) {
  const cls = blank(isoClass)?.toUpperCase();
  if (!cls) throw bad("کلاس ISO 14224 لازم است.");
  if (!blank(reason)) throw bad("دلیل تغییر قالب لازم است.");
  const attrs = (attributes || []).map((a) => ({ key: blank(a.key), label: blank(a.label), unit: blank(a.unit), type: a.type || "text", required: !!a.required }));
  const p = templateProblems(attrs);
  if (p.length) throw bad(p.join(" · "));
  const { rows: [{ n }] } = await db.query(
    "SELECT COALESCE(max(rev), -1)::int AS n FROM vdt_template WHERE project_id = $1 AND iso_class = $2", [projectId, cls]);
  const { rows: [t] } = await db.query(
    `INSERT INTO vdt_template (project_id, iso_class, rev, attributes, reason, by_user) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [projectId, cls, n + 1, JSON.stringify(attrs), blank(reason), userId]);
  return t;
}

async function currentTemplate(db, projectId, isoClass) {
  if (!isoClass) return null;
  const { rows: [t] } = await db.query(
    "SELECT * FROM vdt_template WHERE project_id = $1 AND iso_class = $2 ORDER BY rev DESC LIMIT 1", [projectId, isoClass]);
  return t || null;
}

/** Record what the vendor sent, complete or not — incompleteness is shown, not hidden by refusing it. */
export async function submitVdt(db, { projectId, tagId, values, submittedOn, vendorRef = null, userId = null }) {
  const { rows: [m] } = await db.query(
    "SELECT t.id, a.iso_class FROM tag t LEFT JOIN asset_master a ON a.tag_id = t.id WHERE t.id = $1 AND t.project_id = $2", [tagId, projectId]);
  if (!m) throw notFound("tag");
  if (!m.iso_class) throw bad("کلاس ISO 14224 این تگ در شناسنامهٔ نگهداری تعیین نشده؛ قالب VDT از روی آن انتخاب می‌شود.");
  const tpl = await currentTemplate(db, projectId, m.iso_class);
  if (!tpl) throw bad(`قالب VDT برای کلاس ${m.iso_class} تعریف نشده.`);
  if (!submittedOn) throw bad("تاریخ دریافت لازم است.");
  const clean = Object.fromEntries(Object.entries(values || {}).filter(([, v]) => blank(v) !== null).map(([k, v]) => [k, String(v).trim()]));
  const { rows: [s] } = await db.query(
    `INSERT INTO vdt_submission (project_id, tag_id, template_id, vendor_ref, values, submitted_on, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, tagId, tpl.id, blank(vendorRef), JSON.stringify(clean), submittedOn, userId]);
  return { ...s, problems: submissionProblems(tpl.attributes, clean) };
}

/**
 * Accept or return a submission. Accepting needs it complete against the
 * template it answered; its nameplate values go to the asset master, and a
 * value that differs from one already there needs `confirmDifferences`.
 */
export async function reviewVdt(db, { projectId, submissionId, decision, note = null, confirmDifferences = false, userId = null }) {
  const { rows: [s] } = await db.query(
    `SELECT s.*, t.attributes FROM vdt_submission s JOIN vdt_template t ON t.id = s.template_id
      WHERE s.id = $1 AND s.project_id = $2`, [submissionId, projectId]);
  if (!s) throw notFound("VDT submission");
  if (s.status !== "submitted") throw bad("این ارسال قبلاً بررسی شده.");
  if (!userId) throw bad("بررسی را یک شخص انجام می‌دهد.");
  if (decision === "returned") {
    if (!blank(note)) throw bad("دلیل برگشت را بنویسید.");
  } else if (decision === "accepted") {
    const p = submissionProblems(s.attributes, s.values);
    if (p.length) throw bad(`ارسال ناقص پذیرفته نمی‌شود: ${p.join(" · ")}`);
    const { rows: [am] } = await db.query("SELECT * FROM asset_master WHERE tag_id = $1", [s.tag_id]);
    const master = { isoClass: am.iso_class, criticality: am.criticality, criticalityBasis: am.criticality_basis,
      manufacturer: am.manufacturer, model: am.model, serialNo: am.serial_no, yearBuilt: am.year_built };
    const { patch, differences } = masterFromSubmission(s.values, master);
    if (differences.length && !confirmDifferences) {
      throw Object.assign(bad(`با شناسنامهٔ فعلی فرق دارد: ${differences.map((d) => `${d.field}: ${d.current} ← ${d.submitted}`).join(" · ")}`),
        { code: "VDT_DIFFERS", differences });
    }
    if (Object.keys(patch).length) await setAssetMaster(db, { projectId, tagId: s.tag_id, ...master, ...patch, userId });
  } else throw bad("تصمیم: پذیرش یا برگشت.");
  const { rows: [r] } = await db.query(
    `UPDATE vdt_submission SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 RETURNING *`,
    [submissionId, decision, blank(note), userId]);
  return r;
}

/** Every equipment tag with its class, template and latest submission. */
export async function vdtBoard(db, { projectId }) {
  const { rows: templates } = await db.query(
    `SELECT DISTINCT ON (iso_class) * FROM vdt_template WHERE project_id = $1 ORDER BY iso_class, rev DESC`, [projectId]);
  const byClass = Object.fromEntries(templates.map((t) => [t.iso_class, t]));
  const { rows: tags } = await db.query(
    `SELECT t.id, t.tag_no, a.iso_class,
            (SELECT po.po_no FROM po_line pl JOIN purchase_order po ON po.id = pl.po_id WHERE pl.tag_id = t.id LIMIT 1) AS po_no
       FROM tag t LEFT JOIN asset_master a ON a.tag_id = t.id
      WHERE t.project_id = $1 AND t.discipline = 'equipment' ORDER BY t.tag_no`, [projectId]);
  const { rows: subs } = await db.query(
    `SELECT DISTINCT ON (s.tag_id) s.*, t.rev AS template_rev, t.iso_class, t.attributes AS answered_attributes FROM vdt_submission s JOIN vdt_template t ON t.id = s.template_id
      WHERE s.project_id = $1 ORDER BY s.tag_id, s.created_at DESC`, [projectId]);
  const latestOf = Object.fromEntries(subs.map((s) => [s.tag_id, s]));
  return {
    templates,
    tags: tags.map((t) => {
      const template = byClass[t.iso_class] || null;
      const latest = latestOf[t.id] || null;
      // A submission is judged against the template it answered, not a later revision.
      const state = vdtState({ isoClass: t.iso_class, template: latest ? { attributes: latest.answered_attributes } : template, latest });
      return { ...t, templateRev: template?.rev ?? null, latest, state,
        outdated: !!(latest && template && latest.template_rev !== template.rev) };
    }),
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

async function mrRow(db, projectId, id) {
  const { rows: [m] } = await db.query("SELECT * FROM material_requisition WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!m) throw notFound("material requisition");
  return m;
}
async function mrLines(db, projectId, mrId) {
  const { rows } = await db.query(
    `SELECT l.id, l.line_no, l.item_id, l.tag_id, l.description, l.qty::float8 AS qty, l.uom, l.need_on, l.fat_required,
            i.code AS item_code, t.tag_no
       FROM mr_line l LEFT JOIN material_item i ON i.id = l.item_id LEFT JOIN tag t ON t.id = l.tag_id
      WHERE l.mr_id = $1 AND l.project_id = $2 ORDER BY l.line_no`, [mrId, projectId]);
  return rows.map((r) => ({ ...r, need_on: iso(r.need_on) }));
}
const asBid = (b) => ({
  id: b.id, vendorId: b.vendor_id, vendorCode: b.vendor_code, vendorName: b.vendor_name, mrRev: b.mr_rev, bidRef: b.bid_ref,
  receivedOn: iso(b.received_on), validUntil: iso(b.valid_until), currency: b.currency, totalPrice: b.total_price === null ? null : Number(b.total_price),
  deliveryWeeks: b.delivery_weeks, techStatus: b.tech_status, techNote: b.tech_note,
});
const blank = (v) => (v === null || v === undefined || !String(v).trim() ? null : String(v).trim());
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const todayIso = () => new Date().toISOString().slice(0, 10);
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
