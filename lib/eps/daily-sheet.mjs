/**
 * The daily work sheet (owner's requirements of 2026-10-22, item 29): the
 * work done on the WBS activities, a row per line of a daily report, read
 * from Excel the way the progress page enters it. Pure — the repository
 * (lib/db/repos/eps-activities.mjs importProgressSheet) finds the reports,
 * activities and companies the lines name, and writes.
 */
import { sheetDate } from "./import.mjs";

export const DAILY_HEAD = ["Date", "Report No", "WBS code", "Activity code", "Qty", "Area / Contractor", "Mark", "Notes"];
const COLS = {
  date: [/^(date|report\s*date)$/i, /^تاریخ/],                                  // i18n: a Persian header a file may carry
  reportNo: [/^report(\s*(no\.?|number))?$/i, /^شماره\s*گزارش/],               // i18n: a Persian header a file may carry
  wbs: [/^wbs(\s*(code|no\.?))?$/i, /^کد\s*wbs/i],                             // i18n: a Persian header a file may carry
  code: [/^activity(\s*(code|id|no\.?))?$/i, /^کد\s*فعالیت/],                   // i18n: a Persian header a file may carry
  qty: [/^(qty|quantity|done)$/i, /^(مقدار|حجم)/],                              // i18n: a Persian header a file may carry
  area: [/^(area|contractor|area\s*\/\s*contractor)$/i, /^(ناحیه|پیمانکار)/],    // i18n: a Persian header a file may carry
  mark: [/^mark$/i, /^مارک/],                                                    // i18n: a Persian header a file may carry
  notes: [/^(notes?|remark|description)$/i, /^(توضیحات|شرح)/],                   // i18n: a Persian header a file may carry
};
const r10 = (v) => Math.round(v * 1e10) / 1e10;

/**
 * Rows (arrays, header among the first ten) → lines { row, date, reportNo,
 * wbs, code, qty, area, mark, notes }. A line needs a report number, an
 * activity code and a quantity above zero; what it lacks, or a date it
 * cannot read, is named — nothing is guessed.
 */
export function fromDailySheet(rows) {
  const problems = [];
  const cell = (v) => (v == null ? "" : String(v).trim());
  const hi = rows.slice(0, 10).findIndex((r) => (r || []).some((h) => COLS.code.some((rx) => rx.test(cell(h)))));
  if (hi < 0) return { lines: [], problems: ["ستون «Activity code» (کد فعالیت) در ده ردیف اول پیدا نشد."] };
  const head = rows[hi].map(cell);
  const col = {};
  const taken = new Set();
  for (const [k, rxs] of Object.entries(COLS)) {
    col[k] = head.findIndex((h, i) => h && !taken.has(i) && rxs.some((rx) => rx.test(h)));
    if (col[k] >= 0) taken.add(col[k]);
  }
  const get = (r, k) => (col[k] >= 0 ? r[col[k]] : null);
  const lines = [];
  rows.slice(hi + 1).forEach((r, i) => {
    r = r || [];
    const row = hi + i + 2;
    const code = cell(get(r, "code"));
    if (!code && !cell(get(r, "reportNo"))) return;
    const d = sheetDate(get(r, "date"));
    if (d === undefined) problems.push(`ردیف ${row}: «${cell(get(r, "date"))}» تاریخ میلادی (yyyy-mm-dd) نیست.`);
    const reportNo = cell(get(r, "reportNo"));
    const qRaw = get(r, "qty");
    const qty = qRaw == null || cell(qRaw) === "" ? null : Number(String(qRaw).replace(/[٬,]/g, ""));
    if (!code) problems.push(`ردیف ${row}: کد فعالیت ندارد.`);
    if (!reportNo) problems.push(`ردیف ${row}: شمارهٔ گزارش ندارد.`);
    if (qty === null || !Number.isFinite(qty) || qty <= 0) problems.push(`ردیف ${row}: مقدار «${cell(qRaw)}» عددی بزرگ‌تر از صفر نیست.`);
    lines.push({ row, date: d || null, reportNo, wbs: cell(get(r, "wbs")) || null, code, qty: Number.isFinite(qty) ? r10(qty) : null,
      area: cell(get(r, "area")) || null, mark: cell(get(r, "mark")) || null, notes: cell(get(r, "notes")) || null });
  });
  return { lines, problems };
}
