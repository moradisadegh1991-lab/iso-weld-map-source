/**
 * Deterministic guards over a model's extraction, run before and after the
 * repair pass. Pure functions over plain data — no DOM, no network — so they
 * can be tested.
 *
 * `sanitize` REPORTS; it never changes the extraction (architecture review of
 * 2026-11-01). It used to repair: drop a node with no coordinates and every
 * edge to it, keep one of two nodes at one point, and rewrite an edge's size
 * to the line's when the BOM did not list it. Each of those changed the
 * engineering record in silence — a flange and the valve bolted to it share
 * a point and are two items; a branch of 3/4" on a 6" line is not a misread
 * 6"; a node without coordinates dropped took its elbow out of the route
 * with no warning at all. The engine names each of these as a check
 * (lib/engine.js: nodes and edges set aside, coincident joints, a size not
 * read), so nothing is lost by not repairing here.
 *
 * @returns {string[]} notes — what the reading handed over that does not hold together
 */
export function sanitize(data) {
  const notes = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return ["ساختار خروجی استخراج معتبر نیست."];
  }
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const bom = Array.isArray(data.bom) ? data.bom : [];
  const bomSizes = [...new Set(bom.map((r) => Number(r?.diam))
    .filter((n) => Number.isFinite(n) && n > 0))];

  const invalidNodes = nodes.filter((n) =>
    !n || ![n.E, n.N, n.EL].every((v) => typeof v === "number" && Number.isFinite(v)));
  if (invalidNodes.length) notes.push(`${invalidNodes.length} گره مختصات عددی کامل ندارد؛ داده حذف نشده است.`);

  const ids = new Set(), duplicates = [];
  for (const n of nodes) {
    if (n?.id == null) continue;
    const id = String(n.id);
    if (ids.has(id)) duplicates.push(id);
    ids.add(id);
  }
  if (duplicates.length) notes.push(`شناسه گره تکراری: ${[...new Set(duplicates)].join(", ")}؛ گره‌ها حفظ شده‌اند.`);

  const positions = new Map();
  for (const n of nodes) {
    if (!n || ![n.E, n.N, n.EL].every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    const k = `${n.E}|${n.N}|${n.EL}`;
    positions.set(k, (positions.get(k) || 0) + 1);
  }
  const coincident = [...positions.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
  if (coincident) notes.push(`${coincident} گره با مختصات مشترک یافت شد؛ ممکن است اتصالات مستقل باشند و حذف نشده‌اند.`);

  const known = new Set(nodes.filter((n) => n?.id != null).map((n) => String(n.id)));
  const dangling = edges.filter((e) => !e || e.from == null || e.to == null ||
    !known.has(String(e.from)) || !known.has(String(e.to)));
  if (dangling.length) notes.push(`${dangling.length} یال به گره ناموجود اشاره می‌کند؛ یال‌ها حفظ شده‌اند.`);

  const badNps = edges.filter((e) => !Number.isFinite(Number(e?.nps)) || Number(e.nps) <= 0);
  if (badNps.length) notes.push(`${badNps.length} یال سایز معتبر ندارد.`);
  const mismatched = edges.filter((e) => Number.isFinite(Number(e?.nps)) &&
    Number(e.nps) > 0 && bomSizes.length && !bomSizes.includes(Number(e.nps)));
  if (mismatched.length) notes.push(`${mismatched.length} یال سایزی خارج از DIAMهای BOM دارد؛ سایز تغییر نکرده است.`);

  const metaNps = Number(data.meta?.nps);
  if (bomSizes.length && metaNps > 0 && !bomSizes.includes(metaNps)) {
    notes.push(`سایز اصلی خط (${metaNps}") با DIAMهای BOM (${bomSizes.join(", ")}) تطبیق ندارد؛ مقدار اصلی حفظ شده است.`);
  }
  return notes;
}

/** How bad a model is, lower being better. */
export const score = (m) =>
  (m?.error ? 1000 : 0) + ((m?.checks || []).filter((c) => c.status === "warn").length);

/**
 * Should the repair pass's output replace the original? Only when it keeps
 * every node and every edge of the reading (by id, and by from→to), has two
 * nodes at least, and its checks are better (an error outweighs any number
 * of warnings: a repair that deleted the route has no warnings left).
 *
 * @returns {{accept: boolean, why?: string}}
 */
export function acceptRepair(before, after, baseData, fixedData) {
  const baseNodes = Array.isArray(baseData?.nodes) ? baseData.nodes : [];
  const fixedNodes = Array.isArray(fixedData?.nodes) ? fixedData.nodes : [];
  const baseEdges = Array.isArray(baseData?.edges) ? baseData.edges : [];
  const fixedEdges = Array.isArray(fixedData?.edges) ? fixedData.edges : [];
  const counts = (items, key) => {
    const map = new Map();
    for (const item of items) map.set(key(item), (map.get(key(item)) || 0) + 1);
    return map;
  };
  const retains = (a, b, key) => {
    const x = counts(a, key), y = counts(b, key);
    return [...x].every(([k, n]) => (y.get(k) || 0) >= n);
  };
  if (fixedNodes.length < 2) return { accept: false, why: "نتیجه کمتر از دو گره داشت" };
  if (!retains(baseNodes, fixedNodes, (n) => String(n?.id ?? ""))) {
    return { accept: false, why: "پاس اصلاح یک یا چند گره اصلی را حذف یا جایگزین کرده بود" };
  }
  if (baseEdges.length && !retains(baseEdges, fixedEdges, (e) => `${e?.from}→${e?.to}`)) {
    return { accept: false, why: "پاس اصلاح یک یا چند اتصال اصلی را حذف کرده بود" };
  }
  if (!(score(after) < score(before))) return { accept: false, why: "چک‌ها بهتر نشدند" };
  return { accept: true };
}
