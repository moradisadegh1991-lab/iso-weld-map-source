/**
 * A version's planning (owner's requirements of 2026-10-22, «PLANING»): the
 * activities of the PMS's WBS the version carries, each with its own start,
 * finish, the work done before it starts and the quantity it plans. Pure —
 * lib/db/repos/planning.mjs loads and writes.
 *
 * A row typed without some figures takes them from the activity:
 *   start        the activity's planned start
 *   finish       start + days − 1 when days are typed; else the activity's
 *                planned finish
 *   done before  the work the daily reports record before the start
 *   planned      the activity's whole quantity − done before
 * The whole quantity is the activity's actual volume, else its planned one;
 * with neither, planned stays empty — never a guess.
 */
import { finishOf, duration } from "./wbs.mjs";
import { sheetDate } from "./import.mjs";

const r10 = (v) => Math.round(v * 1e10) / 1e10;
const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const numOf = (v) => (blank(v) ? null : Number(String(v).replace(/[٬,]/g, "")));
const dateOf = (v) => (blank(v) ? null : String(v).trim().slice(0, 10));

/** The work recorded for an activity before a day, from its daily-report lines ({activityId, date, qty}). */
export function doneBefore(lines, activityId, day) {
  if (!day) return 0;
  return r10(lines.filter((l) => l.activityId === activityId && l.date && l.date < day).reduce((s, l) => s + Number(l.qty || 0), 0));
}

/**
 * A planning row from what was typed and the activity (as the tree computes
 * it: plan_start, plan_end, volumeActual, volumePlan). Returns { row } or
 * { problem } naming what does not hold.
 */
export function planRow(input, act, { lines = [], code = act?.code || "" } = {}) {
  const start = dateOf(input.startOn) ?? act.plan_start ?? null;
  const days = numOf(input.days);
  if (days !== null && (!Number.isInteger(days) || days < 1)) return { problem: `${code}: تعداد روز عدد صحیح ۱ یا بیشتر است.` };
  let end = dateOf(input.endOn);
  if (days !== null) {
    if (!start) return { problem: `${code}: بی‌تاریخ شروع، تعداد روز به پایان نمی‌رسد.` };
    end = finishOf(start, days);
  }
  if (end === null) end = act.plan_end ?? null;
  for (const [d, what] of [[start, "شروع"], [end, "پایان"]]) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { problem: `${code}: ${what} به شکل YYYY-MM-DD.` };
  }
  if (start && end && end < start) return { problem: `${code}: پایان پیش از شروع است.` };
  const before = numOf(input.doneBefore) ?? doneBefore(lines, act.id, start);
  if (!Number.isFinite(before) || before < 0) return { problem: `${code}: کار انجام‌شدهٔ قبل عددی صفر یا بیشتر است.` };
  const total = act.volumeActual ?? act.volumePlan ?? null;
  if (total !== null && before > Number(total) + 1e-9) return { problem: `${code}: کار انجام‌شدهٔ قبل (${before}) بیش از حجم کل فعالیت (${total}) است.` };
  let planned = numOf(input.volumePlan);
  if (planned === null && total !== null) planned = r10(Math.max(0, Number(total) - before));
  if (planned !== null && (!Number.isFinite(planned) || planned < 0)) return { problem: `${code}: مقدار برنامه‌شده عددی صفر یا بیشتر است.` };
  return { row: { start_on: start, end_on: end, done_before: before, volume_plan: planned, description: blank(input.description) ? null : String(input.description).replace(/\s+/g, " ").trim() } };
}

/** A planning row as shown: its days, and what the version leaves to do. */
export function planFigures(p, act) {
  const total = act?.volumeActual ?? act?.volumePlan ?? null;
  return { days: duration(p.start_on, p.end_on), total, remainAfter: total === null || p.volume_plan === null ? null : r10(Number(total) - Number(p.done_before || 0) - Number(p.volume_plan)) };
}

// ── the Excel sheet ─────────────────────────────────────────────────────

export const PLAN_HEAD = ["WBS code", "Activity code", "Start", "Days", "Finish", "Done before", "Planned", "Description"];
const PLAN_COLS = {
  wbs: [/^wbs(\s*(code|no\.?))?$/i, /^کد\s*wbs/i],                                  // i18n: a Persian header a file may carry
  code: [/^activity(\s*(code|id|no\.?))?$/i, /^(code|id)$/i, /^کد\s*فعالیت/],         // i18n: a Persian header a file may carry
  start: [/^(plan(ned)?\s*)?start(\s*date)?$/i, /^(تاریخ\s*)?شروع/],                 // i18n: a Persian header a file may carry
  days: [/^(days|duration|dur\.?)$/i, /^(تعداد\s*روز|مدت)/],                         // i18n: a Persian header a file may carry
  finish: [/^(plan(ned)?\s*)?(finish|end)(\s*date)?$/i, /^(تاریخ\s*)?پایان/],        // i18n: a Persian header a file may carry
  doneBefore: [/^done\s*before$/i, /^(میزان\s*)?انجام\s*شده\s*قبل/],                 // i18n: a Persian header a file may carry
  planned: [/^(planned|plan(ned)?\s*(qty|quantity|volume))$/i, /^(مقدار\s*)?برنامه\s*شده/],   // i18n: a Persian header a file may carry
  description: [/^(description|remark|notes?)$/i, /^(توضیحات|شرح)/],                 // i18n: a Persian header a file may carry
};

/**
 * Rows of a planning sheet (arrays, header among the first ten) → lines
 * { row, wbs, code, startOn, days, endOn, doneBefore, volumePlan, description }.
 * Numbers keep up to ten decimals; a date it cannot read is named, not guessed.
 */
export function fromPlanSheet(rows) {
  const problems = [];
  const cell = (v) => (v == null ? "" : String(v).trim());
  const hi = rows.slice(0, 10).findIndex((r) => (r || []).some((h) => PLAN_COLS.code.some((rx) => rx.test(cell(h)))));
  if (hi < 0) return { lines: [], problems: ["ستون «Activity code» (کد فعالیت) در ده ردیف اول پیدا نشد."] };
  const head = rows[hi].map(cell);
  const col = {};
  const taken = new Set();
  for (const [k, rxs] of Object.entries(PLAN_COLS)) {
    col[k] = head.findIndex((h, i) => h && !taken.has(i) && rxs.some((rx) => rx.test(h)));
    if (col[k] >= 0) taken.add(col[k]);
  }
  const get = (r, k) => (col[k] >= 0 ? r[col[k]] : null);
  const lines = [];
  rows.slice(hi + 1).forEach((r, i) => {
    r = r || [];
    const code = cell(get(r, "code"));
    if (!code) return;
    const row = hi + i + 2;
    const d = (k) => {
      const v = sheetDate(get(r, k));
      if (v === undefined) problems.push(`ردیف ${row}: «${cell(get(r, k))}» تاریخ میلادی (yyyy-mm-dd) نیست؛ خالی ماند.`);
      return v || null;
    };
    const n = (k) => {
      const v = get(r, k);
      if (blank(v)) return null;
      const x = Number(String(v).replace(/[٬,]/g, ""));
      if (!Number.isFinite(x)) { problems.push(`ردیف ${row}: «${cell(v)}» عدد نیست؛ خالی ماند.`); return null; }
      return r10(x);
    };
    lines.push({ row, wbs: cell(get(r, "wbs")) || null, code, startOn: d("start"), days: n("days"), endOn: d("finish"),
      doneBefore: n("doneBefore"), volumePlan: n("planned"), description: cell(get(r, "description")) || null });
  });
  return { lines, problems };
}
