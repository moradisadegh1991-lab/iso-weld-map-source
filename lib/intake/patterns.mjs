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
    .map((t) => t.replace(/^[-./"'_]+|[-./_]+$/g, ""))
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

// ── OCR misreads ─────────────────────────────────────────────────────────
// Characters an OCR engine confuses on drawings. Used two ways, both only
// to PROPOSE: a word that fits a project shape once a confusable character
// is swapped (an O where the shape has a digit), and a new number that is
// one swap away from a number the register already holds. Either makes the
// item "to be checked" — a person applies it only with a reason.
const TO_DIGIT = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };
const TO_LETTER = { 0: "O", 1: "I", 2: "Z", 5: "S", 6: "G", 8: "B" };

/**
 * A token that matches no shape, read as the shapes would have it.
 * Returns { value, kinds } when exactly the swaps of confusable characters
 * make it fit, or null. Separators must already agree.
 */
export function repair(token, patterns) {
  const t = String(token).toUpperCase();
  const hits = new Map();
  for (const p of patterns) {
    if (p.shape.length !== t.length) continue;
    let out = "", swaps = 0;
    for (let i = 0; i < t.length && out.length === i; i++) {
      const want = p.shape[i], ch = t[i];
      if (want === "9") {
        if (/[0-9]/.test(ch)) out += ch; else if (TO_DIGIT[ch]) { out += TO_DIGIT[ch]; swaps++; }
      } else if (want === "A") {
        if (/[A-Z]/.test(ch)) out += ch; else if (TO_LETTER[ch]) { out += TO_LETTER[ch]; swaps++; }
      } else if (want === ch) out += ch;
    }
    if (out.length !== t.length || !swaps) continue;
    if (!hits.has(out)) hits.set(out, new Set());
    hits.get(out).add(p.kind);
  }
  if (hits.size !== 1) return null;
  const [[value, kinds]] = hits;
  return { value, kinds: [...kinds] };
}

/** One spelling for every group of characters an OCR confuses. */
export function confusableKey(s) {
  return String(s ?? "").toUpperCase().replace(/[OQD]/g, "0").replace(/[IL]/g, "1").replace(/Z/g, "2")
    .replace(/S/g, "5").replace(/B/g, "8").replace(/G/g, "6");
}
