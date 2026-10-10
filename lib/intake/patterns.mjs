/**
 * The project's numbering, as SHAPES: "30-E-1101A" has the shape
 * 99-A-9999A — digits become 9, letters A, separators stay as written. A shape is learned from the numbers a register already
 * holds, or from one example a person types; it is never invented.
 *
 * A token in a document is a candidate of a kind only when its shape is one
 * the project has for that kind. A shape two kinds share (an equipment tag
 * and a line number written alike) decides nothing: the token is reported
 * as ambiguous, for a person.
 */

export const KINDS = {
  drawing: "شمارهٔ نقشه / مدرک",
  equipment: "تجهیز",
  line: "لاین",
  instrument: "ابزار دقیق",
  subsystem: "ساب‌سیستم",
  system: "سیستم",
};

/** "30-E-1101A" → "99-A-9999A". Letters A, digits 9, everything else as written. */
export function shapeOf(s) {
  return String(s ?? "").trim().toUpperCase()
    .replace(/[A-Z]/g, "A").replace(/[0-9]/g, "9");
}

/** A shape → a regex matching exactly one token of it (anchored). */
export function shapeRegex(shape) {
  const esc = (c) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  let src = "";
  for (const run of shape.match(/(A+|9+|[^A9]+)/g) || []) {
    if (run[0] === "A") src += `[A-Z]{${run.length}}`;
    else if (run[0] === "9") src += `[0-9]{${run.length}}`;
    else src += esc(run);
  }
  return new RegExp(`^${src}$`);
}

/** Shapes worth trusting from a register's values: at least `min` values share it, and it has a digit. */
export function learnShapes(values, { min = 2 } = {}) {
  const count = new Map(), example = new Map();
  for (const v of values) {
    const s = shapeOf(v);
    if (!s || !/9/.test(s) || s.length < 3) continue;
    count.set(s, (count.get(s) || 0) + 1);
    if (!example.has(s)) example.set(s, String(v).trim().toUpperCase());
  }
  return [...count].filter(([, n]) => n >= min).map(([shape, n]) => ({ shape, count: n, example: example.get(shape) }));
}

/**
 * Split text into tokens a number can be. Numbers carry hyphens, slashes,
 * dots and inch marks inside them; spaces, commas, brackets end them.
 */
export function tokens(text) {
  return String(text ?? "").toUpperCase()
    .split(/[\s,;:()[\]{}<>|*]+/)
    .map((t) => t.replace(/^[-./"']+|[-./]+$/g, ""))
    .filter((t) => t.length >= 3 && /\d/.test(t));
}

/**
 * Classify tokens against the project's shapes.
 * patterns: [{ kind, shape }] → { found: Map(kind → Map(token → count)), ambiguous: Map(token → kinds[]) }
 */
export function recognize(text, patterns) {
  const byShape = new Map();
  for (const p of patterns) {
    if (!byShape.has(p.shape)) byShape.set(p.shape, new Set());
    byShape.get(p.shape).add(p.kind);
  }
  const found = new Map(Object.keys(KINDS).map((k) => [k, new Map()]));
  const ambiguous = new Map();
  for (const t of tokens(text)) {
    const kinds = byShape.get(shapeOf(t));
    if (!kinds) continue;
    if (kinds.size > 1) { ambiguous.set(t, [...kinds]); continue; }
    const k = [...kinds][0];
    found.get(k).set(t, (found.get(k).get(t) || 0) + 1);
  }
  return { found, ambiguous };
}

/** Shapes the project gives to more than one kind — named so a person can resolve them. */
export function sharedShapes(patterns) {
  const by = new Map();
  for (const p of patterns) by.set(p.shape, [...(by.get(p.shape) || []), p.kind]);
  return [...by].filter(([, ks]) => new Set(ks).size > 1).map(([shape, ks]) => ({ shape, kinds: [...new Set(ks)] }));
}
