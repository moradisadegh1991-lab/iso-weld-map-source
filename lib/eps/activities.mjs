/**
 * The activity view (owner's «PMS» document, 2026-10-16): what the P6-like
 * page and the daily progress entry work out from what is stored. Pure — the
 * repository (lib/db/repos/eps-activities.mjs) loads and writes.
 *
 *   done        the quantity the contract's daily reports record for an
 *               activity (lib/reports/contract-daily.mjs «activities»),
 *               at each report's latest version, cancelled reports left out
 *   progress    done ÷ the activity's actual volume. No volume → unknown,
 *               never a guess
 *   work front  the activity's days from planned start to finish: the plan
 *               spread evenly over them, what was done each day, both
 *               cumulative, and the cost of what was done
 *   relations   predecessor → successor, FS / SS / FF / SF with a lag; a
 *               relation that closes a loop is refused
 *   free float  the days an activity can slip before it moves a successor,
 *               from the planned dates
 *   delay       against the master plan's activity of the same code: start
 *               and finish delay, and the delay accepted in the claim
 */

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const ms = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
const addDays = (d, n) => new Date(ms(d) + n * 86400000).toISOString().slice(0, 10);
/** Calendar days from a to b (b − a); null when either is missing. */
export const diffDays = (a, b) => (a && b ? Math.round((ms(b) - ms(a)) / 86400000) : null);

export const REL_TYPES = { FS: "پایان به شروع (FS)", SS: "شروع به شروع (SS)", FF: "پایان به پایان (FF)", SF: "شروع به پایان (SF)" };
export const BUDGET_UNITS = { hour: "ساعت", day: "روز", unit: "واحد (مقطوع)" };
export const ROLE_STATUS = { planned: "برنامه‌ای", active: "در کار", done: "تمام‌شده" };
export const QTY_MODES = { number: "مقدار انجام‌شده (عدد)", remain: "باقیماندهٔ کار", percent: "درصدی از حجم فعالیت" };

/** Would pred → succ close a loop? True when succ already leads to pred. */
export function closesLoop(relations, predId, succId) {
  if (predId === succId) return true;
  const next = new Map();
  for (const r of relations) (next.get(r.pred_id) || next.set(r.pred_id, []).get(r.pred_id)).push(r.succ_id);
  const seen = new Set();
  const stack = [succId];
  while (stack.length) {
    const x = stack.pop();
    if (x === predId) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    stack.push(...(next.get(x) || []));
  }
  return false;
}

/**
 * Free float from the planned dates: for each successor, the room the
 * relation leaves (FS: succ start − lag − own finish − 1; SS: succ start −
 * lag − own start; FF: succ finish − lag − own finish; SF: succ finish − lag −
 * own start), the least of them. Null with no successor or a missing date.
 */
export function freeFloat(act, succs = []) {
  let best = null;
  for (const { rel_type: t, lag = 0, succ } of succs) {
    const own = t === "SS" || t === "SF" ? act.plan_start : act.plan_end;
    const theirs = t === "FS" || t === "SS" ? succ.plan_start : succ.plan_end;
    if (!own || !theirs) return null;
    const room = diffDays(own, theirs) - Number(lag || 0) - (t === "FS" ? 1 : 0);
    best = best === null ? room : Math.min(best, room);
  }
  return best;
}

/** Done, what remains and the progress of an activity against its actual volume (unknown without one). */
export function progressOf(act, done = 0) {
  const vol = act.volumeActual;
  const d = r4(Number(done) || 0);
  if (vol === null || vol === undefined) return { done: d, remain: null, pct: null };
  return { done: d, remain: r4(vol - d), pct: vol > 0 ? r2((d / vol) * 100) : null };
}

/**
 * The quantity a progress line records: a number as typed, the remaining
 * work, or a percentage of the activity's volume. Refused when the volume it
 * needs is unknown, when nothing would be recorded, or when the activity
 * would be done past its volume.
 */
export function qtyFrom(mode, value, { volume = null, done = 0, code = "" } = {}) {
  const v = value === null || value === undefined || String(value).trim() === "" ? null : Number(value);
  let qty;
  if (mode === "number") {
    if (v === null || !Number.isFinite(v) || v <= 0) return { problem: `${code}: مقدار انجام‌شده عددی بزرگ‌تر از صفر است.` };
    qty = v;
  } else if (mode === "percent") {
    if (volume === null || volume === undefined) return { problem: `${code}: حجم واقعی فعالیت ثبت نشده؛ درصد آن معلوم نیست.` };
    if (v === null || !Number.isFinite(v) || v <= 0 || v > 100) return { problem: `${code}: درصد میان ۰ و ۱۰۰ است.` };
    qty = (Number(volume) * v) / 100;
  } else if (mode === "remain") {
    if (volume === null || volume === undefined) return { problem: `${code}: حجم واقعی فعالیت ثبت نشده؛ باقیمانده معلوم نیست.` };
    qty = Number(volume) - Number(done || 0);
    if (qty <= 0) return { problem: `${code}: کاری باقی نمانده است.` };
  } else return { problem: "روش ورود مقدار نامعتبر است." };
  qty = r4(qty);
  if (volume !== null && volume !== undefined && Number(done || 0) + qty > Number(volume) + 1e-6) {
    return { problem: `${code}: با ${qty} انجام‌شده به ${r4(Number(done || 0) + qty)} می‌رسد؛ بیش از حجم فعالیت (${volume}) نمی‌شود.` };
  }
  return { qty };
}

/**
 * The work front: one row per day from planned start to finish (and any day
 * outside it that has work), with the plan spread evenly, the work done that
 * day and both cumulative, as quantity, percentage of the volume and cost.
 * `doneByDate` maps YYYY-MM-DD → quantity. At most `limit` days.
 */
export function workFront(act, doneByDate = {}, { limit = 1500 } = {}) {
  const vol = act.volumeActual ?? act.volumePlan ?? null;
  const planVol = act.volumePlan ?? act.volumeActual ?? null;
  const budget = act.budgetPlan ?? null;
  const days = new Set(Object.keys(doneByDate));
  const n = act.plan_start && act.plan_end ? diffDays(act.plan_start, act.plan_end) + 1 : 0;
  for (let i = 0; i < Math.min(n, limit); i++) days.add(addDays(act.plan_start, i));
  const perDay = n > 0 && planVol != null ? planVol / n : null;
  let planCum = 0, doneCum = 0;
  const rows = [...days].sort().slice(0, limit).map((date) => {
    const inPlan = n > 0 && date >= act.plan_start && date <= act.plan_end;
    const plan = inPlan && perDay != null ? perDay : 0;
    planCum += plan;
    const done = Number(doneByDate[date] || 0);
    doneCum += done;
    const pct = (q) => (vol ? r2((q / vol) * 100) : null);
    const cost = (q) => (vol && budget != null ? r2((q / vol) * budget) : null);
    return { date, inPlan, plan: r4(plan), planCum: r4(planCum), planPct: pct(planCum), done: r4(done), doneCum: r4(doneCum),
      donePct: pct(done), doneCumPct: pct(doneCum), cost: cost(done), costCum: cost(doneCum) };
  });
  return { rows, perDay: perDay == null ? null : r4(perDay), days: n };
}

/**
 * The planned cumulative % of a WBS node on a day — the master plan's own
 * curve, so a control account on the node needs no baseline typed beside it.
 * Each activity's plan is spread evenly over its planned days (as the work
 * front spreads it) and rolled up by W.F the way progress is: a node with
 * activities from them, otherwise from its children. Nothing under it with
 * planned dates → null, never zero.
 */
export function plannedPctAt(node, date) {
  const at = (a) => {
    if (!a.plan_start || !a.plan_end) return null;
    const n = diffDays(a.plan_start, a.plan_end) + 1;
    if (!(n > 0)) return null;
    return Math.max(0, Math.min(1, (diffDays(a.plan_start, date) + 1) / n)) * 100;
  };
  let sum = 0, any = false;
  const parts = node.activities?.length ? node.activities.map((a) => [a.wf, at(a)]) : (node.children || []).map((c) => [c.wf, plannedPctAt(c, date)]);
  for (const [wf, p] of parts) if (p != null) { any = true; sum += ((Number(wf) || 0) / 100) * p; }
  return any ? r2(sum) : null;
}

/** The node's planned curve: the % at every day it changes slope (a plan's eve and its last day), from 0 to the end. */
export function plannedCurve(node) {
  const days = new Set();
  const walk = (n) => {
    for (const a of n.activities || []) if (a.plan_start && a.plan_end) { days.add(addDays(a.plan_start, -1)); days.add(String(a.plan_end).slice(0, 10)); }
    if (!n.activities?.length) (n.children || []).forEach(walk);
  };
  walk(node);
  return [...days].sort().map((date) => ({ date, pct: plannedPctAt(node, date) })).filter((p) => p.pct != null);
}

/** A role's cost on an activity: time over the activity's planned days (or a lump quantity), × rate; the actual time × rate. */
export function roleCost(role, act) {
  const perDay = role.per_day == null ? null : Number(role.per_day);
  const rate = role.rate == null ? null : Number(role.rate);
  const total = perDay == null ? null : role.budget_unit === "unit" ? perDay : act.planDays ? r4(perDay * act.planDays) : null;
  const actual = role.actual_time == null ? null : Number(role.actual_time);
  return { totalTime: total, totalPrice: total != null && rate != null ? r2(total * rate) : null,
    actualTime: actual, actualPrice: actual != null && rate != null ? r2(actual * rate) : null };
}

/**
 * A line of the delay claim against the baseline (the master plan's activity
 * of the same code): start delay, finish delay, the delay the claim accepts.
 * Every figure the dates do not give is null — never assumed.
 */
export function delayRow(d, act, baseline) {
  const bS = baseline?.plan_start || null, bF = baseline?.plan_end || null;
  const startDelay = diffDays(bS, act.actual_start);
  const finishDelay = diffDays(bF, act.actual_end);
  return {
    ...d, baselineStart: bS, baselineFinish: bF, baselineDays: baseline?.planDays ?? null,
    actualStart: act.actual_start || null, actualFinish: act.actual_end || null, actualDays: act.actualDays ?? null,
    startDelay, finishDelay, delay: finishDelay ?? startDelay,
    acceptStart: d.accept_start || null, acceptFinish: d.accept_finish || null,
    acceptDelay: diffDays(bF, d.accept_finish) ?? diffDays(bS, d.accept_start),
  };
}

/**
 * A filter over a tree as typed: the rows whose text holds the query, every
 * row above one of them (so a match is never shown out of its place), and
 * every row under one (a matched branch shows whole — owner's requirements
 * 2026-10-18, item 10). `rows`: [{id, parentId, text}]. Returns
 * { visible, matches } as Sets, or null when there is nothing to filter by.
 */
export function filterTree(rows, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  const parent = new Map(rows.map((r) => [r.id, r.parentId || null]));
  const kids = new Map();
  for (const r of rows) if (r.parentId) (kids.get(r.parentId) || kids.set(r.parentId, []).get(r.parentId)).push(r.id);
  const matches = new Set(rows.filter((r) => String(r.text || "").toLowerCase().includes(q)).map((r) => r.id));
  const visible = new Set();
  for (const id of matches) for (let x = id; x && !visible.has(x); x = parent.get(x)) visible.add(x);
  const down = [...matches];
  while (down.length) for (const c of kids.get(down.pop()) || []) if (!visible.has(c)) { visible.add(c); down.push(c); }
  return { visible, matches };
}

/** Text split around every occurrence of the query, for highlighting: [{text, hit}]. */
export function splitHits(text, query) {
  const s = String(text ?? "");
  const q = String(query || "").trim();
  if (!q) return [{ text: s, hit: false }];
  const out = [];
  const low = s.toLowerCase(), lq = q.toLowerCase();
  let i = 0;
  for (let j = low.indexOf(lq); j >= 0; j = low.indexOf(lq, i)) {
    if (j > i) out.push({ text: s.slice(i, j), hit: false });
    out.push({ text: s.slice(j, j + q.length), hit: true });
    i = j + q.length;
  }
  if (i < s.length) out.push({ text: s.slice(i), hit: false });
  return out;
}

/**
 * The activity-code summary for a set of activities: per code, the planned,
 * actual and done volume of the activities that carry it and the progress;
 * and per area / contractor what was done. `activities` carry codeIds,
 * volumePlan, volumeActual; `lines` are progress lines {activityId, qty, areaId}.
 */
export function codeSummary(codes, activities, lines) {
  const doneBy = new Map();
  for (const l of lines) doneBy.set(l.activityId, (doneBy.get(l.activityId) || 0) + Number(l.qty || 0));
  return codes.map((c) => {
    const acts = activities.filter((a) => (a.codeIds || []).includes(c.id));
    const ids = new Set(acts.map((a) => a.id));
    const sum = (f) => (acts.some((a) => a[f] != null) ? r4(acts.reduce((s, a) => s + (Number(a[f]) || 0), 0)) : null);
    const plan = sum("volumePlan"), actual = sum("volumeActual");
    const done = r4(acts.reduce((s, a) => s + (doneBy.get(a.id) || 0), 0));
    const byArea = {};
    for (const l of lines) if (ids.has(l.activityId)) byArea[l.areaId || ""] = r4((byArea[l.areaId || ""] || 0) + Number(l.qty || 0));
    return { ...c, activities: acts.length, plan, actual, done, remain: actual == null ? null : r4(actual - done),
      pct: actual ? r2((done / actual) * 100) : null, byArea };
  });
}

/** The quantity per activity per day for the chosen days, and each activity's total over them. */
export function daysMatrix(lines, days) {
  const want = new Set(days);
  const out = new Map();
  for (const l of lines) {
    if (!want.has(l.date)) continue;
    const m = out.get(l.activityId) || { byDay: {}, total: 0 };
    m.byDay[l.date] = r4((m.byDay[l.date] || 0) + Number(l.qty || 0));
    m.total = r4(m.total + Number(l.qty || 0));
    out.set(l.activityId, m);
  }
  return out;
}

/**
 * The multi-day view's columns (owner's requirements 2026-10-18, item 6),
 * for the chosen days `days` (sorted YYYY-MM-DD) and the work-done lines
 * {activityId, date, qty}:
 *
 *   T  to date      up to the last chosen day
 *   C  current      the chosen days themselves
 *   L  last         to date less current: everything before, and any day
 *                   between the chosen ones that was not chosen
 *   W  quantity, P  % of the activity's volume; …P planned, …A actual
 *
 *   L.W.P L.W.A T.W.P T.W.A L.P.P% L.P.A% T.P.P% T.P.A%
 *   T.SPI%  T.P.A ÷ T.P.P (actual ÷ planned, as the owner chose: above 100 is ahead)
 *   VAR%    T.P.P − T.P.A (planned to date less done to date, as the owner wrote it)
 *   C.P.P% C.P.A% C.W.P C.W.A, C.SPI% = C.P.A ÷ C.P.P
 *   byDay   {day: {p, ac}}: what the plan puts on the day and what was done on it
 *
 * The plan is spread evenly over an activity's planned days (as the work
 * front spreads it). A WBS node has the percentages only, rolled up by W.F
 * the way progress is; quantities in different units are not added. What a
 * figure needs and does not have — dates, a volume, a plan above zero — is
 * null, never zero — and so is the actual of an activity whose done comes
 * from the platform's records rather than from dated daily reports.
 */
export function periodColumns(roots, lines, days) {
  const out = new Map();
  const chosen = [...new Set(days)].sort();
  if (!chosen.length) return out;
  const last = chosen[chosen.length - 1];
  const done = new Map();
  for (const l of lines) (done.get(l.activityId) || done.set(l.activityId, []).get(l.activityId)).push(l);
  const pct = (q, vol) => (q == null || !vol ? null : r2((q / vol) * 100));
  const ratio = (a, p) => (a == null || p == null || !(p > 0) ? null : r2((a / p) * 100));
  const act = (a) => {
    const vol = a.volumeActual ?? a.volumePlan ?? null;
    const planVol = a.volumePlan ?? a.volumeActual ?? null;
    const n = a.plan_start && a.plan_end ? diffDays(a.plan_start, a.plan_end) + 1 : 0;
    const planTo = (d) => (n > 0 && planVol != null ? planVol * Math.max(0, Math.min(1, (diffDays(a.plan_start, d) + 1) / n)) : null);
    const planOn = (d) => (planTo(d) == null ? null : planTo(d) - planTo(addDays(d, -1)));
    const mine = done.get(a.id) || [];
    const doneOn = (d) => mine.filter((l) => l.date === d).reduce((s, l) => s + Number(l.qty || 0), 0);
    // an activity whose done comes from the platform's records (075), not the daily reports, has no day for its work: unknown here
    const dated = !a.scope;
    const TWP = planTo(last), TWA = dated ? mine.filter((l) => l.date <= last).reduce((s, l) => s + Number(l.qty || 0), 0) : null;
    const CWP = TWP == null ? null : chosen.reduce((s, d) => s + planOn(d), 0);
    const CWA = dated ? chosen.reduce((s, d) => s + doneOn(d), 0) : null;
    const LWP = TWP == null ? null : TWP - CWP, LWA = dated ? TWA - CWA : null;
    const row = { LWP, LWA, TWP, TWA, CWP, CWA };
    for (const k of Object.keys(row)) if (row[k] != null) row[k] = r4(row[k]);
    const P = { LPP: pct(LWP, vol), LPA: pct(LWA, vol), TPP: pct(TWP, vol), TPA: pct(TWA, vol), CPP: pct(CWP, vol), CPA: pct(CWA, vol) };
    return { ...row, ...P, TSPI: ratio(P.TPA, P.TPP), VAR: P.TPP == null || P.TPA == null ? null : r2(P.TPP - P.TPA), CSPI: ratio(P.CPA, P.CPP),
      byDay: Object.fromEntries(chosen.map((d) => [d, { p: planOn(d) == null ? null : r4(planOn(d)), ac: dated ? r4(doneOn(d)) : null }])) };
  };
  const PCTS = ["LPP", "LPA", "TPP", "TPA", "CPP", "CPA"];
  const node = (n) => {
    const parts = n.activities?.length ? n.activities.map((a) => { const x = act(a); out.set(a.id, x); return [a.wf, x]; })
      : [];
    const kids = (n.children || []).map((c) => [c.wf, node(c)]);
    const from = n.activities?.length ? parts : kids;
    const row = {};
    for (const k of PCTS) {
      let sum = 0, any = false;
      for (const [wf, x] of from) if (x[k] != null) { any = true; sum += ((Number(wf) || 0) / 100) * x[k]; }
      row[k] = any ? r2(sum) : null;
    }
    const r = { ...row, TSPI: ratio(row.TPA, row.TPP), VAR: row.TPP == null || row.TPA == null ? null : r2(row.TPP - row.TPA), CSPI: ratio(row.CPA, row.CPP), node: true };
    out.set(n.id, r);
    return r;
  };
  roots.forEach(node);
  return out;
}
