/**
 * Procurement and expediting: the rules, with no database in sight.
 *
 * A PURCHASE ORDER LINE buys either a stock item (pipe, fittings, cable —
 * received into the warehouse as lots) or a tagged item (a pump, a vessel —
 * the tag on the spine). Its dates:
 *
 *   promised_on  the contractual delivery date, as the PO states it
 *   forecast_on  the latest expediting forecast
 *   need_on      required on site (ROS), from the construction schedule
 *
 *   slip  = forecast − promised   (the vendor's lateness)
 *   float = need − forecast       (negative: construction will wait)
 *
 * With no forecast the promised date stands in, and the line says so; with
 * no need date, float is unknown — not zero.
 *
 * INSPECTION RELEASE — a line marked for shop inspection (FAT) is not
 * shipped until the inspection passed or was waived with a reason, and a
 * release note (IRN) number is recorded. FAT itself waits for the vendor
 * documents the VDRL marks as needed before it, at review code 1 or 2.
 *
 * RECEIPT — against a PO line only, of the line's item and unit, and never
 * more in total than was ordered: an over-receipt is a different delivery
 * or a counting error, and either way it is not this PO's.
 *
 * VDRL — each vendor document is due on a date and reviewed with the usual
 * codes: 1 approved, 2 approved with comments, 3 rejected (resubmit),
 * 4 for information. A document is overdue when due and not submitted, or
 * returned code 3 and not resubmitted within the project's stated
 * resubmission period (no default; without it, a code-3 document is shown
 * as awaiting resubmission, not as overdue).
 */

export const REVIEW_CODES = {
  1: "کد ۱ — تأیید",
  2: "کد ۲ — تأیید با کامنت",
  3: "کد ۳ — رد، ارسال مجدد",
  4: "کد ۴ — برای اطلاع",
};
export const ACCEPTED_CODES = new Set([1, 2, 4]);
export const FAT_RESULTS = { pass: "قبول", fail: "رد", waived: "معاف (با دلیل)" };

/** Dates of one line: slip, float, and which date the forecast really is. */
export function lineDates({ promisedOn, forecastOn, needOn }, today) {
  const fc = forecastOn || promisedOn || null;
  const out = {
    forecast: fc, forecastIsPromise: !forecastOn && !!promisedOn,
    slipDays: promisedOn && forecastOn ? days(promisedOn, forecastOn) : null,
    floatDays: needOn && fc ? days(fc, needOn) : null,
    overdue: false,
  };
  out.overdue = !!fc && String(fc) < String(today);
  return out;
}

/**
 * Where a line stands, from what has happened to it.
 * @returns {"ordered"|"fat_pending"|"released"|"partly_shipped"|"shipped"|"partly_received"|"received"}
 */
export function lineStage({ qty, fatRequired, fat, shippedQty = 0, receivedQty = 0 }) {
  const q = Number(qty);
  if (receivedQty >= q) return "received";
  if (receivedQty > 0) return "partly_received";
  if (shippedQty >= q) return "shipped";
  if (shippedQty > 0) return "partly_shipped";
  if (fatRequired && !releasedBy(fat)) return fat ? "fat_pending" : "ordered";
  return fatRequired ? "released" : "ordered";
}
export const STAGE_FA = {
  ordered: "سفارش‌شده", fat_pending: "منتظر بازرسی کارخانه", released: "آزاد برای حمل (IRN)",
  partly_shipped: "بخشی حمل شد", shipped: "حمل شد", partly_received: "بخشی رسید", received: "رسید سایت",
};

const releasedBy = (fat) => !!fat && (fat.result === "pass" || fat.result === "waived") && !!String(fat.irnNo || "").trim();

/** Problems with recording a FAT result, or []. */
export function fatProblems({ result, irnNo, note }, { docsBeforeFat = [] } = {}) {
  const out = [];
  if (!FAT_RESULTS[result]) out.push("نتیجهٔ بازرسی را انتخاب کنید");
  if ((result === "pass" || result === "waived") && !String(irnNo || "").trim()) out.push("شمارهٔ برگهٔ آزادسازی (IRN) لازم است");
  if (result === "waived" && !String(note || "").trim()) out.push("معافیت از بازرسی بدون دلیل ثبت نمی‌شود");
  if (result === "fail" && !String(note || "").trim()) out.push("علت رد بازرسی لازم است");
  const open = docsBeforeFat.filter((d) => !ACCEPTED_CODES.has(d.code));
  if (result !== "fail" && open.length) out.push(`مدارک پیش از FAT تأیید نشده: ${open.map((d) => d.docCode).join("، ")}`);
  return out;
}

/** Problems with shipping a quantity of a line, or []. */
export function shipProblems(line, qty) {
  const out = [];
  const q = Number(qty);
  if (!(q > 0)) out.push("مقدار حمل باید مثبت باشد");
  if (line.fatRequired && !releasedBy(line.fat)) out.push("بدون آزادسازی بازرسی (FAT قبول یا معافیت با IRN) حمل نمی‌شود");
  if (q > 0 && (line.shippedQty || 0) + q > Number(line.qty) + 1e-9) out.push(`حمل بیش از مقدار سفارش (${line.qty} ${line.uom || ""})`);
  return out;
}

/** Problems with receiving a quantity of a line into the warehouse, or []. */
export function receiveProblems(line, { itemId, uom, qty }) {
  const out = [];
  const q = Number(qty);
  if (!line.itemId) out.push("این ردیف تجهیز تگ‌دار است، نه کالای انبار؛ رسید آن با ورود محموله ثبت می‌شود");
  if (line.itemId && itemId && itemId !== line.itemId) out.push("کالای رسید با کالای ردیف PO یکی نیست");
  if (uom && line.uom && uom !== line.uom) out.push(`واحد ${uom} با واحد سفارش ${line.uom} یکی نیست — تبدیل خاموش انجام نمی‌شود`);
  if (!(q > 0)) out.push("مقدار دریافتی باید مثبت باشد");
  if (q > 0 && (line.receivedQty || 0) + q > Number(line.qty) + 1e-9)
    out.push(`رسید بیش از سفارش: ${round3((line.receivedQty || 0) + q)} از ${line.qty}`);
  return out;
}

/**
 * A vendor document on a date.
 * @returns {{state: "pending"|"overdue"|"under_review"|"resubmit"|"resubmit_overdue"|"accepted", daysLate: number}}
 */
export function docState({ dueOn, lastSubmittedOn, lastCode, lastReturnedOn }, today, resubmitDays) {
  if (lastCode && ACCEPTED_CODES.has(Number(lastCode))) return { state: "accepted", daysLate: 0 };
  if (Number(lastCode) === 3) {
    const r = resubmitDays === null || resubmitDays === undefined || resubmitDays === "" ? null : Number(resubmitDays);
    if (r === null || !lastReturnedOn) return { state: "resubmit", daysLate: 0 };
    const late = days(lastReturnedOn, today) - r;
    return late > 0 ? { state: "resubmit_overdue", daysLate: late } : { state: "resubmit", daysLate: 0 };
  }
  if (lastSubmittedOn) return { state: "under_review", daysLate: 0 };
  if (dueOn && String(dueOn) < String(today)) return { state: "overdue", daysLate: days(dueOn, today) };
  return { state: "pending", daysLate: 0 };
}

/** What is still coming for one stock item: open quantity and the earliest forecast. */
export function onOrder(lines) {
  const open = lines.map((l) => ({ ...l, open: round3(Math.max(0, Number(l.qty) - (l.receivedQty || 0))) }))
    .filter((l) => l.open > 0);
  const dates = open.map((l) => l.forecastOn || l.promisedOn).filter(Boolean).sort();
  return { qty: round3(open.reduce((a, l) => a + l.open, 0)), nextOn: dates[0] || null, lines: open.length };
}

const day = (d) => Math.floor(Date.parse(String(d).slice(0, 10) + "T00:00:00Z") / 86_400_000);
const days = (from, to) => day(to) - day(from);
const round3 = (n) => Math.round(n * 1000) / 1000;
