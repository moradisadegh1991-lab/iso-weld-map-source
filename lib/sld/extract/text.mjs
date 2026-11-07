/**
 * Text and tag normalisation (Phase 12.3). Pure. The SOURCE text is never changed: `normalizeText` returns a separate value, and every reading of a
 * tag, voltage or rating is a CANDIDATE (`parse` result) for a person to confirm — nothing here decides what a piece of equipment is.
 * Persian and English: Persian/Arabic-Indic digits → ASCII, Arabic ي/ك → Persian ی/ک, tatweel and zero-width marks dropped, common electrical units in both scripts.
 */
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹", ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FOLD = { "ي": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه", "×": "x", "Ⅹ": "x", "✕": "x", "−": "-", "–": "-", "—": "-", "‐": "-", "‑": "-", "µ": "u", "μ": "u", "Ω": "ohm", "Ω": "ohm", "²": "2", "³": "3", "‰": "permille", "，": ",", "٫": ".", "٬": "," };

/** NFKC, digits, letters, dashes, units glyphs; collapses spaces. Keeps case (tags are case-significant to a person). */
export function normalizeText(src) {
  let s = String(src ?? "").normalize("NFKC").replace(/[‌‍‎‏‪-‮ـ﻿]/g, (c) => (c === "‌" ? " " : ""));
  s = s.replace(/[۰-۹]/g, (c) => String(PERSIAN_DIGITS.indexOf(c))).replace(/[٠-٩]/g, (c) => String(ARABIC_DIGITS.indexOf(c)));
  s = [...s].map((c) => FOLD[c] ?? c).join("");
  return s.replace(/\s+/g, " ").trim();
}

// Persian unit words → the unit symbol (checked on word boundaries after normalisation)
const FA_UNITS = [["کیلو ?ولت ?آمپر", "kVA"], ["مگا ?ولت ?آمپر", "MVA"], ["کیلو ?ولت", "kV"], ["کیلو ?وات", "kW"], ["مگا ?وات", "MW"], ["کیلو ?آمپر", "kA"], ["آمپر", "A"], ["ولت", "V"], ["هرتز", "Hz"], ["اسب بخار", "hp"]];
export function persianUnits(s) { let t = s; for (const [re, u] of FA_UNITS) t = t.replace(new RegExp(re, "g"), ` ${u} `); return t.replace(/\s+/g, " ").trim(); }

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const toNum = (x) => Number(String(x).replace(",", "."));
/** The ratings and annotations a text may state. Each match is an UNCONFIRMED candidate: { kind, value, unit, raw, basis }. */
export function parseRatings(text) {
  const s = persianUnits(normalizeText(text)), out = [];
  const add = (kind, value, unit, raw, extra = {}) => out.push({ kind, value, unit, raw: raw.trim(), basis: "text-pattern", ...extra });
  let m;
  // a voltage PAIR 33/11 kV, 6.6kV
  for (m of s.matchAll(new RegExp(String.raw`(${NUM})\s*/\s*(${NUM})(?:\s*/\s*(${NUM}))?\s*(kV|V)\b`, "gi"))) {
    const unit = m[4].toLowerCase() === "kv" ? "kV" : "V";
    add("voltage_levels", [m[1], m[2], m[3]].filter(Boolean).map(toNum), unit, m[0]);
  }
  for (m of s.matchAll(new RegExp(String.raw`(?<![\d./])(${NUM})\s*(kV|V)\b(?!\s*A)`, "gi"))) {
    if (out.some((o) => o.kind === "voltage_levels" && o.raw.includes(m[0].trim()))) continue;
    const unit = m[2].toLowerCase() === "kv" ? "kV" : "V";
    add("voltage", toNum(m[1]), unit, m[0]);
  }
  for (m of s.matchAll(new RegExp(String.raw`(?<![\d.])(${NUM})\s*(MVA|kVA|KVA|mva)\b`, "g"))) add("apparent_power", toNum(m[1]), /^m/i.test(m[2]) ? "MVA" : "kVA", m[0]);
  for (m of s.matchAll(new RegExp(String.raw`(?<![\d.])(${NUM})\s*(MW|kW|KW|W|hp|HP)\b`, "g"))) add("power", toNum(m[1]), m[2] === "MW" ? "MW" : /^k/i.test(m[2]) ? "kW" : /hp/i.test(m[2]) ? "hp" : "W", m[0]);
  for (m of s.matchAll(new RegExp(String.raw`(?<![\d.])(${NUM})\s*(kA|A)\b(?!\w)`, "g"))) add("current", toNum(m[1]), m[2], m[0]);
  for (m of s.matchAll(new RegExp(String.raw`(?<![\d.])(${NUM})\s*Hz\b`, "gi"))) add("frequency", toNum(m[1]), "Hz", m[0]);
  for (m of s.matchAll(new RegExp(String.raw`(?:%\s*Z|Z\s*=?)\s*=?\s*(${NUM})\s*%|(${NUM})\s*%\s*Z\b|(?<![\w])uk\s*=?\s*(${NUM})\s*%`, "gi"))) add("impedance_percent", toNum(m[1] ?? m[2] ?? m[3]), "%", m[0]);
  for (m of s.matchAll(/\b(Dyn\d{1,2}|YNyn\d{1,2}|Yyn\d{1,2}|Dd\d{1,2}|YNd\d{1,2}|Yd\d{1,2})\b/g)) add("vector_group", m[1], null, m[0]);
  for (m of s.matchAll(new RegExp(String.raw`(\d+)\s*[xC]\s*(${NUM})\s*(mm2|sqmm|mm)?\b`, "gi"))) if (/(\bmm2\b|\bsqmm\b|\bXLPE\b|\bPVC\b|\bCu\b|\bAl\b|\bC\b|\d\s*C\s*x)/i.test(s) || m[3]) add("cable_cores_size", `${m[1]}x${toNum(m[2])}`, m[3] ? "mm2" : null, m[0], { cores: Number(m[1]), size: toNum(m[2]) });
  for (m of s.matchAll(/\b(XLPE|PVC|EPR|PILC|LSZH|Cu|Al)\b/g)) add("cable_material", m[1], null, m[0]);
  return out;
}

// ── tags and annotations ─────────────────────────────────────────────────────────────────────────────────
// An equipment TAG: letters then a number (T-101, TR-1A, MCC-2, CB-12/1, 11-TR-001). A pattern match is evidence of the SHAPE of a tag, not of what it tags.
const TAG = /^(?:\d{1,3}[-_ ])?[A-Z]{1,5}[-_ ]?\d{1,4}[A-Z]?(?:[-/]\d{1,3}[A-Z]?)?$/;
const ANSI_RELAY = /^(?:\d{1,3}[A-Z]{0,2})(?:\/\d{1,3}[A-Z]{0,2})*$/;       // 87T, 50/51, 27, 59N
const OFFPAGE = /\b(?:SH(?:EET|T)?\.?\s*\d|DWG\.?\s*[A-Z0-9-]+|TO\s+(?:SH|DWG|PANEL)|FROM\s+(?:SH|DWG|PANEL)|OFF[- ]?PAGE|CONT(?:INUED)?\.?\s*(?:ON|TO|FROM))/i;
const FA_OFFPAGE = /(?:ادامه|نقشه|برگ|شیت)\s*(?:در|به|از)?\s*[A-Z0-9-]*/;

/** The role a text may play. Candidates only; `roles` may hold several when the text is ambiguous (e.g. "50/51" is a relay code or a ratio). */
export function textRoles(text) {
  const n = normalizeText(text), s = persianUnits(n);
  const roles = [];
  const r = parseRatings(n);
  if (r.some((x) => x.kind === "voltage" || x.kind === "voltage_levels")) roles.push("voltage");
  if (r.some((x) => ["apparent_power", "power", "current", "frequency", "impedance_percent", "vector_group"].includes(x.kind))) roles.push("rating");
  if (r.some((x) => x.kind === "cable_cores_size" || x.kind === "cable_material")) roles.push("cable");
  if (TAG.test(n) && /[A-Za-z]/.test(n) && /\d/.test(n) && !roles.includes("voltage") && !roles.includes("rating")) roles.push("tag");
  if (ANSI_RELAY.test(n) && /^\d/.test(n) && !roles.length) roles.push("device_code");
  if (OFFPAGE.test(n) || FA_OFFPAGE.test(n)) roles.push("offpage");
  void s;
  return { roles: roles.length ? roles : ["label"], ratings: r, normalized: n };
}
export { TAG, ANSI_RELAY };
