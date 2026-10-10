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
import { recognize, shapeOf, KINDS } from "./patterns.mjs";

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const cmp = (v) => norm(v).toUpperCase();

/** The register field each attribute fills, per kind. */
export const FIELDS = {
  equipment: { service: "description", subsystem: "subsystem_code" },
  line: { service: "service", class: "piping_class", subsystem: "subsystem_code" },
  instrument: { service: "service", subsystem: "subsystem_code" },
  subsystem: { system: "system_code" },
  system: {},
  drawing: {},
};
export const FIELD_FA = { service: "سرویس / شرح", class: "کلاس لوله", subsystem: "ساب‌سیستم", system: "سیستم" };

function add(map, kind, key, { attrs = {}, where = null }) {
  const k = `${kind}|${key}`;
  if (!map.has(k)) map.set(k, { kind, key, attrs: {}, where: [], disagree: {} });
  const c = map.get(k);
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
export function extract(read, { patterns, docNo }) {
  const map = new Map();
  const ambiguous = new Map();
  const unknownFormat = [];
  const shapeKinds = new Map();
  for (const p of patterns) shapeKinds.set(p.shape, [...new Set([...(shapeKinds.get(p.shape) || []), p.kind])]);
  const own = cmp(docNo);
  let docNoSeen = false;

  const scan = (text, where) => {
    if (own && cmp(text).includes(own)) docNoSeen = true;
    const r = recognize(text, patterns);
    for (const [kind, toks] of r.found) for (const t of toks.keys()) {
      if (kind === "drawing" && t === own) continue;
      add(map, kind, t, { where });
    }
    for (const [t, kinds] of r.ambiguous) ambiguous.set(t, kinds);
  };
  for (const p of read.pages || []) scan(p.text, `ص${p.n}`);

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
  return { candidates: [...map.values()], ambiguous: [...ambiguous].map(([token, kinds]) => ({ token, kinds })),
    unknownFormat, docNoSeen: own ? docNoSeen : null };
}

/**
 * Against the registers. registers[kind]: Map(KEY → row with the FIELDS
 * columns and `id`). Returns the proposal rows.
 */
export function diff(candidates, registers) {
  return candidates.map((c) => {
    const reg = registers[c.kind] || new Map();
    const row = reg.get(c.key) || null;
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
      disagree: c.disagree, where: c.where };
  });
}

export const ACTION_FA = { new: "تازه", update: "تکمیل", conflict: "تناقض", same: "بی‌تغییر" };
export { KINDS };
