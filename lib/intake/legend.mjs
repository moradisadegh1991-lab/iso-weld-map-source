/**
 * The project's P&ID legend: how a line number is built, and the codes it
 * uses for fluid and insulation. Both are the project's own facts — typed
 * from the legend sheet by a person — never assumed by the platform.
 *
 * A line-number format is written with named parts; the part in [ ] is what
 * the line register holds as the line number:
 *
 *     {size}"-[{fluid}-{number}]-{class}-{insulation}     8"-MP-140001-A1A-H → MP-140001
 *     [{size}"-{fluid}-{number}-{class}-{insulation}]     the whole printed string is the number
 *     {size}"-[{fluid}-{number}]-{class}(-{insulation})   ( ) marks a part some lines do not print
 *
 * A code that the legend does not list is reported, never mapped to the
 * nearest one; with no codes entered for a kind, nothing of that kind is
 * filled.
 */

export const PARTS = {
  size: { re: String.raw`(\d{1,2}(?:[.\s-]\d\/\d)?|\d\/\d)`, fa: "سایز (اینچ)" },
  fluid: { re: "([A-Z]{1,4})", fa: "کد سیال" },
  number: { re: String.raw`(\d[\dA-Z]*)`, fa: "شماره" },
  class: { re: "([A-Z0-9]{1,10})", fa: "کلاس لوله" },
  insulation: { re: "([A-Z]{1,2})", fa: "کد عایق" },
};
export const CODE_KINDS = { fluid: "کد سیال", insulation: "کد عایق" };

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });

/** Literal text between parts, matched the way drawings and OCR vary it. */
function literal(ch) {
  if (ch === '"') return String.raw`\s*["”″']?\s*`;
  if (ch === "-") return String.raw`\s*-\s*`;
  if (/\s/.test(ch)) return String.raw`\s*`;
  return ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * "{size}\"-[{fluid}-{number}]-{class}-{insulation}" → { regex, parts, keyFrom, keyTo, pieces }
 */
export function compileFormat(format) {
  const f = String(format ?? "").trim();
  if (!f) throw bad("قالب شمارهٔ لاین خالی است.");
  const pieces = [];
  let i = 0, inKey = false, sawKey = false, inOpt = false;
  while (i < f.length) {
    const ch = f[i];
    if (ch === "{") {
      const j = f.indexOf("}", i);
      const name = j > 0 ? f.slice(i + 1, j) : "";
      if (!PARTS[name]) throw bad(`بخش «${name}» شناخته نشد؛ بخش‌ها: ${Object.keys(PARTS).map((k) => `{${k}}`).join(" ")}`);
      if (pieces.some((p) => p.part === name)) throw bad(`{${name}} دو بار آمده.`);
      pieces.push({ part: name, key: inKey, opt: inOpt });
      i = j + 1;
    } else if (ch === "(") {
      if (inOpt) throw bad("( تو در تو مجاز نیست.");
      inOpt = true; pieces.push({ open: true, key: inKey }); i++;
    } else if (ch === ")") {
      if (!inOpt) throw bad(") بدون (.");
      inOpt = false; pieces.push({ close: true, key: inKey }); i++;
    } else if (ch === "[") {
      if (inKey || sawKey) throw bad("فقط یک بخش [ ] برای شمارهٔ لاین مجاز است.");
      inKey = true; sawKey = true; i++;
    } else if (ch === "]") {
      if (!inKey) throw bad("] بدون [.");
      inKey = false; i++;
    } else {
      const last = pieces[pieces.length - 1];
      if (last && last.lit != null && last.key === inKey && last.opt === inOpt) last.lit += ch;
      else pieces.push({ lit: ch, key: inKey, opt: inOpt });
      i++;
    }
  }
  if (inKey) throw bad("[ بسته نشده.");
  if (inOpt) throw bad("( بسته نشده.");
  if (pieces.some((p) => p.part === "number" && p.opt)) throw bad("{number} نمی‌تواند اختیاری باشد.");
  if (!sawKey) throw bad("بخشی را که شمارهٔ لاین در رجیستر است داخل [ ] بگذارید.");
  if (!pieces.some((p) => p.part === "number" && p.key)) throw bad("{number} باید داخل [ ] باشد.");
  const parts = pieces.filter((p) => p.part).map((p) => p.part);
  const src = pieces.map((p) => (p.open ? "(?:" : p.close ? ")?" : p.part ? PARTS[p.part].re : [...p.lit].map(literal).join(""))).join("");
  return { format: f, pieces, parts, regex: new RegExp(`(?<![A-Z0-9/-])${src}(?![A-Z0-9/-])`, "g") };
}

/** Rebuild a part's text the way the format writes it (OCR spacing dropped). */
function canonical(pieces, values) {
  // an optional part the line did not print takes its separator with it
  return pieces.filter((p) => !p.open && !p.close && !(p.opt && fmtMissing(pieces, p, values)))
    .map((p) => (p.part ? values[p.part] : p.lit)).join("");
}
function fmtMissing(pieces, p, values) {
  const i = pieces.indexOf(p);
  let a = i, b = i;
  while (a > 0 && !pieces[a].open) a--;
  while (b < pieces.length - 1 && !pieces[b].close) b++;
  return pieces.slice(a, b).some((q) => q.part && !values[q.part]);
}

/**
 * Line numbers in a text, per the format. codes: { fluid: Map, insulation: Map }.
 * Returns [{ key, printed, size, class, fluid, insulation, unknown: {fluid?, insulation?} }].
 */
export function parseLineNumbers(text, fmt, codes = {}) {
  const out = [];
  const t = String(text ?? "").toUpperCase();
  for (const m of t.matchAll(fmt.regex)) {
    const values = {};
    fmt.parts.forEach((p, k) => { values[p] = String(m[k + 1] ?? "").replace(/\s+/g, " ").trim(); });
    const key = canonical(fmt.pieces.filter((p) => p.key), values);
    const unknown = {};
    const row = { key, printed: m[0].trim(), size: values.size ?? null, class: values.class ?? null, fluid: null, insulation: null, unknown };
    for (const kind of Object.keys(CODE_KINDS)) {
      const v = values[kind];
      if (!v) continue;
      const known = codes[kind];
      if (known && known.has(v)) row[kind] = v;
      else unknown[kind] = v;
    }
    out.push(row);
  }
  return out;
}

/** "MP<TAB>MEDIUM PRESSURE STEAM" lines → [{code, meaning}]; a line without a code is refused. */
export function parseCodeList(text) {
  const rows = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    const m = l.match(/^([A-Z0-9]{1,6})\s*(?:\t|=|:|\s-\s|\s{2,}|\s)\s*(.+)$/i);
    if (!m) throw bad(`«${l}»: کد و شرح را با Tab یا = جدا کنید (مثلاً MP = MEDIUM PRESSURE STEAM).`);
    rows.push({ code: m[1].toUpperCase(), meaning: m[2].trim() });
  }
  return rows;
}
