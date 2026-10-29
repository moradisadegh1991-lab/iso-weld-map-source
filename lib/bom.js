/* The bill of material is the contractual list of what will physically be built.
   Anything the geometry claims but the MTO does not list is, by definition, not
   part of this line — so it must not be drawn. */

/**
 * What a BOM row buys, as a FAMILY: the MTO says "valve" or "flange", while the
 * geometry says which kind (a butt-weld, flanged or wafer valve; a WN or a
 * blind flange). Counting by kind on one side and by family on the other was
 * the owner's report of 2026-10-29: every valve in the MTO was a "valve-bw", so a
 * flanged valve the model had read correctly was taken for a hallucination and
 * removed.
 */
const RULES = [
  { type: "olet", re: /\w*olet\b|nipolet|branch\s*outlet/i },
  { type: "spacer", re: /spacer|spectacle|figure[\s-]*8|paddle\s*blind/i },
  { type: "cap", re: /\bcap\b/i },
  { type: "elbow90", re: /elbow\s*9\s*0|\b90\s*(deg|°)[^,]*elbow|ell\s*90/i },
  { type: "elbow45", re: /elbow\s*4\s*5|\b45\s*(deg|°)[^,]*elbow|ell\s*45/i },
  { type: "tee", re: /\btee\b/i },
  { type: "reducer", re: /reducer|swage|\bred\.\s*conc|\bred\.\s*ecc/i },
  { type: "flange", re: /flange/i },
  { type: "valve", re: /valve/i },
];

/** The family a geometry node type is counted under against the MTO. */
const FAMILY = { "flange-wn": "flange", "flange-blind": "flange", "valve-bw": "valve", "valve-flanged": "valve", "valve-wafer": "valve" };
export const familyOf = (type) => FAMILY[type] || type;

export const FITTING_TYPES = ["elbow90", "elbow45", "tee", "reducer", "flange-wn", "flange-blind", "valve-bw", "valve-flanged", "valve-wafer", "olet", "spacer", "cap"];
const FAMILIES = new Set(FITTING_TYPES.map(familyOf));

export const FA = {
  elbow90: "زانو ۹۰°", elbow45: "زانو ۴۵°", tee: "سه‌راهی", reducer: "تبدیل",
  flange: "فلنج", valve: "شیر", olet: "اولت", spacer: "اسپیسر", cap: "کپ",
  "flange-wn": "فلنج", "flange-blind": "فلنج کور", "valve-bw": "شیر", "valve-flanged": "شیر فلنجی", "valve-wafer": "شیر ویفر",
};

/** The fitting family a BOM row buys, or null (pipe, bolting, gaskets, anything else). */
export function fittingTypeOf(b) {
  const txt = `${b.group || ""} ${b.description || ""}`;
  if (/^\s*pipe\s*$/i.test(b.group || "") && !/elbow|tee|reducer|flange|valve|olet|spacer|\bcap\b/i.test(txt)) return null;
  return RULES.find((r) => r.re.test(txt))?.type ?? null;
}

/** Count fittings actually listed in the bill of material. */
export function bomCensus(bom) {
  const c = {};
  (bom || []).forEach((b) => {
    const t = fittingTypeOf(b);
    if (!t) return;
    const q = parseFloat(b.qty);
    c[t] = (c[t] || 0) + (isFinite(q) ? Math.round(q) : 1);
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
  // counted by family, as the MTO counts them
  nodes.forEach((n) => { if (FITTING_TYPES.includes(n.type)) need[familyOf(n.type)] = (need[familyOf(n.type)] || 0) + 1; });

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
      nodes.filter((n) => familyOf(n.type) === t).forEach((n) => {
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
    if (!FAMILIES.has(t)) return;
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
