/**
 * The P&ID draft: the data contract between a READING of a drawing (OCR, a vision model, a person) and the engineering registers
 * (docs/audit/phase-11-pid-intelligence.md). Pure; no database; runs in the browser and on the server.
 *
 *   A draft is what a reader PROPOSED, with its evidence. It is never an approved record: every item starts `extracted`, a proposal cannot
 *   carry a review status, and only a person's explicit action (lib/pid/review.mjs) moves an item on. Nothing here is inferred:
 *     · an equipment's symbol is never taken from its tag's letters (a tag prefix is not a symbol) — a legend hint is kept apart (`attrs.legendType`);
 *     · a missing value stays null; a symbol that cannot be identified stays "UNKNOWN";
 *     · two symbols being close, or two line numbers looking alike, never makes a connection (lib/pid/graph.mjs).
 *
 * Contract (payload of an extraction_run with pass_name 'pid'):
 *   { kind: "pid", schema: 1,
 *     meta:   { drawingNo, revision, title, unit, area, system, sheet, notes[], legendRefs[], relatedDrawings[] }          // pass A
 *     page:   { number, width, height }                                  original page size, in the units of the reader (OCR px / pt)
 *     items:  [Item]   edges: [Edge]   mappings: [{ fromUid, toUid, by, at }]   (target-side, explicit)
 *     source: { kind: "ocr"|"vision"|"mixed"|"user", reader, hash, generatedAt } }
 *   Item:  { uid, cls, symbol, tag, printed, bbox:{x0,y0,x1,y1}|null  (normalized 0..1), center:{x,y}|null, page, ocrText, confidence|null,
 *            attrs, source:{kind, ref}, evidence:[{kind, text, bbox, confidence}], review:{status, original?, corrected?, by?, at?, reason?} }
 *   Edge:  { uid, type, from, to|null, ref, evidence[], status, candidates?[], review }
 */
import { newUid, isUid } from "../sheet/mark-identity.mjs";
import { parseTag } from "../instrumentation/isa.mjs";
import { dedupe, equipmentTags, lineNumbers, sheetRefs, instrumentsFromBubbles } from "./ocr-parse.mjs";
import { createHash } from "node:crypto";

const text = (v) => String(v ?? "").trim();

import { CLASSES, EDGE_TYPES, REVIEW, SYMBOLS, UNKNOWN, instrumentFacts } from "./vocab.mjs";
export { CLASSES, EDGE_TYPES, REVIEW, SYMBOLS, UNKNOWN, instrumentFacts };
const clamp01 = (n) => (Number.isFinite(Number(n)) ? Math.min(1, Math.max(0, Number(n))) : null);

/** A box in page units → normalized, with the page's own size kept in the draft; null when it is not a usable box. */
export function normBox(b, W, H) {
  if (!Array.isArray(b) && !(b && typeof b === "object")) return null;
  const [x0, y0, x1, y1] = Array.isArray(b) ? b.map(Number) : [b.x0, b.y0, b.x1, b.y1].map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite) || !(W > 0) || !(H > 0)) return null;
  const n = { x0: clamp01(Math.min(x0, x1) / W), y0: clamp01(Math.min(y0, y1) / H), x1: clamp01(Math.max(x0, x1) / W), y1: clamp01(Math.max(y0, y1) / H) };
  return n.x1 > n.x0 && n.y1 > n.y0 ? n : null;
}
export const centerOf = (bb) => (bb ? { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 } : null);

const emptyMeta = () => ({ drawingNo: null, revision: null, title: null, unit: null, area: null, system: null, sheet: null, notes: [], legendRefs: [], relatedDrawings: [] });

export function emptyDraft({ page = { number: 1, width: 0, height: 0 }, meta = {}, source = {} } = {}) {
  return { kind: "pid", schema: 1, meta: { ...emptyMeta(), ...meta }, page, items: [], edges: [], mappings: [], source: { kind: "user", reader: null, hash: null, generatedAt: null, ...source } };
}

/** A review state a reader may NOT choose: whatever it sends, a new item is `extracted`. */
const freshReview = () => ({ status: "extracted" });

/** Make one item from a raw proposal (a reader's output). Returns { item } or { rejected: reason }. */
export function sanitizeItem(raw, { page = { number: 1, width: 0, height: 0 }, source = { kind: "vision", reader: null }, pageNumber = null } = {}) {
  if (!raw || typeof raw !== "object") return { rejected: "not an object" };
  const cls = text(raw.cls);
  if (!CLASSES.includes(cls)) return { rejected: `unknown class «${cls}»` };
  const sym = text(raw.symbol);
  const symbol = SYMBOLS[cls]?.includes(sym) ? sym : UNKNOWN;
  const W = Number(page.width), H = Number(page.height);
  // a reader may hand a normalized box ({x0..y1} in 0..1) or a box in page units; both end up normalized
  const given = raw.bbox;
  const looksNorm = given && typeof given === "object" && !Array.isArray(given) && [given.x0, given.y0, given.x1, given.y1].every((v) => Number(v) >= 0 && Number(v) <= 1);
  const bbox = looksNorm ? normBox(given, 1, 1) : normBox(given, W, H);
  const ev = (Array.isArray(raw.evidence) ? raw.evidence : []).map((e) => ({
    kind: ["ocr", "vision", "geometry", "user"].includes(e?.kind) ? e.kind : source.kind === "ocr" ? "ocr" : "vision",
    text: text(e?.text), bbox: e?.bbox ? (looksNorm ? normBox(e.bbox, 1, 1) : normBox(e.bbox, W, H)) : null, confidence: clamp01(e?.confidence),
  })).filter((e) => e.text || e.bbox);
  const attrs = raw.attrs && typeof raw.attrs === "object" && !Array.isArray(raw.attrs) ? JSON.parse(JSON.stringify(raw.attrs)) : {};
  const item = {
    uid: newUid(), cls, symbol, tag: text(raw.tag) || null, printed: text(raw.printed) || text(raw.tag) || null,
    bbox, center: centerOf(bbox) || (raw.center && Number.isFinite(Number(raw.center.x)) && Number.isFinite(Number(raw.center.y)) ? { x: clamp01(raw.center.x), y: clamp01(raw.center.y) } : null),
    page: Number.isInteger(pageNumber) ? pageNumber : Number(page.number) || 1, ocrText: text(raw.ocrText) || null, confidence: clamp01(raw.confidence),
    attrs, source: { kind: source.kind, ref: text(raw.sourceRef) || source.reader || null }, evidence: ev, review: freshReview(),
  };
  return { item };
}

/** Sanitize a reader's whole proposal: items by class rules, edges only with explicit evidence and known endpoints. Nothing it returns is approved. */
export function sanitizeProposal(proposal, { page, meta = {}, source = { kind: "vision", reader: null } } = {}) {
  const d = emptyDraft({ page, meta: { ...meta, ...(proposal?.meta || {}) }, source: { kind: source.kind, reader: source.reader || null } });
  const rejected = [], idOf = new Map();
  for (const [i, r] of (Array.isArray(proposal?.items) ? proposal.items : []).entries()) {
    const { item, rejected: why } = sanitizeItem(r, { page, source });
    if (why) { rejected.push({ index: i, kind: "item", why }); continue; }
    d.items.push(item);
    if (r.id != null) idOf.set(String(r.id), item.uid);              // the reader's own handle, only to resolve its edges
  }
  for (const [i, r] of (Array.isArray(proposal?.edges) ? proposal.edges : []).entries()) {
    const type = text(r?.type), from = idOf.get(String(r?.from)) || null, to = r?.to == null ? null : idOf.get(String(r.to)) || null;
    const ev = (Array.isArray(r?.evidence) ? r.evidence : []).map((e) => ({ kind: ["ocr", "vision", "geometry", "user"].includes(e?.kind) ? e.kind : "vision", text: text(e?.text), bbox: null, confidence: clamp01(e?.confidence) })).filter((e) => e.text);
    if (!EDGE_TYPES.includes(type)) { rejected.push({ index: i, kind: "edge", why: `unknown edge type «${type}»` }); continue; }
    if (!from) { rejected.push({ index: i, kind: "edge", why: "start is not an item of this proposal" }); continue; }
    if (r?.to != null && !to) { rejected.push({ index: i, kind: "edge", why: "end is not an item of this proposal" }); continue; }
    // an edge without printed/seen evidence is a guess: it is not filed (a reader that only saw two symbols near each other has no edge to propose)
    if (!ev.length) { rejected.push({ index: i, kind: "edge", why: "no evidence" }); continue; }
    d.edges.push({ uid: newUid(), type, from, to, ref: text(r?.ref) || null, evidence: ev, status: to ? "explicit" : "unresolved", review: freshReview() });
  }
  d.source.hash = hashOf({ meta: d.meta, items: d.items.map((x) => [x.cls, x.symbol, x.tag, x.bbox]), edges: d.edges.map((x) => [x.type, x.from, x.to]) });
  return { draft: d, rejected };
}

export function hashOf(v) { return createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32); }

/**
 * The deterministic reading: a sheet's OCR items (tools/pid-ocr.py: {t, b:[x0,y0,x1,y1], c}) and its instrument bubbles → a draft, with the
 * BOX of every label kept as evidence (lib/pid/ocr-parse.mjs reads the text; it drops where). Same readers as the registers: equipmentTags,
 * lineNumbers, sheetRefs, instrumentsFromBubbles. A tag is read, a symbol is not: every equipment symbol is "UNKNOWN" until a symbol reader or
 * a person says otherwise.
 */
export function draftFromOcr({ page = 1, w: W, h: H, items: raw = [] }, bubbles = null, { meta = {}, reader = "rapidocr" } = {}) {
  const pg = { number: page, width: W, height: H };
  const d = emptyDraft({ page: pg, meta, source: { kind: "ocr", reader } });
  const items = dedupe((raw || []).filter((it) => it && Array.isArray(it.b) && it.c >= 0.5));
  const mk = (cls, it, extra) => {
    const bbox = normBox(it.b, W, H);
    return { uid: newUid(), cls, symbol: UNKNOWN, tag: null, printed: null, bbox, center: centerOf(bbox), page, ocrText: it.t, confidence: clamp01(it.c), attrs: {},
      source: { kind: "ocr", ref: reader }, evidence: [{ kind: "ocr", text: it.t, bbox, confidence: clamp01(it.c) }], review: freshReview(), ...extra };
  };
  // Two readings of one place (the OCR reads overlapping tiles) are one label. Same rule as the register reader (lib/pid/ocr-parse.mjs parseSheet): when
  // one says more («30 S 1401 A/B» over «30S 1401») the longer one is kept; when they say DIFFERENT things (an underlined «30 C 1701 B» read
  // «30C1701I» and «30C1701F») the suffix is not known and neither is filed — the clash is named in `source.problems`, not guessed.
  const overlap = (a, b) => { const x0 = Math.max(a.b[0], b.b[0]), y0 = Math.max(a.b[1], b.b[1]), x1 = Math.min(a.b[2], b.b[2]), y1 = Math.min(a.b[3], b.b[3]); const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); const u = (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]) + (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]) - i; return u > 0 ? i / u : 0; };
  const base = (t) => (t.match(/^\d{2}-[A-Z]{1,3}-\d{4}/) || [t])[0];
  const readings = items.map((it) => ({ it, tags: equipmentTags(it.t) })).filter((r) => r.tags.length);
  const within = (a, b) => a.every((t) => b.includes(t) || b.some((u) => u !== t && u.startsWith(t)));
  const problems = [];
  const placed = [];
  for (const r of readings) for (const e of r.tags) {
    const mine = r.tags.filter((t) => base(t.tag) === base(e.tag)).map((t) => t.tag);
    let shorter = false, clash = null;
    for (const o of readings.filter((o) => o !== r && overlap(o.it, r.it) > 0.35)) {
      const theirs = o.tags.filter((t) => base(t.tag) === base(e.tag)).map((t) => t.tag);
      if (!theirs.length || theirs.join() === mine.join()) continue;
      if (within(mine, theirs)) shorter = true; else if (!within(theirs, mine)) clash = o;
    }
    if (clash) { const say = `«${r.it.t}» / «${clash.it.t}»: دو خوانش از یک جای نقشه تگ‌های متفاوت ساختند — ثبت نشد`; if (!problems.includes(say)) problems.push(say); continue; }
    if (shorter) continue;
    // the same tag read twice at (nearly) the same place is one label: the more confident reading was filed first (items are sorted by confidence)
    if (placed.some((x) => x.tag === e.tag && overlap(x, r.it) > 0.35)) continue;
    placed.push({ tag: e.tag, b: r.it.b });
    d.items.push(mk("equipment", r.it, { tag: e.tag, printed: e.printed }));
  }
  d.source.problems = problems;
  for (const it of items) {
    for (const l of lineNumbers(it.t)) d.items.push(mk("line", it, { tag: l.lineNo, printed: l.printed, attrs: { lineNo: l.lineNo, size: l.size, pipingClass: l.pipingClass, fluid: l.fluid, insulation: l.insulation, trace: l.kind !== "main" ? l.kind : null } }));
    for (const r of sheetRefs(it.t)) d.items.push(mk("connector", it, { symbol: "offpage", tag: null, printed: it.t, attrs: { targetSheet: r } }));
  }
  const { instruments: bi } = bubbles ? instrumentsFromBubbles(bubbles) : { instruments: [] };
  for (const i of bi) {
    const c = Array.isArray(i.at) ? { x: clamp01(i.at[0] / W), y: clamp01(i.at[1] / H) } : null;
    d.items.push({ uid: newUid(), cls: "instrument", symbol: "bubble", tag: i.tag, printed: i.tag, bbox: null, center: c, page, ocrText: i.tag, confidence: null,
      attrs: { letters: i.letters, loop: i.loop, category: i.category, sixDigits: i.sixDigits }, source: { kind: "ocr", ref: "bubbles" },
      evidence: [{ kind: "geometry", text: `bubble ${i.letters}/${i.number}`, bbox: null, confidence: null }], review: freshReview() });
  }
  d.source.hash = hashOf({ page: pg, t: items.map((x) => [x.t, x.b.map(Math.round)]), b: (bubbles || []).length });
  return d;
}

export const isItem = (x) => x && isUid(x.uid) && CLASSES.includes(x.cls);
