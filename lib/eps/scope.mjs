/**
 * PMS ↔ the platform's records (migration 075): which equipment, welds,
 * cables, instruments, foundations and structures a WBS activity covers, how
 * much they make, and how much of it is done — read from the records, never
 * typed again. Pure: the repository (lib/db/repos/eps-scope.mjs) loads the
 * items and writes what a rule's apply decides.
 *
 * An item, whatever its discipline:
 *   { key, label, name, subsystemId, subsystemCode, unitId, docNo, kind,
 *     group, groupLabel, measures: {count, dia_inch, length_m, volume_m3},
 *     done: {milestone: bool} }
 * A measure an item does not carry (a weld without a size, a cable without a
 * length) is null: counted apart as unknown, never as zero.
 */

export const DISCIPLINES = {
  equipment: { title: "تجهیزات", measures: ["count"], milestones: { set: "استقرار و تراز", grout: "گروت‌ریزی", align: "الایمنت", piping: "اتصال پایپینگ", electrical: "ترمینیشن برق", instrument: "ابزار دقیق تجهیز", ready: "آمادگی راه‌اندازی" }, kindLabel: "نوع تجهیز" },
  piping: { title: "پایپینگ (جوش‌ها، به تفکیک خط)", measures: ["count", "dia_inch"], milestones: { welded: "جوش‌شده", ndt: "NDT کامل و پذیرفته" }, docs: true },
  electrical: { title: "برق (کابل‌ها)", measures: ["count", "length_m"], milestones: { pulled: "کشیده‌شده", ready: "تست و تحویل" }, kindLabel: "کلاس ولتاژ" },
  instrumentation: { title: "ابزار دقیق", measures: ["count"], milestones: { installed: "نصب‌شده", ready: "کالیبره، لوپ‌چک و تحویل" }, kindLabel: "دستهٔ ابزار" },
  civil: { title: "سیویل (فونداسیون‌ها)", measures: ["count", "volume_m3"], milestones: { pour: "بتن‌ریزی", ready: "تحویل (مقاومت و خاکریزی)" } },
  structural: { title: "سازهٔ فلزی", measures: ["count"], milestones: { erection: "نصب", ready: "تحویل (شاقول، پیچ، گروت)" } },
};
export const MEASURES = { count: "تعداد", dia_inch: "اینچ‌قطر (Dia-inch)", length_m: "متر کابل", volume_m3: "مترمکعب بتن" };
export const MODES = { aggregate: "یک فعالیت برای همهٔ اقلام", per_item: "یک فعالیت برای هر قلم (در پایپینگ هر خط)" };

const r4 = (v) => Math.round(v * 10000) / 10000;
const r2 = (v) => Math.round(v * 100) / 100;
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

/** «20-P-*, 20-E-1?1» → one test: any of the comma-separated patterns, * any run, ? one character, case not counted. */
export function glob(pattern) {
  const parts = String(pattern || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const res = parts.map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i"));
  return (s) => res.some((r) => r.test(String(s || "")));
}

/** A rule as sent: known discipline, measure and milestone; filters cleaned. */
export function checkRule(input = {}) {
  const problems = [];
  const d = DISCIPLINES[input.discipline];
  if (!d) problems.push("رشته را انتخاب کنید.");
  const mode = input.mode === "per_item" ? "per_item" : "aggregate";
  const measure = input.measure || "count";
  if (d && !d.measures.includes(measure)) problems.push(`سنجهٔ «${MEASURES[measure] || measure}» برای ${d.title} نیست.`);
  const milestone = input.milestone || (d ? Object.keys(d.milestones).pop() : null);
  if (d && !d.milestones[milestone]) problems.push("مرحلهٔ انجام‌شده (milestone) نامعتبر است.");
  const f = input.filter || {};
  const filter = {
    subsystemIds: list(f.subsystemIds), unitIds: list(f.unitIds),
    pattern: String(f.pattern || "").trim() || null, docPattern: d?.docs ? String(f.docPattern || "").trim() || null : null,
    kinds: list(f.kinds),
  };
  for (const [k, v] of [["الگوی شماره", filter.pattern], ["الگوی نقشه", filter.docPattern]]) {
    if (v && v.length > 200) problems.push(`${k} بیش از ۲۰۰ نویسه است.`);
  }
  return { rule: { discipline: input.discipline, mode, measure, milestone, filter, auto_apply: input.autoApply !== false }, problems };
}

/** Does an item fall under a rule's filter? Every filter given must hold. */
export function matches(item, filter = {}) {
  if (filter.subsystemIds?.length && !filter.subsystemIds.includes(item.subsystemId)) return false;
  if (filter.unitIds?.length && !filter.unitIds.includes(item.unitId)) return false;
  if (filter.kinds?.length && !filter.kinds.includes(item.kind)) return false;
  const p = glob(filter.pattern);
  if (p && !p(item.label) && !(item.group && p(item.group))) return false;
  const dp = glob(filter.docPattern);
  if (dp && !dp(item.docNo)) return false;
  return true;
}

/** The items a rule takes in, from all the discipline's items. */
export const itemsOf = (rule, all) => all.filter((i) => i.discipline === rule.discipline && matches(i, rule.filter));

/** The group an item counts in: piping welds by their line, everything else by itself. */
export const groupOf = (rule, item) => (rule.discipline === "piping" ? { key: `line:${item.group || "?"}`, label: item.group || "بدون خط" } : { key: item.key, label: item.label });

/**
 * How much a set of items makes and how much of it is done, in the rule's
 * measure. Items without the measure are counted apart (`unknown`) and the
 * total is then a floor, marked so — never filled in.
 */
export function summarize(items, rule) {
  let qty = 0, done = 0, unknown = 0, doneCount = 0;
  for (const i of items) {
    const q = i.measures?.[rule.measure];
    const isDone = !!i.done?.[rule.milestone];
    if (isDone) doneCount++;
    if (q === null || q === undefined) { unknown++; continue; }
    qty += Number(q);
    if (isDone) done += Number(q);
  }
  return { items: items.length, doneCount, qty: r4(qty), done: r4(done), unknown, pct: qty > 0 ? r2((done / qty) * 100) : null };
}

/** The items in groups, each with its own summary. */
export function groups(items, rule) {
  const by = new Map();
  for (const i of items) {
    const g = groupOf(rule, i);
    if (!by.has(g.key)) by.set(g.key, { key: g.key, label: g.label, name: rule.discipline === "piping" ? null : i.name, items: [] });
    by.get(g.key).items.push(i);
  }
  return [...by.values()].sort((a, b) => a.label.localeCompare(b.label)).map((g) => ({ ...g, ...summarize(g.items, rule) }));
}

/** What changed since the rule was last applied: keys come and go, quantities move. */
export function diff(seen, now) {
  const before = new Map(seen.map((s) => [s.key, s]));
  const after = new Map(now.map((s) => [s.key, s]));
  const added = now.filter((s) => !before.has(s.key)).map((s) => ({ key: s.key, label: s.label, qty: s.qty }));
  const removed = seen.filter((s) => !after.has(s.key)).map((s) => ({ key: s.key, label: s.label, qty: s.qty }));
  const changed = now.filter((s) => before.has(s.key) && Number(before.get(s.key).qty ?? -1) !== Number(s.qty ?? -1))
    .map((s) => ({ key: s.key, label: s.label, from: before.get(s.key).qty, to: s.qty }));
  return { added, removed, changed, any: added.length + removed.length + changed.length > 0 };
}

/**
 * Weights for activities made one per group: each group's share of the
 * quantity; equal shares when any group's quantity is unknown or all are
 * zero. Four decimals, the last one taking the rounding so they make 100.
 */
export function weights(gs) {
  if (!gs.length) return [];
  const known = gs.every((g) => !g.unknown && g.qty > 0);
  const total = known ? gs.reduce((s, g) => s + g.qty, 0) : gs.length;
  const out = gs.map((g) => r4(((known ? g.qty : 1) / total) * 100));
  out[out.length - 1] = r4(100 - out.slice(0, -1).reduce((s, x) => s + x, 0));
  return out;
}
