/**
 * EPS → PMS → version → WBS → activities (owner's request 2026-10-16). Pure:
 * the repository (lib/db/repos/eps.mjs) loads rows, asks, and writes only
 * what a person typed — every derived figure is worked out here, on read, so
 * a parent's budget or a node's volume changed once reaches everything under
 * it without anything stored going stale.
 *
 * A WBS belongs to one version of a PMS; its root is the PMS code.
 *
 *   W.F   a node's weight as a percentage of its parent (activities: of
 *         their WBS node). The children of a node never weigh more than
 *         100% together.
 *   W.V   weighted value: the node's W.F × its parent's W.V, the root = 100%.
 *
 * Budget, as the version's settings say (one of three, manual by default):
 *   manual        budget and W.F both typed
 *   wf_to_budget  W.F typed; planned budget = W.F × the parent's planned budget
 *   budget_to_wf  budget typed; W.F = budget ÷ the parent's planned budget
 *
 * Codes: the PMS code, then per level an optional prefix and a zero-padded
 * number, joined by the separator (default «.»): PM01 → PM01.C.01 →
 * PM01.C.01.02. A code is suggested when a node is made and the person may
 * change it.
 */

export const BUDGET_MODES = {
  manual: "محاسبهٔ دستی",
  wf_to_budget: "بودجه از درصد وزنی (W.F × بودجهٔ والد)",
  budget_to_wf: "درصد وزنی از بودجه (بودجه ÷ بودجهٔ والد)",
};
export const SEPARATORS = { ".": "نقطه (.)", "-": "خط تیره (-)", "/": "اسلش (/)", "_": "زیرخط (_)" };
/** Each separator's name, for its label key (`eps.separator.<name>`, lib/i18n/labels.mjs). */
export const SEPARATOR_NAMES = { ".": "dot", "-": "dash", "/": "slash", "_": "underscore" };
const LEVEL_COLORS = ["#1f6f8b", "#2e86c1", "#16a085", "#b9770e", "#7d3c98", "#c0392b", "#566573"];

export const DEFAULT_SETTINGS = {
  separator: ".",
  budgetMode: "manual",
  levels: [{ prefix: "C", digits: 2 }, { prefix: "", digits: 2 }, { prefix: "", digits: 2 }],
};

const r4 = (v) => Math.round(v * 10000) / 10000;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Settings as typed: a known separator and mode, a colour, prefix and width per level. */
export function checkSettings(input = {}) {
  const problems = [];
  const separator = SEPARATORS[input.separator] ? input.separator : ".";
  if (input.separator && !SEPARATORS[input.separator]) problems.push(`جداکنندهٔ «${input.separator}» پذیرفته نیست.`);
  const budgetMode = BUDGET_MODES[input.budgetMode] ? input.budgetMode : "manual";
  if (input.budgetMode && !BUDGET_MODES[input.budgetMode]) problems.push("روش محاسبهٔ بودجه نامعتبر است.");
  const list = Array.isArray(input.levels) && input.levels.length ? input.levels : DEFAULT_SETTINGS.levels;
  const levels = list.slice(0, 12).map((l, i) => {
    const prefix = String(l?.prefix ?? "").trim();
    if (prefix && !/^[A-Za-z0-9]{1,6}$/.test(prefix)) problems.push(`سطح ${i + 1}: پیشوند «${prefix}» فقط حرف و رقم لاتین (حداکثر ۶).`);
    const digits = Number(l?.digits ?? 2);
    if (!Number.isInteger(digits) || digits < 1 || digits > 6) problems.push(`سطح ${i + 1}: تعداد رقم بین ۱ و ۶ است.`);
    const color = /^#[0-9a-fA-F]{6}$/.test(String(l?.color || "")) ? l.color : LEVEL_COLORS[i % LEVEL_COLORS.length];
    return { prefix, digits: Number.isInteger(digits) ? Math.min(Math.max(digits, 1), 6) : 2, color };
  });
  return { settings: { separator, budgetMode, levels }, problems };
}

/** The level rule for depth `level` (1 = under the root); deeper than the settings go, the last one repeats without its prefix. */
export function levelRule(settings, level) {
  const ls = settings.levels;
  return level <= ls.length ? ls[level - 1] : { ...ls[ls.length - 1], prefix: "" };
}

/** The code a new node gets: its parent's code, the level's prefix, its number. */
export function suggestCode(parentCode, level, number, settings) {
  const rule = levelRule(settings, level);
  const parts = [parentCode];
  if (rule.prefix) parts.push(rule.prefix);
  parts.push(String(number).padStart(rule.digits, "0"));
  return parts.join(settings.separator);
}

/** The next free number among a parent's children for a suggested code (one past the highest already used). */
export function nextNumber(parentCode, siblingCodes, level, settings) {
  const rule = levelRule(settings, level);
  const head = rule.prefix ? `${parentCode}${settings.separator}${rule.prefix}${settings.separator}` : `${parentCode}${settings.separator}`;
  let max = 0;
  for (const c of siblingCodes) {
    if (!c.startsWith(head)) continue;
    const n = Number(c.slice(head.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return Math.max(max, siblingCodes.length) + 1;
}

/** An activity's code: its WBS code and the last two digits of its template activity (or its own number). */
export const activityCode = (wbsCode, number, separator = ".") => `${wbsCode}${separator}${String(number).slice(-2).padStart(2, "0")}`;

// a date column comes back as a Date at local midnight: its own calendar day, not the UTC one
const iso = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d ? String(d).slice(0, 10) : null);
const days = (a, b) => (a && b ? Math.round((Date.parse(`${iso(b)}T00:00:00Z`) - Date.parse(`${iso(a)}T00:00:00Z`)) / 86400000) + 1 : null);
export const duration = days;

/**
 * The tree with every derived figure. `version` carries the root's budget;
 * `nodes` are the stored rows (parent_id, seq, typed fields). Returns
 * { roots, byId, problems } — each node with level, wf (effective),
 * wv, budgetPlan (effective), childWf (its children's W.F together) and the
 * durations; problems name every place the rules do not hold.
 */
export function computeTree({ version, nodes, activities = [], settings }) {
  const s = settings || DEFAULT_SETTINGS;
  const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [], activities: [] }]));
  const roots = [];
  for (const n of byId.values()) (n.parent_id && byId.has(n.parent_id) ? byId.get(n.parent_id).children : roots).push(n);
  const sort = (xs) => { xs.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || String(a.code).localeCompare(String(b.code))); xs.forEach((x) => sort(x.children)); };
  sort(roots);
  for (const a of activities) byId.get(a.node_id)?.activities.push(a);
  const problems = [];
  const rootBudget = num(version.budget_plan);
  const walk = (list, parent, level) => {
    let childWf = 0;
    for (const n of list) {
      const pBudget = parent ? parent.budgetPlan : rootBudget;
      const typedWf = num(n.wf), typedBudget = num(n.budget_plan);
      let wf = typedWf, budgetPlan = typedBudget;
      if (s.budgetMode === "wf_to_budget") budgetPlan = wf != null && pBudget != null ? r2((wf / 100) * pBudget) : null;
      if (s.budgetMode === "budget_to_wf") wf = typedBudget != null && pBudget ? r4((typedBudget / pBudget) * 100) : null;
      const pWv = parent ? parent.wv : 100;
      Object.assign(n, {
        level, wf, wf_typed: typedWf, budgetPlan, budgetActual: num(n.budget_actual),
        wv: wf != null && pWv != null ? r4((wf / 100) * pWv) : null,
        color: levelRule(s, level).color,
        planDays: days(n.plan_start, n.plan_end), actualDays: days(n.actual_start, n.actual_end),
        plan_start: iso(n.plan_start), plan_end: iso(n.plan_end), actual_start: iso(n.actual_start), actual_end: iso(n.actual_end),
      });
      childWf += wf || 0;
      if (wf != null && (wf < 0 || wf > 100)) problems.push(`${n.code}: W.F ${wf}٪ بیرون از ۰ تا ۱۰۰ است.`);
      walk(n.children, n, level + 1);
      n.activities = activityRows(n, n.activities);
      const actWf = n.activities.reduce((t, a) => t + (a.wf || 0), 0);
      if (actWf > 100.0001) problems.push(`${n.code}: جمع W.F فعالیت‌ها ${r2(actWf)}٪ است؛ بیش از ۱۰۰٪ نمی‌شود.`);
      n.activityWf = r4(actWf);
    }
    if (childWf > 100.0001) problems.push(`${parent ? parent.code : "ریشه"}: جمع W.F فرزندان ${r2(childWf)}٪ است؛ بیش از ۱۰۰٪ نمی‌شود.`);
    if (parent) parent.childWf = r4(childWf);
    return r4(childWf);
  };
  const rootWf = walk(roots, null, 1);
  return { roots, byId, problems, rootWf };
}

/**
 * Activities as shown: W.F typed (or from their template activity); W.V and
 * budgets read from their WBS node, and its volumes and dates unless the
 * activity has its own typed — so a node's change reaches its activities.
 */
export function activityRows(node, activities = []) {
  return [...activities].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || String(a.code).localeCompare(String(b.code))).map((a) => {
    const wf = num(a.wf);
    const part = (v) => (wf != null && v != null ? r2((wf / 100) * v) : null);
    // an activity's own dates and volumes, when typed, stand over its node's
    const own = (k) => (a[k] !== null && a[k] !== undefined && a[k] !== "");
    const d = (k) => (own(k) ? iso(a[k]) : node[k]);
    const dates = { plan_start: d("plan_start"), plan_end: d("plan_end"), actual_start: d("actual_start"), actual_end: d("actual_end") };
    return {
      ...a, wf, ...dates,
      wv: wf != null && node.wv != null ? r4((wf / 100) * node.wv) : null,
      budgetPlan: part(node.budgetPlan), budgetActual: part(node.budgetActual),
      volumePlan: own("volume_plan") ? num(a.volume_plan) : num(node.volume_plan),
      volumeActual: own("volume_actual") ? num(a.volume_actual) : num(node.volume_actual), unit: node.unit || null,
      planDays: days(dates.plan_start, dates.plan_end), actualDays: days(dates.actual_start, dates.actual_end), progress: num(a.progress),
      own: { plan_start: own("plan_start") ? iso(a.plan_start) : null, plan_end: own("plan_end") ? iso(a.plan_end) : null,
        actual_start: own("actual_start") ? iso(a.actual_start) : null, actual_end: own("actual_end") ? iso(a.actual_end) : null,
        volume_plan: own("volume_plan") ? num(a.volume_plan) : null, volume_actual: own("volume_actual") ? num(a.volume_actual) : null },
    };
  });
}

/** What a change would make of a parent's children's W.F — refused above 100%. */
export function wfOverflow(siblingsWf, newWf) {
  const t = siblingsWf.reduce((s, x) => s + (Number(x) || 0), 0) + (Number(newWf) || 0);
  return t > 100.0001 ? r2(t) : null;
}

/** Siblings in their new order after moving `id` before / after another, or to the end. */
export function reorder(siblingIds, id, { beforeId = null, afterId = null } = {}) {
  const rest = siblingIds.filter((x) => x !== id);
  const at = beforeId ? rest.indexOf(beforeId) : afterId ? rest.indexOf(afterId) + 1 : rest.length;
  rest.splice(at < 0 ? rest.length : at, 0, id);
  return rest;
}

/** A code moved with its node: the old prefix swapped for the new one (a code typed by hand keeps its own). */
export function rebase(code, oldPrefix, newPrefix) {
  return code === oldPrefix ? newPrefix : code.startsWith(oldPrefix) ? newPrefix + code.slice(oldPrefix.length) : code;
}
