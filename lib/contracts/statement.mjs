/**
 * A contractor's payment statement (صورت وضعیت), as arithmetic and rules.
 *
 * CUMULATIVE, as the general conditions of contract have it: each statement
 * measures every item from the start of the work to its period end; this
 * statement's gross is the cumulative gross less the last approved one's.
 * Deductions are taken on this period's gross — advance recovery (never more
 * than what is still outstanding), retention, insurance, withholding tax —
 * and VAT is added. Nothing here is rounded until the end, then to the
 * currency's cent.
 *
 * The quantity of an item is never typed where the platform already has it
 * (lib/contracts/measure.mjs): what is typed is only what has no other
 * source — a measured quantity, with the measurement sheet it came from.
 */

export const METHODS = {
  platform: "اندازه‌گیری پلتفرم",
  design: "مقدار طراحی (PDMS) × پیشرفت WBS",
  measured: "صورت‌جلسهٔ اندازه‌گیری",
  lump_sum: "مقطوع × پیشرفت WBS",
};

export const STATUS = {
  draft: "پیش‌نویس", submitted: "ارسال‌شده — منتظر تأیید فنی", verified: "تأیید فنی — منتظر امور قراردادها",
  approved: "تأییدشده — منتظر پرداخت", paid: "پرداخت‌شده",
};

export const CONTRACT_STATUS = { draft: "پیش‌نویس", in_review: "در بررسی", signed: "امضاشده (جاری)", closed: "بسته" };
export const CONTRACT_KIND = { main: "قرارداد اصلی (کارفرما)", subcontract: "پیمان (پیمانکار جزء)", service: "خدمات" };

const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * The money of one statement.
 *
 * @param {object} a
 * @param {Array<{qty, rate, cumQty}>} a.lines   cumQty null = not measured (counted as 0, and flagged elsewhere)
 * @param {number} a.grossPrev                   the last approved statement's cumulative gross (0 for the first)
 * @param {object} a.terms                       the contract's percentages
 * @param {number} a.advancePaid                 advance paid to date
 * @param {number} a.advanceRecovered            recovered by approved statements before this one
 */
export function statementMoney({ lines, grossPrev = 0, terms, advancePaid = 0, advanceRecovered = 0 }) {
  const grossCum = lines.reduce((s, l) => s + (num(l.cumQty) ?? 0) * Number(l.rate), 0);
  const grossThis = grossCum - Number(grossPrev || 0);
  const pct = (k) => (num(terms[k]) ?? 0) / 100;
  const recoveryPct = num(terms.advance_recovery_pct) ?? num(terms.advance_pct) ?? 0;
  const outstanding = Math.max(0, Number(advancePaid || 0) - Number(advanceRecovered || 0));
  // A negative period (a correction) returns no advance and holds nothing back.
  const base = Math.max(0, grossThis);
  const advanceRecovery = Math.min(outstanding, base * recoveryPct / 100);
  const retention = base * pct("retention_pct");
  const insurance = base * pct("insurance_pct");
  const withholding = base * pct("withholding_pct");
  const vat = grossThis * pct("vat_pct");
  const net = grossThis - advanceRecovery - retention - insurance - withholding + vat;
  return {
    grossCum: r2(grossCum), grossPrev: r2(grossPrev || 0), grossThis: r2(grossThis),
    advanceRecovery: r2(advanceRecovery), retention: r2(retention), insurance: r2(insurance),
    withholding: r2(withholding), vat: r2(vat), net: r2(net),
  };
}

/**
 * What a statement's lines say about themselves. `block` stops submission;
 * the rest is shown to whoever verifies and approves.
 */
export function lineFlags(l, { overrunLimitPct = 25 } = {}) {
  const out = [];
  const cum = num(l.cumQty), prev = num(l.prevQty) ?? 0, qty = Number(l.qty);
  const at = `ردیف ${l.itemNo}`;
  if (cum === null) {
    out.push({ level: "block", text: `${at}: مقدار اندازه‌گیری نشده${l.method === "measured" ? " — مقدار و شمارهٔ صورت‌جلسه لازم است" : ""}${l.reason ? ` (${l.reason})` : ""}` });
    return out;
  }
  if (cum < 0) out.push({ level: "block", text: `${at}: مقدار منفی` });
  if (l.method === "measured" && !String(l.sheetRef || "").trim()) out.push({ level: "block", text: `${at}: مقدار بدون شمارهٔ صورت‌جلسهٔ اندازه‌گیری` });
  if (cum > qty * (1 + overrunLimitPct / 100)) {
    out.push({ level: "block", text: `${at}: ${fmt(cum)} از ${fmt(qty)} ${l.unit} — بیش از ${overrunLimitPct}٪ مازاد مقدار قرارداد؛ الحاقیه لازم است` });
  } else if (cum > qty) {
    out.push({ level: "warn", text: `${at}: ${fmt(cum)} از ${fmt(qty)} ${l.unit} — بیش از مقدار قرارداد (در حد ${overrunLimitPct}٪ مجاز)` });
  }
  if (cum < prev) out.push({ level: "warn", text: `${at}: کمتر از صورت وضعیت قبل (${fmt(prev)} ← ${fmt(cum)}) — اصلاح مقدار` });
  return out;
}

const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 });

/**
 * Who may move a statement where. Returns the refusal, or null.
 * Four eyes: the one who submitted does not verify; the one who verified
 * does not approve; nobody approves what they prepared.
 */
export function transitionProblem(st, action, { userId, flags = [] } = {}) {
  const need = { submit: "draft", verify: "submitted", approve: "verified", return: null }[action];
  if (need === undefined) return `اقدام ناشناخته: ${action}`;
  if (action === "return") {
    if (!["submitted", "verified"].includes(st.status)) return `صورت وضعیت «${STATUS[st.status]}» برگشت داده نمی‌شود.`;
    return null;
  }
  if (st.status !== need) return `صورت وضعیت «${STATUS[st.status]}» است؛ این اقدام برای «${STATUS[need]}» است.`;
  if (action === "submit") {
    const blocks = flags.filter((f) => f.level === "block");
    if (blocks.length) return `ارسال نمی‌شود — ${blocks.map((f) => f.text).join("؛ ")}`;
  }
  if (action === "verify" && st.submitted_by === userId) return "ارسال‌کنندهٔ صورت وضعیت، آن را تأیید فنی نمی‌کند.";
  if (action === "approve") {
    if (st.verified_by === userId) return "تأییدکنندهٔ فنی، صورت وضعیت را از طرف امور قراردادها تأیید نمی‌کند.";
    if (st.prepared_by === userId || st.submitted_by === userId) return "تهیه‌کنندهٔ صورت وضعیت، آن را تأیید نهایی نمی‌کند.";
  }
  return null;
}
