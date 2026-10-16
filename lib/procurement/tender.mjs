/**
 * Procurement before the PO: material requisition, tender, award — and the
 * vendor's structured data after it (Vendor Data Template).
 *
 * The platform checks and ranks; a person evaluates and awards.
 *
 *   MR          lines are edited only in draft; issuing freezes them as a
 *               numbered revision with a reason. A change after issue is a
 *               new revision, never an edit of what vendors quoted against.
 *   Bid         quotes one MR revision. It is evaluated only if it quotes
 *               the CURRENT revision, is technically acceptable (a person's
 *               judgement, with a reason when not), is still valid on the
 *               day, and has a price.
 *   Ranking     lowest price among evaluable bids — and only when they share
 *               one currency. The platform holds no exchange rate and does
 *               not guess one; bids in two currencies are not ranked.
 *               No weighted scoring: weights are the company's tender
 *               policy, and none is invented here.
 *   Award       a person awards. Only an evaluable bid can win; awarding
 *               anything but the (or a tied) lowest needs a written
 *               justification, and so does awarding when there is no
 *               ranking. The ranking at the moment of award is kept.
 *   VDT         the project's template per ISO 14224 class names the data
 *               a vendor must supply for a tag. A submission missing a
 *               required value, or with a number that is not a number, is
 *               recorded but cannot be accepted. Accepted nameplate values
 *               flow to the asset master; a value that differs from one
 *               already there is shown, not silently overwritten.
 */

export const TECH_STATUS = { pending: "در انتظار ارزیابی فنی", acceptable: "فنی قابل‌قبول", not_acceptable: "فنی مردود" };
export const ATTR_TYPES = { number: "عددی", text: "متنی" };
/** Template keys that are asset-master fields — the one place they are typed. */
export const MASTER_KEYS = { manufacturer: "manufacturer", model: "model", serial_no: "serialNo", year_built: "yearBuilt" };

const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/** Why a bid is not evaluated; empty when it is. */
export function bidProblems(bid, { currentRev, today }) {
  const out = [];
  if (currentRev === null || currentRev === undefined) out.push("MR هنوز صادر نشده");
  else if (bid.mrRev !== currentRev) out.push(`پیشنهاد برای Rev ${bid.mrRev} است؛ MR جاری Rev ${currentRev}`);
  if (bid.techStatus === "pending") out.push("ارزیابی فنی ثبت نشده");
  if (bid.techStatus === "not_acceptable") out.push("فنی مردود");
  if (!has(bid.validUntil)) out.push("اعتبار پیشنهاد نامعلوم");
  else if (bid.validUntil < today) out.push(`اعتبار پیشنهاد در ${bid.validUntil} تمام شده`);
  if (!(Number(bid.totalPrice) > 0)) out.push("قیمت ندارد");
  else if (!has(bid.currency)) out.push("ارز پیشنهاد نامعلوم");
  return out;
}

/**
 * Rank the evaluable bids by price. Returns { ranked, lowestIds, reason }:
 * ranked is null (with a reason) when there is nothing to rank or the
 * currencies differ.
 */
export function rankBids(bids, ctx) {
  const ok = bids.filter((b) => bidProblems(b, ctx).length === 0);
  if (!ok.length) return { ranked: null, lowestIds: [], reason: "هیچ پیشنهاد قابل‌ارزیابی‌ای نیست" };
  const currencies = [...new Set(ok.map((b) => b.currency.trim().toUpperCase()))];
  if (currencies.length > 1) {
    return { ranked: null, lowestIds: [], reason: `ارزها متفاوت است (${currencies.join("، ")}) — نرخ تبدیل در پلتفرم نیست و حدس زده نمی‌شود` };
  }
  const sorted = [...ok].sort((a, b) => Number(a.totalPrice) - Number(b.totalPrice));
  const low = Number(sorted[0].totalPrice);
  let rank = 0, prev = null;
  const ranked = sorted.map((b, i) => {
    if (Number(b.totalPrice) !== prev) { rank = i + 1; prev = Number(b.totalPrice); }
    return { id: b.id, rank, totalPrice: Number(b.totalPrice), currency: currencies[0] };
  });
  return { ranked, lowestIds: ranked.filter((r) => r.totalPrice === low).map((r) => r.id), reason: null };
}

/** Why this award cannot be made; empty when it can. */
export function awardProblems(bid, ctx, { justification } = {}) {
  const p = bidProblems(bid, ctx);
  if (p.length) return p.map((x) => `پیشنهاد برنده قابل‌ارزیابی نیست: ${x}`);
  const r = rankBids(ctx.bids, ctx);
  if (!r.lowestIds.includes(bid.id) && !has(justification)) {
    return [r.ranked ? "این پیشنهاد کمترین قیمت نیست — دلیل انتخاب را بنویسید" : `رتبه‌بندی ممکن نیست (${r.reason}) — دلیل انتخاب را بنویسید`];
  }
  return [];
}

/** Problems with a template's attribute list. */
export function templateProblems(attributes) {
  const out = [];
  if (!Array.isArray(attributes) || !attributes.length) return ["قالب دست‌کم یک مشخصه لازم دارد"];
  const seen = new Set();
  for (const a of attributes) {
    if (!/^[a-z][a-z0-9_]*$/.test(a.key || "")) out.push(`کلید «${a.key ?? ""}» نامعتبر است (حروف کوچک لاتین، رقم، _)`);
    else if (seen.has(a.key)) out.push(`کلید «${a.key}» تکراری است`);
    seen.add(a.key);
    if (!has(a.label)) out.push(`«${a.key}» عنوان ندارد`);
    if (!ATTR_TYPES[a.type]) out.push(`نوع «${a.type}» برای «${a.key}» شناخته نشد`);
    if (a.key === "year_built" && a.type !== "number") out.push("year_built باید عددی باشد");
  }
  return out;
}

/** What is wrong with a vendor's values against the template; empty when complete. */
export function submissionProblems(attributes, values = {}) {
  const out = [];
  const keys = new Set(attributes.map((a) => a.key));
  for (const k of Object.keys(values)) if (!keys.has(k)) out.push(`«${k}» در قالب نیست`);
  for (const a of attributes) {
    const v = values[a.key];
    if (!has(v)) { if (a.required) out.push(`«${a.label}» خالی است`); continue; }
    if (a.type === "number" && !Number.isFinite(Number(String(v).replace(/,/g, "")))) out.push(`«${a.label}» عدد نیست: ${v}`);
  }
  return out;
}

/** Nameplate values from a submission, and where they differ from the asset master already held. */
export function masterFromSubmission(values, master = {}) {
  const patch = {}, differences = [];
  for (const [key, field] of Object.entries(MASTER_KEYS)) {
    if (!has(values[key])) continue;
    const v = field === "yearBuilt" ? Number(values[key]) : String(values[key]).trim();
    patch[field] = v;
    const cur = master[field];
    if (has(cur) && String(cur) !== String(v)) differences.push({ field: key, current: cur, submitted: v });
  }
  return { patch, differences };
}

/** A tag's VDT state, for the board. */
export function vdtState({ isoClass, template, latest }) {
  if (!isoClass) return { code: "no_class", text: "کلاس ISO 14224 تعیین نشده" };
  if (!template) return { code: "no_template", text: `قالب VDT برای ${isoClass} تعریف نشده` };
  if (!latest) return { code: "awaiting", text: "وندور هنوز داده نفرستاده" };
  if (latest.status === "accepted") return { code: "accepted", text: "پذیرفته — در شناسنامه" };
  if (latest.status === "returned") return { code: "returned", text: "برگشت به وندور" };
  const p = submissionProblems(template.attributes, latest.values);
  return p.length ? { code: "incomplete", text: `ناقص: ${p.length} مورد`, problems: p } : { code: "review", text: "کامل — منتظر بررسی" };
}
