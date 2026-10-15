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
import { designConditions, totalWeight, structureTypeOf } from "./datasheet.mjs";
import { parseCableSchedule } from "../electrical/cable.mjs";

/**
 * Below this OCR confidence a number is flagged as read unsurely. Every
 * number OCR proposes to ADD or CHANGE is "to be checked" whatever its
 * confidence: on the test scan Tesseract read every number right with word
 * confidences from 0.28 to 0.97, so confidence cannot vouch for a value.
 */
export const OCR_MIN_CONF = 0.6;

const up = (v) => String(v ?? "").trim().toUpperCase();
const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const cmp = (v) => norm(v).toUpperCase();
// 25 and "25.00" are the same value: numbers compare as numbers
const same = (a, b) => {
  const x = norm(a), y = norm(b);
  if (x !== "" && y !== "" && Number.isFinite(Number(x)) && Number.isFinite(Number(y))) return Number(x) === Number(y);
  return cmp(x) === cmp(y);
};

/** The register field each attribute fills, per kind. */
export const FIELDS = {
  equipment: { service: "description", subsystem: "subsystem_code" },
  line: { service: "service", class: "piping_class", subsystem: "subsystem_code", fluid: "fluid_code", insulation: "insulation" },
  instrument: { service: "service", subsystem: "subsystem_code" },
  subsystem: { system: "system_code" },
  system: {},
  cable: { from: "from_ref", to: "to_ref", spec: "cable_spec", length: "length_m" },
  structure: { type: "structure_type", tonnage: "tonnage_t", drawing: "drawing_ref" },
  design: { pressure: "design_pressure_barg", tmin: "design_temp_min_c", tmax: "design_temp_max_c" },
  drawing: {},
};
export const FIELD_FA = { service: "سرویس / شرح", class: "کلاس لوله", subsystem: "ساب‌سیستم", system: "سیستم", fluid: "کد سیال", insulation: "کد عایق",
  from: "از", to: "به", spec: "نوع کابل", length: "طول (m)", type: "نوع سازه", tonnage: "وزن (t)", drawing: "نقشه",
  pressure: "فشار طراحی (barg)", tmin: "کمینهٔ دمای طراحی (°C)", tmax: "بیشینهٔ دمای طراحی (°C)" };

/**
 * ocr: how this sighting was read — null for a text layer or a table;
 * { conf, read } for OCR (read: the characters printed, when the shapes
 * swapped a confusable one). A number seen once without OCR is not an OCR
 * number; otherwise its best OCR reading counts.
 */
function add(map, kind, key, { attrs = {}, where = null, ocr = null, unknown = null, notes = [] }) {
  const k = `${kind}|${key}`;
  if (!map.has(k)) map.set(k, { kind, key, attrs: {}, where: [], disagree: {}, ocr: undefined, unknownCodes: {}, notes: [] });
  const c = map.get(k);
  for (const n of notes) if (!c.notes.includes(n)) c.notes.push(n);
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
    if (c.attrs[a] && !same(c.attrs[a], val)) {
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
export function extract(read, { patterns, docNo, lineFormat = null, codes = {}, docTag = null }) {
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

  // ── phase 3: what the document states about one item ──────────────────
  const notes = [];
  const allText = [...(read.pages || []).map((p) => p.text), read.text || ""].join("\n");
  const anyOcr = (read.pages || []).some((p) => p.words);
  const docOcr = anyOcr ? { conf: Math.min(...read.pages.filter((p) => p.words && p.conf != null).map((p) => p.conf), 1) } : null;
  // A datasheet's design conditions belong to the tag its document is registered against — never to a tag guessed from the text.
  if (/DESIGN\s+(PRESS|TEMP)|\bMDMT\b/i.test(allText)) {
    const d = designConditions(allText);
    if (!docTag) notes.push("این مدرک شرایط طراحی دارد ولی در رجیستر مدارک به هیچ تگ تجهیزی وصل نیست — شرایط طراحی خوانده نشد. مدرک را به تگش وصل کنید و دوباره بخوانید.");
    else if (d.pressure != null || d.tmin != null || d.tmax != null || d.problems.length) {
      add(map, "design", up(docTag), { attrs: { pressure: d.pressure, tmin: d.tmin, tmax: d.tmax }, where: "دیتاشیت", ocr: docOcr, notes: d.problems });
    }
  }
  // Cable schedules: every sheet whose header names a cable-number column.
  for (const sh of read.sheets || []) {
    // the header is the first of the sheet's top rows that names a cable-number column (a title row above it is common)
    const lines = sh.tsv.split("\n");
    let parsed = null;
    for (let h = 0; h < Math.min(15, lines.length) && !parsed; h++) {
      const p = parseCableSchedule(lines.slice(h).join("\n"));
      if ("cableNo" in p.columns && Object.keys(p.columns).length >= 2) parsed = p;
    }
    if (!parsed) continue;
    for (const r of parsed.rows) {
      add(map, "cable", r.cableNo, { attrs: { from: r.from, to: r.to, spec: r.spec, length: r.lengthM }, where: sh.name,
        notes: parsed.problems.filter((x) => x.cableNo === r.cableNo).map((x) => x.text) });
    }
  }
  // A structural drawing: its weight and type go to the structure only when it shows exactly one.
  const structures = [...map.values()].filter((c) => c.kind === "structure");
  const weight = totalWeight(allText);
  if (structures.length === 1) {
    const st = structures[0];
    const type = structureTypeOf(allText);
    if (weight && typeof weight === "number") st.attrs.tonnage = String(weight);
    if (weight?.conflict) st.notes.push(`وزن کل چند بار با مقدار متفاوت آمده (${weight.conflict.join(" / ")} t) — پر نشد`);
    if (type) st.attrs.type = type;
    if (docNo) st.attrs.drawing = up(docNo);
  } else if (structures.length > 1 && weight) {
    notes.push(`نقشه ${structures.length} سازه را نشان می‌دهد؛ وزن کل به هیچ‌کدام نسبت داده نشد.`);
  }

  for (const c of map.values()) if (c.ocr === undefined) c.ocr = null;
  return { candidates: [...map.values()], notes, ambiguous: [...ambiguous].map(([token, kinds]) => ({ token, kinds })),
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
      else if (!same(from, to)) changes.push({ attr, field, from, to, conflict: true });
    }
    const action = !row ? "new" : changes.some((x) => x.conflict) ? "conflict" : changes.length ? "update" : "same";
    return { kind: c.kind, key: c.key, action, targetId: row?.id ?? null, changes, attrs: c.attrs,
      disagree: c.disagree, where: c.where, confidence: c.ocr ? c.ocr.conf : null, ocrRead: c.ocr?.read ?? null,
      suspect, check, unknownCodes: c.unknownCodes || {}, notes: c.notes || [] };
  });
}

export const ACTION_FA = { new: "تازه", update: "تکمیل", conflict: "تناقض", same: "بی‌تغییر" };
export { KINDS };
