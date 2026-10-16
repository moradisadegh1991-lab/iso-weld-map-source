/**
 * Phase 3 readers: what an equipment datasheet, a cable schedule and a
 * structural drawing state, as printed. Pure functions — the repository
 * decides which register row they belong to.
 *
 * DATASHEET  design pressure and design temperature, from labelled lines
 *            ("DESIGN PRESSURE … 25 barg", "DESIGN TEMPERATURE … -29 / 350 °C").
 *            A unit is converted only when the conversion is exact and the
 *            reference is stated: gauge pressure (barg, MPa(g), kPa(g),
 *            kg/cm²g, psig) and °C / °F. "bar" without g or a, an absolute
 *            pressure, "FV" (full vacuum) — reported, never filled: absolute
 *            to gauge needs the site's atmosphere, and "bar" alone does not
 *            say which. Two different values for one quantity (shell /
 *            tube side) are reported as such, not picked.
 * STRUCTURE  a structural drawing's total weight ("TOTAL WEIGHT 45.2 t",
 *            "… 45 200 kg"), kept only when the sheet shows exactly one
 *            structure; and the type of structure only when the title prints
 *            it (PIPE RACK, PLATFORM, SHELTER).
 */

const PRESSURE = [
  [/\b(?:MPA)\s*\(?\s*G\s*\)?/, 10],
  [/\b(?:KPA)\s*\(?\s*G\s*\)?/, 0.01],
  [/\bKG\s*\/\s*CM\s*2?\s*\(?\s*G\s*\)?|\bKG\s*\/\s*CM²\s*\(?\s*G\s*\)?/, 0.980665],
  [/\bPSI\s*\(?\s*G\s*\)?/, 0.0689476],
  [/\bBAR\s*\(?\s*G\s*\)?|\bBARG\b/, 1],
];
const ABSOLUTE = /\b(BARA|BAR\s*\(?\s*A\s*\)?|PSIA|MPA\s*\(?\s*A\s*\)?|KPA\s*\(?\s*A\s*\)?|ABS)\b/;
const NUM = String.raw`[-−–]?\d+(?:[.,]\d+)?`;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const toNum = (s) => Number(String(s).replace(/[−–]/g, "-").replace(",", "."));

function unitOf(text) {
  const t = text.toUpperCase();
  if (ABSOLUTE.test(t)) return { abs: true };
  for (const [re, k] of PRESSURE) if (re.test(t)) return { k };
  if (/\bBAR\b/.test(t)) return { bare: true };
  return null;
}

/** One labelled line's values: the numbers after the label, the unit anywhere on the line. */
function valuesAfter(line, label) {
  const i = line.toUpperCase().search(label);
  if (i < 0) return null;
  // "25 barg @ 350 °C": what follows @ is a coincident condition, not this value
  const rest = line.slice(i).replace(label, " ").split("@")[0];
  return { rest, nums: [...rest.matchAll(new RegExp(NUM, "g"))].map((m) => toNum(m[0])) };
}

/**
 * Design conditions in a datasheet's text (lines). Returns
 * { pressure, tmin, tmax, problems: [] } — a value is null when not stated
 * or not usable, with the reason in problems.
 */
export function designConditions(text) {
  const out = { pressure: null, tmin: null, tmax: null, problems: [] };
  const pressures = new Set(), maxes = new Set(), mins = new Set();
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const p = valuesAfter(line, /DESIGN\s+PRESS(?:URE|\.)?/i);
    if (p) {
      const u = unitOf(p.rest);
      if (/\bF\.?\s?V\b|FULL\s+VAC/i.test(p.rest) && !p.nums.length) out.problems.push(`فشار طراحی «${line}»: فقط خلأ کامل (FV) — عدد فشار نیست`);
      else if (!p.nums.length) { /* label without value: a blank form field */ }
      else if (!u) out.problems.push(`فشار طراحی «${line}»: واحد نوشته نشده — پر نشد`);
      else if (u.abs) out.problems.push(`فشار طراحی «${line}»: فشار مطلق است؛ تبدیل به گیج فشار محیط سایت را می‌خواهد — پر نشد`);
      else if (u.bare) out.problems.push(`فشار طراحی «${line}»: «bar» بدون g یا a — معلوم نیست گیج است یا مطلق؛ پر نشد`);
      else for (const n of p.nums.filter((x) => x >= 0)) pressures.add(round(n * u.k));
    }
    const t = valuesAfter(line, /DESIGN\s+TEMP(?:ERATURE|\.)?/i) || valuesAfter(line, /\bMDMT\b/i);
    if (t && t.nums.length) {
      const F = /°\s*F\b|\bDEG\.?\s*F\b|(?<![A-Z])F\b/i.test(t.rest) && !/°\s*C|\bDEG\.?\s*C\b/i.test(t.rest);
      const C = /°\s*C|\bDEG\.?\s*C\b|\(C\)|(?<![A-Z])C\b/i.test(t.rest);
      if (!F && !C) { out.problems.push(`دمای طراحی «${line}»: واحد نوشته نشده — پر نشد`); continue; }
      const c = t.nums.map((n) => round(F ? (n - 32) * 5 / 9 : n, 1));
      if (/MDMT/i.test(line) && !/DESIGN\s+TEMP/i.test(line)) mins.add(Math.min(...c));
      else if (c.length >= 2) { mins.add(Math.min(...c)); maxes.add(Math.max(...c)); }
      else maxes.add(c[0]);
    }
  }
  const one = (set, label) => {
    if (set.size === 1) return [...set][0];
    if (set.size > 1) out.problems.push(`${label}: چند مقدار متفاوت (${[...set].join(" / ")}) — مثلاً سمت پوسته و لوله؛ پر نشد`);
    return null;
  };
  out.pressure = one(pressures, "فشار طراحی");
  out.tmax = one(maxes, "بیشینهٔ دمای طراحی");
  out.tmin = one(mins, "کمینهٔ دمای طراحی");
  if (out.tmin != null && out.tmax != null && out.tmin > out.tmax) {
    out.problems.push(`کمینهٔ دما (${out.tmin}) از بیشینه (${out.tmax}) بیشتر خوانده شد — پر نشد`);
    out.tmin = out.tmax = null;
  }
  return out;
}

/** A structural drawing's total weight in tonnes, or null. */
export function totalWeight(text) {
  const found = new Set();
  for (const raw of String(text ?? "").split("\n")) {
    const m = raw.toUpperCase().match(/TOTAL\s+(?:STEEL\s+)?WEIGHT[^0-9]*(\d[\d\s,]*(?:\.\d+)?)\s*(T|TON|TONS|TONNES?|KG|KGS)\b/);
    if (!m) continue;
    const n = Number(m[1].replace(/[\s,]/g, ""));
    if (Number.isFinite(n)) found.add(round(/^K/.test(m[2]) ? n / 1000 : n, 2));
  }
  return found.size === 1 ? [...found][0] : found.size > 1 ? { conflict: [...found] } : null;
}

/** The structure type the title prints, or null when it prints none or more than one. */
export function structureTypeOf(text) {
  const t = String(text ?? "").toUpperCase();
  const hits = [["pipe_rack", /PIPE\s*RACK/], ["platform", /PLATFORM/], ["shelter", /SHELTER/]].filter(([, re]) => re.test(t)).map(([k]) => k);
  return hits.length === 1 ? hits[0] : null;
}
