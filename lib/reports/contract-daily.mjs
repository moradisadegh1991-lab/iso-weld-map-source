/**
 * The contract's daily report (owner's spec 2026-10-15, steps 5–6): what it
 * holds, how a stage changes it, and what it shows. Pure — the repository
 * (lib/db/repos/contract-reports.mjs) loads, asks and writes.
 *
 * CONTENT
 *   header      start / end time, the day's state, min / max temperature,
 *               weather, humidity
 *   narrative   category (the contract's narrative tree), title, description,
 *               unit, quantity, notes                    — the row number is its place
 *   problems    description, scope, cause, hours
 *   resources   executive work group (the contract's work-group tree),
 *               resource (the contract's resources), day, night, leave,
 *               broken down / sick, local, non-local     — totals are derived;
 *               a resource has one row per work group
 *   activities  the work done on the contract's WBS activities that day:
 *               activity, area / contractor (a company of the contract),
 *               mark, quantity, notes — entered from the progress page
 *               (/eps/progress); the activity's progress is the sum of these
 *
 * ROWS AND STAGES
 *   Every row has an id, its values as the first stage wrote them (`base`),
 *   and per later stage the values that stage gave it (`stages[seq]`). At
 *   the first stage a row's base is written directly. At a later stage the
 *   base and other stages' values are not touched: «ویرایش» writes this
 *   stage's own values for the row (one entry per stage — editing again
 *   changes it), «تأیید» records that the stage confirms the row as it is.
 *   A row a later stage adds has no base; one it drops is marked removed for
 *   that stage, never deleted. What a row counts is the values of the latest
 *   stage that gave it any (`effective`). Every save is a version of the
 *   report, so each step's change is on record; the version a stage approves
 *   holds that stage's final values.
 */

export const DAY_STATUS = { working: "کاری", holiday: "تعطیل", stopped: "توقف کار", partial: "کار ناقص" };
export const WEATHER = { clear: "صاف", cloudy: "ابری", rain: "بارانی", wind: "باد شدید", dust: "گرد و خاک", hot: "گرمای شدید", fog: "مه" };
export const SECTIONS = {
  narrative: { title: "شرح کار (Narrative)", fields: { categoryId: "text", title: "text", description: "text", unit: "text", qty: "num", notes: "text" } },
  problems: { title: "مشکلات", fields: { description: "text", scope: "text", cause: "text", hours: "num" } },
  resources: { title: "منابع", fields: { workGroupId: "text", resourceId: "text", day: "int", night: "int", leave: "int", sick: "int", local: "int", nonLocal: "int" } },
  activities: { title: "فعالیت‌های انجام‌شده", fields: { activityId: "text", areaId: "text", mark: "text", qty: "num", notes: "text" } },
};
export const HEADER_FIELDS = { startTime: "time", endTime: "time", dayStatus: "text", tempMin: "num", tempMax: "num", weather: "text", humidity: "num" };

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const rid = () => `r${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

function cleanValues(kind, v = {}, where, problems) {
  const fields = kind === "header" ? HEADER_FIELDS : SECTIONS[kind].fields;
  const out = {};
  for (const [k, t] of Object.entries(fields)) {
    const raw = v[k];
    if (isBlank(raw)) { out[k] = null; continue; }
    if (t === "text") out[k] = String(raw).replace(/\s+/g, " ").trim();
    else if (t === "time") {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw))) problems.push(`${where}: ساعت «${raw}» باید به شکل ۲۴ساعته HH:MM باشد.`);
      out[k] = String(raw);
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 && k !== "tempMin" && k !== "tempMax") problems.push(`${where}: «${raw}» عدد نامنفی نیست.`);
      else if (t === "int" && !Number.isInteger(n)) problems.push(`${where}: «${raw}» باید عدد صحیح باشد.`);
      out[k] = n;
    }
  }
  if (v.removed === true) out.removed = true;
  return out;
}

/** Normalise what a form sent; list what is wrong. Row ids are kept, or given. */
export function checkContent(input = {}, { resourceIds = null, narrativeIds = null, workGroupIds = null, activityIds = null, areaIds = null } = {}) {
  const problems = [];
  const stagesOf = (st, kind, where) => Object.fromEntries(Object.entries(st || {}).filter(([s]) => /^\d+$/.test(s))
    .map(([s, v]) => [s, { ...cleanValues(kind, v, `${where} (مرحلهٔ ${s})`, problems), ...(v?.confirmed ? { confirmed: true } : {}) }]));
  const header = { base: cleanValues("header", input.header?.base || {}, "سربرگ", problems), stages: stagesOf(input.header?.stages, "header", "سربرگ") };
  const content = { schema: 2, header };
  for (const kind of Object.keys(SECTIONS)) {
    const seen = new Set();
    content[kind] = (input[kind] || []).map((r, i) => {
      const where = `${SECTIONS[kind].title} ردیف ${i + 1}`;
      let id = String(r.id || "").trim() || rid();
      if (seen.has(id)) id = rid();
      seen.add(id);
      const row = { id, base: r.base ? cleanValues(kind, r.base, where, problems) : null, stages: stagesOf(r.stages, kind, where) };
      if (r.addedAt) row.addedAt = Number(r.addedAt);
      return row;
    });
  }
  const h = effective(header);
  if (h.tempMin != null && h.tempMax != null && h.tempMin > h.tempMax) problems.push("حداقل دما از حداکثر بیشتر است.");
  if (h.humidity != null && h.humidity > 100) problems.push("رطوبت درصدی میان ۰ و ۱۰۰ است.");
  if (h.dayStatus && !DAY_STATUS[h.dayStatus]) problems.push("وضعیت روز نامعتبر است.");
  if (h.weather && !WEATHER[h.weather]) problems.push("وضعیت آب‌وهوا نامعتبر است.");
  const pairs = new Set();
  for (const r of content.resources) {
    const e = effective(r);
    if (e.removed) continue;
    if (!e.resourceId) problems.push("منبع هر ردیف منابع را از منابع قرارداد انتخاب کنید.");
    else if (resourceIds && !resourceIds.has(e.resourceId)) problems.push("منبعی در گزارش هست که از منابع این قرارداد نیست.");
    if (e.workGroupId && workGroupIds && !workGroupIds.has(e.workGroupId)) problems.push("گروه اجرایی از درخت گروه‌های اجرایی این قرارداد نیست.");
    const pair = `${e.resourceId}|${e.workGroupId || ""}`;
    if (e.resourceId && pairs.has(pair)) problems.push("برای هر منبع در هر گروه اجرایی یک ردیف کافی است؛ ردیف موجود را ویرایش کنید.");
    pairs.add(pair);
    const t = total(e);
    if (e.local != null && e.nonLocal != null && e.local + e.nonLocal !== t) problems.push(`بومی + غیربومی (${e.local + e.nonLocal}) با کل نفرات (${t}) برابر نیست.`);
  }
  for (const r of content.narrative) {
    const e = effective(r);
    if (e.removed) continue;
    if (!e.title && !e.description) problems.push("هر ردیف شرح کار عنوان یا شرح لازم دارد.");
    if (e.qty != null && !e.unit) problems.push(`مقدار «${e.title || e.description}» واحد لازم دارد.`);
    if (e.categoryId && narrativeIds && !narrativeIds.has(e.categoryId)) problems.push("دستهٔ شرح کار از درخت این قرارداد نیست.");
  }
  for (const r of content.activities) {
    const e = effective(r);
    if (e.removed) continue;
    if (!e.activityId) problems.push("فعالیت هر ردیف کار انجام‌شده لازم است.");
    else if (activityIds && !activityIds.has(e.activityId)) problems.push("فعالیتی در گزارش هست که از WBS این قرارداد نیست.");
    if (e.areaId && areaIds && !areaIds.has(e.areaId)) problems.push("ناحیه / پیمانکار از شرکت‌های این قرارداد نیست.");
    if (e.qty == null || !(e.qty > 0)) problems.push("مقدار انجام‌شدهٔ هر فعالیت عددی بزرگ‌تر از صفر است.");
  }
  for (const r of content.problems) {
    const e = effective(r);
    if (e.removed) continue;
    if (!e.description) problems.push("شرح هر مشکل لازم است.");
    if (e.hours != null && e.hours > 24) problems.push("ساعت مشکل در یک روز بیش از ۲۴ نیست.");
  }
  return { content, problems };
}

/** A row's values now: the latest stage that gave it any, over its base. */
export function effective(row) {
  let v = row.base ? { ...row.base } : {};
  const seqs = Object.keys(row.stages || {}).map(Number).sort((a, b) => a - b);
  for (const s of seqs) {
    const sv = row.stages[s];
    const vals = Object.fromEntries(Object.entries(sv).filter(([k]) => k !== "confirmed"));
    if (Object.keys(vals).some((k) => vals[k] !== null && vals[k] !== undefined) || vals.removed) v = { ...v, ...stripNull(vals) };
  }
  return v;
}
const stripNull = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== null && x !== undefined));

/** People on a resource row: day + night + leave + broken down / sick. */
export function total(e) {
  return ["day", "night", "leave", "sick"].reduce((s, k) => s + (Number(e[k]) || 0), 0);
}

// key order does not count: content read back from jsonb comes with its keys reordered
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}` : JSON.stringify(v ?? null));
const same = (a, b) => canon(a ?? null) === canon(b ?? null);
const valuesOnly = (o) => (o ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== "confirmed")) : o);

/**
 * What a new version does at `stageSeq`, against the previous one: rows
 * added, changed, removed — and what it may not do. At the first stage the
 * base is written; later, only the stage's own values.
 */
export function diffContent(prev, next, { stageSeq, firstSeq }) {
  const illegal = [];
  let added = 0, changed = 0, removed = 0;
  const later = stageSeq !== firstSeq;
  const S = String(stageSeq);
  const checkRow = (kind, a, b, label) => {
    if (later) {
      if (!same(a.base, b.base)) illegal.push(`${label}: مقدار ثبت‌شدهٔ مرحلهٔ اول در مرحله‌های بعد تغییر نمی‌کند؛ مقدار این مرحله را در ردیف همین مرحله بنویسید.`);
      for (const s of new Set([...Object.keys(a.stages || {}), ...Object.keys(b.stages || {})])) {
        if (s !== S && !same(a.stages?.[s], b.stages?.[s])) illegal.push(`${label}: مقدار مرحلهٔ دیگری تغییر نمی‌کند.`);
      }
    } else if (Object.keys(b.stages || {}).some((s) => !same(a.stages?.[s], b.stages?.[s]))) {
      illegal.push(`${label}: در مرحلهٔ اول ردیف مرحله‌های بعد نوشته نمی‌شود.`);
    }
    const before = later ? a.stages?.[S] : a.base, after = later ? b.stages?.[S] : b.base;
    if (!same(valuesOnly(before), valuesOnly(after))) {
      if (after?.removed && !before?.removed) removed++;
      else changed++;
    } else if (!same(before, after)) changed++;          // a confirmation is a change of the content too
  };
  const h = { base: prev.header?.base, stages: prev.header?.stages || {} };
  checkRow("header", h, next.header, "سربرگ");
  for (const kind of Object.keys(SECTIONS)) {
    const old = new Map((prev[kind] || []).map((r) => [r.id, r]));
    const now = new Map((next[kind] || []).map((r) => [r.id, r]));
    for (const [id, r] of now) {
      if (!old.has(id)) {
        added++;
        if (later && (r.base || r.addedAt !== stageSeq || Object.keys(r.stages || {}).some((s) => s !== S))) {
          illegal.push(`${SECTIONS[kind].title}: ردیفی که مرحلهٔ ${stageSeq} اضافه می‌کند فقط مقدار همین مرحله را دارد.`);
        }
        if (!later && Object.keys(r.stages || {}).length) illegal.push(`${SECTIONS[kind].title}: ردیف تازه در مرحلهٔ اول مقدار مرحله‌های بعد ندارد.`);
      } else checkRow(kind, old.get(id), r, SECTIONS[kind].title);
    }
    for (const id of old.keys()) {
      if (now.has(id)) continue;
      removed++;
      const r = old.get(id);
      if (later && !(r.addedAt === stageSeq && !Object.keys(r.stages || {}).some((s) => s !== S))) {
        illegal.push(`${SECTIONS[kind].title}: در مرحله‌های بعد ردیف پاک نمی‌شود؛ «حذف» آن را برای این مرحله حذف‌شده علامت می‌زند.`);
      }
    }
  }
  return { added, changed, removed, illegal };
}

/**
 * How a row is shown (6.3.3 / 6.4): the row as the first stage wrote it, then
 * one line per later stage whose values differ from it — latest stage first,
 * each in its stage's colour.
 */
export function displayLines(row, stages) {
  const name = new Map(stages.map((s) => [String(s.seq), s]));
  const base = row.base;
  const lines = [];
  const seqs = Object.keys(row.stages || {}).map(Number).sort((a, b) => b - a);
  for (const s of seqs) {
    const vals = valuesOnly(row.stages[s]);
    const differs = !base || vals.removed || Object.entries(stripNull(vals)).some(([k, v]) => !same(base[k], v));
    const st = name.get(String(s));
    if (differs) lines.push({ seq: s, stage: st?.name || `مرحلهٔ ${s}`, color: st?.changeColor || null, values: { ...(base || {}), ...stripNull(vals) },
      removed: !!vals.removed });
  }
  const confirmedBy = [...seqs].reverse().filter((s) => row.stages[s]?.confirmed).map((s) => name.get(String(s))?.name || `مرحلهٔ ${s}`);
  return { base, lines, confirmedBy, effective: effective(row) };
}

/** The resource rows summed: people by shift and in all, and every resource's total by unit. */
export function resourceSummary(rows, resources) {
  const byId = new Map(resources.map((r) => [r.id, r]));
  const out = { day: 0, night: 0, leave: 0, sick: 0, total: 0, local: 0, nonLocal: 0, byUnit: {}, rows: 0 };
  for (const row of rows) {
    const e = "base" in row || "stages" in row ? effective(row) : row;      // a stored row, or values already resolved
    if (e.removed) continue;
    const res = byId.get(e.resourceId);
    const t = total(e);
    out.rows++;
    if (!res || res.kind === "person") {
      for (const k of ["day", "night", "leave", "sick", "local", "nonLocal"]) out[k] += Number(e[k]) || 0;
      out.total += t;
    }
    const unit = res?.unit || "—";
    out.byUnit[unit] = (out.byUnit[unit] || 0) + t;
  }
  return out;
}

/**
 * The resource section's upper part (owner's review 2026-10-15, item 8):
 * every resource of the contract in its resource tree, in display order, with
 * the report's rows for it summed — day, night, leave, broken down / sick,
 * their total, local and non-local — and under it the sums per unit (people
 * and machines are never added together).
 *   rows      the report's resource rows (stored, or values already resolved)
 *   tree      the contract's resource tree with its resources (resourceTree)
 *   loose     resources in no branch
 * Returns { items: [{type:'branch'|'resource', depth, …}], byUnit: {unit: sums} }.
 */
export const SUM_FIELDS = ["day", "night", "leave", "sick", "total", "local", "nonLocal"];
export function resourceBoard(rows, tree = [], loose = []) {
  const zero = () => Object.fromEntries([...SUM_FIELDS, "rows"].map((k) => [k, 0]));
  const sums = new Map();
  for (const row of rows) {
    const e = "base" in row || "stages" in row ? effective(row) : row;
    if (e.removed || !e.resourceId) continue;
    const s = sums.get(e.resourceId) || zero();
    for (const k of ["day", "night", "leave", "sick", "local", "nonLocal"]) s[k] += Number(e[k]) || 0;
    s.total += total(e);
    s.rows++;
    sums.set(e.resourceId, s);
  }
  const items = [];
  const byUnit = {};
  const put = (r, depth, category) => {
    const s = sums.get(r.id) || zero();
    items.push({ type: "resource", id: r.id, name: r.name, kind: r.kind, unit: r.unit || "—", seq: r.seq, category, depth, ...s });
    const u = byUnit[r.unit || "—"] || (byUnit[r.unit || "—"] = zero());
    for (const k of [...SUM_FIELDS, "rows"]) u[k] += s[k];
  };
  const walk = (nodes, depth, path) => nodes.forEach((n) => {
    const here = [...path, n.name];
    items.push({ type: "branch", id: n.id, name: n.name, path: here.join(" / "), depth });
    for (const r of n.resources || []) put(r, depth + 1, here.join(" / "));
    walk(n.children || [], depth + 1, here);
  });
  walk(tree, 0, []);
  if (loose.length) {
    items.push({ type: "branch", id: null, name: "بدون دسته", path: "بدون دسته", depth: 0 });
    for (const r of loose) put(r, 1, "بدون دسته");
  }
  return { items, byUnit };
}

/** A new report's content copied from an earlier one: its rows as they stand now, as new first-stage rows. */
export function copyFrom(content) {
  const fresh = (kind) => (content[kind] || []).map((r) => effective(r)).filter((e) => !e.removed)
    .map((e) => ({ id: rid(), base: stripNull(e), stages: {} }));
  const h = effective(content.header || { base: {} });
  return { schema: 2, header: { base: { startTime: h.startTime ?? null, endTime: h.endTime ?? null, dayStatus: h.dayStatus ?? null,
    tempMin: null, tempMax: null, weather: null, humidity: null }, stages: {} },
    narrative: fresh("narrative"), problems: [], resources: fresh("resources"), activities: [] };
}

export const EMPTY = { schema: 2, header: { base: {}, stages: {} }, narrative: [], problems: [], resources: [], activities: [] };

/**
 * A report's work-done lines as they stand (each row's latest stage values),
 * removed ones left out: [{rowId, activityId, areaId, mark, qty, notes}].
 */
export function activityLines(content) {
  return (content?.activities || []).map((r) => ({ rowId: r.id, addedAt: r.addedAt ?? null, ...effective(r) }))
    .filter((e) => !e.removed && e.activityId).map(({ removed, ...e }) => e);
}
