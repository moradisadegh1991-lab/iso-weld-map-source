/* The bill of material is the contractual list of what will physically be built.
   Anything the geometry claims but the MTO does not list is, by definition, not
   part of this line — so it must not be drawn. */

const RULES = [
  { type: "elbow90", re: /elbow\s*9\s*0|\b90\s*(deg|°)[^,]*elbow|ell\s*90/i },
  { type: "elbow45", re: /elbow\s*4\s*5|\b45\s*(deg|°)[^,]*elbow|ell\s*45/i },
  { type: "tee", re: /\btee\b/i },
  { type: "reducer", re: /reducer|swage|\bred\.\s*conc|\bred\.\s*ecc/i },
  { type: "flange-wn", re: /flange/i },
  { type: "valve-bw", re: /valve/i },
];

export const FITTING_TYPES = ["elbow90", "elbow45", "tee", "reducer", "flange-wn", "valve-bw", "valve-flanged"];

export const FA = {
  elbow90: "زانو ۹۰°", elbow45: "زانو ۴۵°", tee: "سه‌راهی", reducer: "تبدیل",
  "flange-wn": "فلنج", "valve-bw": "شیر", "valve-flanged": "شیر فلنجی",
};

/** The fitting type a BOM row buys, or null (pipe, bolting, gaskets, anything else). */
export function fittingTypeOf(b) {
  const txt = `${b.group || ""} ${b.description || ""}`;
  if (/^\s*pipe\s*$/i.test(b.group || "") && !/elbow|tee|reducer|flange|valve/i.test(txt)) return null;
  return RULES.find((r) => r.re.test(txt))?.type ?? null;
}

/** Count fittings actually listed in the bill of material. */
export function bomCensus(bom) {
  const c = {};
  (bom || []).forEach((b) => {
    const txt = `${b.group || ""} ${b.description || ""}`;
    if (/^\s*pipe\s*$/i.test(b.group || "") && !/elbow|tee|reducer|flange|valve/i.test(txt)) return;
    const rule = RULES.find((r) => r.re.test(txt));
    if (!rule) return;
    const q = parseFloat(b.qty);
    c[rule.type] = (c[rule.type] || 0) + (isFinite(q) ? Math.round(q) : 1);
  });
  return c;
}

/**
 * Compare the extracted geometry against the MTO.
 * Returns { nodes, edges, checks, dropped, ghosted } — a geometry that contains
 * only what the drawing actually buys.
 *
 * Conservative on purpose:
 *   census 0  → the fitting is not bought at all → remove it (or ghost it if
 *               removing would orphan a branch). This is a hallucination.
 *   census <  → keep everything, raise a warning. An off-by-one count is far
 *               more likely to be a mis-read qty than a fake fitting.
 *   census >  → keep everything, raise a warning: geometry is incomplete.
 */
export function reconcileWithBom(nodes, edges, bom, strict = true) {
  const checks = [];
  const census = bomCensus(bom);
  const hasBom = Object.keys(census).length > 0 || (bom || []).length > 0;
  if (!hasBom) {
    checks.push({ label: "تطبیق با MTO", status: "skip", detail: "لیست متریال خوانده نشد؛ هندسه بدون فیلتر رسم می‌شود" });
    return { nodes, edges, checks, dropped: [], ghosted: [] };
  }

  const need = {};
  nodes.forEach((n) => { if (FITTING_TYPES.includes(n.type)) need[n.type] = (need[n.type] || 0) + 1; });

  const degree = new Map();
  edges.forEach((e) => {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  });

  const dropped = [], ghosted = [];
  const unbackedTypes = Object.keys(need).filter((t) => !(census[t] > 0));

  let nn = nodes, ne = edges;

  if (strict && unbackedTypes.length) {
    unbackedTypes.forEach((t) => {
      nodes.filter((n) => n.type === t).forEach((n) => {
        const d = degree.get(n.id) || 0;
        if (d >= 3) ghosted.push(n.id); else dropped.push(n.id);
      });
      checks.push({
        label: `${FA[t] || t} در MTO نیست`,
        status: "warn",
        detail: `هندسه ${need[t]} عدد ادعا می‌کند ولی لیست متریال هیچ ردیفی ندارد — ` +
          `${dropped.length ? "از طراحی حذف شد" : "به‌صورت شبح رسم شد"}. اگر واقعاً وجود دارد، ردیف MTO جا افتاده است.`,
      });
    });

    // remove degree-2 nodes and stitch their two edges into one
    dropped.forEach((id) => {
      const inc = ne.filter((e) => e.from === id || e.to === id);
      if (inc.length === 2) {
        const a = inc[0].from === id ? inc[0].to : inc[0].from;
        const b = inc[1].from === id ? inc[1].to : inc[1].from;
        ne = ne.filter((e) => !inc.includes(e));
        ne.push({ from: a, to: b, nps: Math.max(Number(inc[0].nps) || 0, Number(inc[1].nps) || 0) });
      } else {
        ne = ne.filter((e) => e.from !== id && e.to !== id);
      }
      nn = nn.filter((n) => n.id !== id);
    });
  }

  // count mismatches that are NOT hallucinations
  Object.keys({ ...need, ...census }).forEach((t) => {
    if (!FITTING_TYPES.includes(t)) return;
    const g = need[t] || 0, m = census[t] || 0;
    if (m === 0 || g === m) return;
    checks.push({
      label: `تعداد ${FA[t] || t}`,
      status: "warn",
      // Carried as a number, not inferred from the sentence: a component the
      // MTO counts and the geometry lacks means every pipe length computed
      // from that geometry absorbed the missing body. lib/engine.js reads
      // this to stop those comparisons reporting a clean pass.
      ...(g < m ? { shortBy: m - g, shortType: FA[t] || t } : {}),
      detail: g < m
        ? `MTO ${m} عدد دارد، هندسه فقط ${g} عدد — احتمالاً یک اتصال در استخراج جا افتاده یا روی برگ دیگری است`
        : `هندسه ${g} عدد دارد، MTO فقط ${m} عدد — یکی از اتصالات ممکن است ساختگی باشد`,
    });
  });

  const okTypes = Object.keys(need).filter((t) => census[t] === need[t]);
  if (okTypes.length) {
    checks.push({
      label: "تطبیق اتصالات با MTO", status: "ok",
      detail: okTypes.map((t) => `${FA[t] || t} ×${need[t]}`).join(" · "),
    });
  }

  return { nodes: nn, edges: ne, checks, dropped, ghosted };
}
