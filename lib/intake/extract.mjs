/**
 * From what a file says to what the registers would change — proposed, not
 * applied. Pure: the registers come in as maps, the proposal goes out.
 *
 *   new       the register does not have it
 *   update    the register has it but not this value (an empty field filled)
 *   conflict  the register holds a DIFFERENT value — never overwritten
 *             without a person choosing it, with a reason
 *   same      the document agrees with the register (kept as a reference:
 *             this number appears on this revision)
 */
import { recognize, shapeOf, tokens, repair, confusableKey, KINDS } from "./patterns.mjs";
import { parseLineNumbers } from "./legend.mjs";

/**
 * Below this OCR confidence a number is flagged as read unsurely. Every
 * number OCR proposes to ADD or CHANGE is "to be checked" whatever its
 * confidence: on the test scan Tesseract read every number right with word
 * confidences from 0.28 to 0.97, so confidence cannot vouch for a value.
 */
export const OCR_MIN_CONF = 0.6;

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const cmp = (v) => norm(v).toUpperCase();

/** The register field each attribute fills, per kind. */
export const FIELDS = {
  equipment: { service: "description", subsystem: "subsystem_code" },
  line: { service: "service", class: "piping_class", subsystem: "subsystem_code", fluid: "fluid_code", insulation: "insulation" },
  instrument: { service: "service", subsystem: "subsystem_code" },
  subsystem: { system: "system_code" },
  system: {},
  drawing: {},
};
export const FIELD_FA = { service: "سرویس / شرح", class: "کلاس لوله", subsystem: "ساب‌سیستم", system: "سیستم", fluid: "کد سیال", insulation: "کد عایق" };

/**
 * ocr: how this sighting was read — null for a text layer or a table;
 * { conf, read } for OCR (read: the characters printed, when the shapes
 * swapped a confusable one). A number seen once without OCR is not an OCR
 * number; otherwise its best OCR reading counts.
 */
function add(map, kind, key, { attrs = {}, where = null, ocr = null, unknown = null }) {
  const k = `${kind}|${key}`;
  if (!map.has(k)) map.set(k, { kind, key, attrs: {}, where: [], disagree: {}, ocr: undefined, unknownCodes: {} });
  const c = map.get(k);
  if (!ocr) c.ocr = null;
  else if (c.ocr !== null) {
    const prev = c.ocr;
    // a clean reading beats a repaired one; between equals, the surer
    if (!prev || (prev.read && !ocr.read) || (!!prev.read === !!ocr.read && ocr.conf > prev.conf)) c.ocr = ocr;
  }
  for (const [a, v] of Object.entries(unknown || {})) c.unknownCodes[a] = [...new Set([...(c.unknownCodes[a] || []), v])];
  for (const [a, v] of Object.entries(attrs)) {
    const val = norm(v);
    if (!val) continue;
    if (c.attrs[a] && cmp(c.attrs[a]) !== cmp(val)) {
      // The file itself says two things: kept both, named — not picked.
      c.disagree[a] = [...new Set([...(c.disagree[a] || [c.attrs[a]]), val])];
    } else c.attrs[a] = val;
  }
  if (where && !c.where.includes(where)) c.where.push(where);
}

/**
 * read: { pages?: [{n, text}], tables?: [{sheet, records}], text? }
 * patterns: [{kind, shape}] · docNo: the document this file is a revision of
 */
export function extract(read, { patterns, docNo, lineFormat = null, codes = {} }) {
  const map = new Map();
  const ambiguous = new Map();
  const unknownFormat = [];
  const shapeKinds = new Map();
  for (const p of patterns) shapeKinds.set(p.shape, [...new Set([...(shapeKinds.get(p.shape) || []), p.kind])]);
  const own = cmp(docNo);
  let docNoSeen = false;

  const lines = (text, where, ocr = null) => {
    if (!lineFormat) return;
    for (const l of String(text).split("\n")) for (const x of parseLineNumbers(l, lineFormat, codes)) {
      add(map, "line", x.key, { attrs: { class: x.class, fluid: x.fluid, insulation: x.insulation }, where, ocr, unknown: x.unknown });
      if (x.size) add(map, "line", x.key, { attrs: { size: x.size }, where, ocr });
    }
  };
  const scan = (text, where, ocr = null) => {
    if (own && cmp(text).includes(own)) docNoSeen = true;
    const r = recognize(text, patterns);
    for (const [kind, toks] of r.found) for (const t of toks.keys()) {
      if (kind === "drawing" && t === own) continue;
      add(map, kind, t, { where, ocr });
    }
    for (const [t, kinds] of r.ambiguous) ambiguous.set(t, kinds);
    lines(text, where, ocr);
  };
  // An OCR page is read word by word: each number carries how sure the engine
  // was of the word it came from. A word that fits no shape is tried once
  // with confusable characters swapped (O→0, 1→I …), and proposed as such.
  const scanOcr = (page, where) => {
    for (const w of page.words) {
      if (own && cmp(w.t).includes(own)) docNoSeen = true;
      const r = recognize(w.t, patterns);
      let hit = false;
      for (const [kind, toks] of r.found) for (const t of toks.keys()) {
        hit = true;
        if (kind === "drawing" && t === own) continue;
        add(map, kind, t, { where, ocr: { conf: w.c } });
      }
      for (const [t, kinds] of r.ambiguous) { hit = true; ambiguous.set(t, kinds); }
      if (hit) continue;
      for (const tok of tokens(w.t)) {
        const fix = repair(tok, patterns);
        if (!fix) continue;
        if (fix.kinds.length > 1) { ambiguous.set(fix.value, fix.kinds); continue; }
        if (fix.kinds[0] === "drawing" && fix.value === own) { docNoSeen = true; continue; }
        add(map, fix.kinds[0], fix.value, { where, ocr: { conf: w.c, read: tok } });
      }
    }
    for (const l of page.lines) lines(l.text, where, { conf: l.c });
  };
  for (const p of read.pages || []) {
    if (p.words) scanOcr(p, `ص${p.n} (OCR)`);
    else scan(p.text, `ص${p.n}`);
  }

  for (const tb of read.tables || []) {
    for (const rec of tb.records) {
      const where = `${tb.sheet}!${rec.row}`;
      const sub = norm(rec.subsystem).toUpperCase(), sys = norm(rec.system).toUpperCase();
      if (rec.line) add(map, "line", norm(rec.line).toUpperCase(), { attrs: { service: rec.service || rec.fluid, class: rec.class, subsystem: sub }, where });
      if (rec.tag) {
        const t = norm(rec.tag).toUpperCase();
        const kinds = (shapeKinds.get(shapeOf(t)) || []).filter((k) => k === "equipment" || k === "instrument");
        if (kinds.length === 1) add(map, kinds[0], t, { attrs: { service: rec.service, subsystem: sub }, where });
        else if (kinds.length > 1) ambiguous.set(t, kinds);
        else unknownFormat.push({ value: t, where, shape: shapeOf(t) });
      }
      if (sub) add(map, "subsystem", sub, { attrs: { system: sys }, where });
      if (sys) add(map, "system", sys, { where });
    }
  }
  if (read.text) scan(read.text, "متن");
  for (const c of map.values()) if (c.ocr === undefined) c.ocr = null;
  return { candidates: [...map.values()], ambiguous: [...ambiguous].map(([token, kinds]) => ({ token, kinds })),
    unknownFormat, docNoSeen: own ? docNoSeen : null };
}

/**
 * Against the registers. registers[kind]: Map(KEY → row with the FIELDS
 * columns and `id`). Returns the proposal rows.
 */
export function diff(candidates, registers) {
  const near = new Map();
  const nearOf = (kind) => {
    if (!near.has(kind)) {
      const m = new Map();
      for (const k of (registers[kind] || new Map()).keys()) m.set(confusableKey(k), [...(m.get(confusableKey(k)) || []), k]);
      near.set(kind, m);
    }
    return near.get(kind);
  };
  return candidates.map((c) => {
    const reg = registers[c.kind] || new Map();
    const row = reg.get(c.key) || null;
    // A new number one OCR misread away from one the register holds.
    const suspect = c.ocr && !row ? (nearOf(c.kind).get(confusableKey(c.key)) || []).find((k) => k !== c.key) || null : null;
    const check = c.ocr ? [
      "خوانده‌شده با OCR",
      ...(c.ocr.conf < OCR_MIN_CONF ? [`اطمینان OCR ${Math.round(c.ocr.conf * 100)}٪`] : []),
      ...(c.ocr.read ? [`چاپ‌شده «${c.ocr.read}» خوانده شد`] : []),
      ...(suspect ? [`شاید همان ${suspect} در رجیستر`] : []),
    ] : [];
    const changes = [];
    for (const [attr, field] of Object.entries(FIELDS[c.kind] || {})) {
      const to = c.attrs[attr];
      if (!to || c.disagree[attr]) continue;
      const from = row ? row[field] ?? null : null;
      if (!row) changes.push({ attr, field, from: null, to });
      else if (from == null || from === "") changes.push({ attr, field, from: null, to, fill: true });
      else if (cmp(from) !== cmp(to)) changes.push({ attr, field, from, to, conflict: true });
    }
    const action = !row ? "new" : changes.some((x) => x.conflict) ? "conflict" : changes.length ? "update" : "same";
    return { kind: c.kind, key: c.key, action, targetId: row?.id ?? null, changes, attrs: c.attrs,
      disagree: c.disagree, where: c.where, confidence: c.ocr ? c.ocr.conf : null, ocrRead: c.ocr?.read ?? null,
      suspect, check, unknownCodes: c.unknownCodes || {} };
  });
}

export const ACTION_FA = { new: "تازه", update: "تکمیل", conflict: "تناقض", same: "بی‌تغییر" };
export { KINDS };
