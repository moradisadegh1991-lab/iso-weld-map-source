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

// ── the preview's sub-forms (items 13–28) ───────────────────────────────

/** The hold columns of the status sub-form (images 6 and 9), in the owner's order. */
export const HOLD_GROUPS = ["engineering", "material", "site", "others", "contractor"];
/** The requirement kinds a contract starts with (image 2); the list is the contract's to change. */
export const DEFAULT_TYPES = [["Engineering", "engineering"], ["Material", "material"], ["Site", "site"], ["Contractor", "contractor"], ["Others", "others"]];
export const COMMENT_STATUS = ["open", "in_progress", "done", "cancelled"];

const dayMs = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
const between = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 86400000);
const pctOf = (part, whole) => (part == null || whole == null || !(Number(whole) > 0) ? null : Math.round((Number(part) / Number(whole)) * 10000) / 100);

/** The share of a span [start, end] gone by the end of `day`: 0 before it, 1 after it; null without both dates. */
export function spanShare(start, end, day) {
  if (!start || !end || !day) return null;
  if (day < start) return 0;
  if (day >= end) return 1;
  return (between(start, day) + 1) / (between(start, end) + 1);
}

/**
 * The status sub-form's row for an activity in a version (images 6 and 9),
 * worked out on read — none of it is stored:
 *   original weight  the activity's whole quantity
 *   plan weight      done before + the version's planned quantity spread
 *                    evenly over its days, up to `today`
 *   remain weight    actual weight − done
 *   holds            per hold column, the weight held by the requirements
 *                    of this version not yet released (no done date)
 *   front weight     remain − all holds, never below zero
 * A figure whose inputs are missing is null (unknown), never zero.
 */
export function statusRow({ act, plan, total = null, done = 0, requirements = [], today }) {
  const share = plan ? spanShare(plan.start_on, plan.end_on, today) : null;
  const planWeight = plan && share !== null && plan.volume_plan != null ? r10(Number(plan.done_before || 0) + Number(plan.volume_plan) * share) : null;
  const actualWeight = act.volumeActual ?? null;
  const remain = actualWeight === null ? null : r10(Number(actualWeight) - Number(done || 0));
  const holds = Object.fromEntries(HOLD_GROUPS.map((g) => [g, 0]));
  for (const q of requirements) if (!q.done_date && q.hold_weight != null) holds[HOLD_GROUPS.includes(q.hold_group) ? q.hold_group : "others"] += Number(q.hold_weight);
  for (const g of HOLD_GROUPS) holds[g] = r10(holds[g]);
  const totalHold = r10(HOLD_GROUPS.reduce((s, g) => s + holds[g], 0));
  return {
    start: plan?.start_on ?? act.plan_start ?? null, end: plan?.end_on ?? act.plan_end ?? null, days: plan ? duration(plan.start_on, plan.end_on) : act.planDays ?? null,
    percent: act.wf ?? null, wv: act.wv ?? null, unit: act.unit ?? null,
    originalWeight: total, actualWeight, planWeight, planProgress: pctOf(planWeight, total),
    doneWeight: done, actualProgress: pctOf(done, actualWeight), remainWeight: remain,
    holds, totalHold, frontWeight: remain === null ? null : r10(Math.max(0, remain - totalHold)),
  };
}

/**
 * The activity-detail figures of image 1, from the activity as computed and
 * the day it is read:
 *   duration % complete   the days gone since the actual start (to its actual
 *                         finish, else today) over the planned days
 *   schedule % complete   the planned days gone by today
 *   remaining duration    planned days − days gone (0 once finished)
 *   at completion         the actual days if finished, else gone + remaining
 *   cost                  remaining = BAC × (1 − progress); at completion =
 *                         actual + remaining; cost % complete = actual ÷ at
 *                         completion; cost % of budget = actual ÷ BAC
 * Total float needs the whole network's late dates, which the platform does
 * not schedule: it is left unknown rather than guessed.
 */
export function detailFigures(a, { today }) {
  const planDays = a.planDays ?? null;
  const gone = a.actual_start ? Math.max(0, between(a.actual_start, a.actual_end || today) + 1) : 0;
  const finished = !!a.actual_end;
  const remainDays = planDays === null ? null : finished ? 0 : Math.max(0, planDays - gone);
  const bac = a.budgetPlan ?? null, actual = a.budgetActual ?? null, pct = a.pct ?? null;
  const remainingCost = bac === null || pct === null ? null : r10(bac * (1 - Math.min(100, pct) / 100));
  const atCompletionCost = remainingCost === null || actual === null ? null : r10(Number(actual) + remainingCost);
  return {
    durationPct: planDays ? Math.min(100, pctOf(gone, planDays)) : null,
    schedulePct: (() => { const s = spanShare(a.plan_start, a.plan_end, today); return s === null ? null : Math.round(s * 10000) / 100; })(),
    originalPct: finished && planDays ? pctOf(a.actualDays, planDays) : null,
    goneDays: gone, remainDays, atCompletionDays: finished ? a.actualDays ?? null : planDays === null ? null : gone + remainDays,
    constraintDays: duration(a.constraint_start, a.constraint_end),
    bac, actualCost: actual, remainingCost, atCompletionCost,
    costPct: pctOf(actual, atCompletionCost), costOfBudgetPct: pctOf(actual, bac),
    totalFloat: null,
  };
}
