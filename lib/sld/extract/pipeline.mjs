/**
 * Draft assembly (Phase 12.3): a page's words and primitives → items. Pure and deterministic: the same inputs give the same items, uids included.
 *
 *   buildPage({ page, words, prims, textSource, fileSha, ... }) → { items, warnings, stats }
 *
 * Observed facts (a word that was printed, a segment that was drawn) are kept apart from inferred candidates (a class, an association, a rating reading):
 * `basis: "observed" | "inferred"`. NOTHING is confirmed here — every item leaves as reviewStatus "unreviewed".
 */
import { createHash } from "node:crypto";
import { clampBox, normalize, box } from "./geometry.mjs";
import { normalizeText, textRoles } from "./text.mjs";
import { detectSymbols, RULES_VERSION } from "./classify.mjs";
import { associate, ASSOC_VERSION } from "./associate.mjs";
import { lineLen, bboxOfPrim } from "./primitives.mjs";
import { UNKNOWN, CLASS_IDS } from "./vocab.mjs";

export const ENGINE = Object.freeze({ name: "sld-extract", version: "1.0.0", rules: RULES_VERSION, association: ASSOC_VERSION });
const R2 = (n) => Math.round(n * 100) / 100;
const hex = (s) => createHash("sha256").update(s).digest("hex");
const UNITS = /^(?:kV|V|kVA|MVA|kW|MW|W|hp|A|kA|Hz|%|%Z|mm2|mm²|sqmm)$/i;
const NUMERIC = /^[+-]?\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?$/;

/** uid: stable across re-extraction of the same file with the same settings (position-based, NOT class-based, so a changed class keeps its identity) */
const uidOf = (fileSha, page, kind, b, text = "") => `sld:${hex(`${fileSha}|${page}|${kind}|${b.map((v) => R2(v)).join(",")}|${text}`).slice(0, 20)}`;

/** words → text blocks: a number followed by its unit on the same line (33/11 + kV) becomes one block; every other word stays alone */
export function textBlocks(words) {
  const sorted = [...words].sort((a, b) => a.b[1] - b.b[1] || a.b[0] - b.b[0]);
  const out = [], used = new Set();
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (used.has(w.id)) continue;
    const n = normalizeText(w.t);
    if (NUMERIC.test(n)) {
      const next = sorted.find((o) => o !== w && !used.has(o.id) && Math.abs(box.cy(o.b) - box.cy(w.b)) < 0.5 * box.h(w.b) && o.b[0] >= w.b[2] - 1 && o.b[0] - w.b[2] <= 0.8 * box.h(w.b) + 1 && UNITS.test(normalizeText(o.t)));
      if (next) { used.add(w.id); used.add(next.id); out.push({ id: `${w.id}+${next.id}`, parts: [w, next], t: `${w.t} ${next.t}`, b: box.union(w.b, next.b), src: w.src, c: Math.min(w.c ?? 1, next.c ?? 1) }); continue; }
    }
    used.add(w.id); out.push({ id: w.id, parts: [w], t: w.t, b: w.b, src: w.src, c: w.c ?? 1 });
  }
  return out;
}

export function buildPage({ page, words, prims, fileSha, maxConnectionLines = 2000 }) {
  const warnings = [], items = [];
  const wordsOk = words.map((w, i) => ({ ...w, id: w.id ?? `${w.src === "ocr" ? "ocr" : "pt"}${page.number}.${i}` }));
  const { symbols, usedPrims, conductors, scale } = detectSymbols({ page, prims, words: wordsOk });
  const primById = new Map(prims.map((p) => [p.id, p]));
  const primEv = (id) => { const p = primById.get(id); if (!p) return null; return { source: p.src === "vector" ? "vector_primitive" : "image_region", ref: id, page: page.number, bboxPt: bboxOfPrim(p).map(R2), detail: { type: p.type, ...(p.lw ? { lw: p.lw } : {}) } }; };
  const wordEvOf = (w) => ({ source: w.src === "ocr" ? "ocr_text_block" : "pdf_text_span", ref: w.id, page: page.number, bboxPt: w.b.map(R2), detail: { text: w.t, ...(w.src === "ocr" ? { confidence: w.c } : {}) } });
  const wordById = new Map(wordsOk.map((w) => [w.id, w]));

  const geom = (bb) => { const { box: c, clamped } = clampBox(bb, page); if (clamped) warnings.push({ code: "BBOX_CLAMPED", page: page.number }); return { bboxPt: c, bbox: normalize(c, page) }; };

  // text items
  const texts = [];
  for (const b of textBlocks(wordsOk)) {
    const r = textRoles(b.t), g = geom(b.b);
    const role = r.roles[0];
    const cls = role === "tag" ? "equipment_tag" : role === "voltage" ? "voltage_annotation" : role === "rating" ? "rating_annotation" : role === "cable" ? "cable_annotation" : role === "offpage" ? "offpage_reference" : "text_label";
    const nativeText = b.src !== "ocr";
    texts.push({ uid: uidOf(fileSha, page.number, "text", g.bboxPt, b.t), kind: "text", cls: cls === "offpage_reference" ? "text_label" : cls, page: page.number, ...g,
      text: b.t, textNormalized: r.normalized, roles: r.roles, ratingCandidates: r.ratings,
      confidence: R2(nativeText ? 1 : Math.max(0.05, Math.min(1, b.c))), confidenceBasis: nativeText ? "native-text-exact" : "ocr-word-confidence",
      method: nativeText ? "pdf-text" : "ocr", basis: "observed", classBasis: "inferred-from-text-pattern", evidence: b.parts.map(wordEvOf), alternatives: [], attrs: {}, warnings: [], associations: [], reviewStatus: "unreviewed",
      ...(r.roles.includes("offpage") ? { hints: ["offpage"] } : {}) });
  }

  // symbol items
  const symItems = symbols.map((s) => {
    const g = geom(s.bbox);
    const ev = [];
    for (const b of s.basis) { if (b.kind === "primitive") { const e = primEv(b.id); if (e) ev.push({ ...e, ...(b.note ? { note: b.note } : {}) }); } else if (b.kind === "word") { const w = wordById.get(b.id); if (w) ev.push(wordEvOf(w)); } }
    ev.push({ source: "symbol_detector", ref: s.rule, page: page.number, detail: { rule: s.rule, rules: RULES_VERSION } });
    const cls = CLASS_IDS.has(s.cls) ? s.cls : UNKNOWN;
    return { uid: uidOf(fileSha, page.number, "symbol", g.bboxPt), kind: "symbol", cls, page: page.number, ...g, text: null, confidence: s.confidence, confidenceBasis: "heuristic-rule-score", method: `geometry:${s.rule}`,
      basis: "inferred", classBasis: "inferred-from-shape", evidence: ev, alternatives: s.alternatives, attrs: s.attrs, warnings: s.warnings, associations: [], reviewStatus: "unreviewed" };
  });

  // conductors that no symbol used: connection lines (geometry only — no connectivity is concluded)
  const lineItems = [];
  const cl = conductors.filter((l) => lineLen(l) >= 6 * scale);
  for (const l of cl.slice(0, maxConnectionLines)) {
    const g = geom(bboxOfPrim(l));
    lineItems.push({ uid: uidOf(fileSha, page.number, "line", [l.x0, l.y0, l.x1, l.y1]), kind: "line", cls: "connection_line", page: page.number, ...g, text: null, confidence: 0.6, confidenceBasis: "observed-segment",
      method: "geometry:segment", basis: "observed", classBasis: "inferred-from-shape", evidence: [primEv(l.id)].filter(Boolean), alternatives: [], attrs: { x0: R2(l.x0), y0: R2(l.y0), x1: R2(l.x1), y1: R2(l.y1), width: l.lw ?? null }, warnings: [], associations: [], reviewStatus: "unreviewed" });
  }
  if (cl.length > maxConnectionLines) warnings.push({ code: "CONNECTION_LINES_TRUNCATED", page: page.number, found: cl.length, kept: maxConnectionLines });

  // association
  const { links, primaryTag } = associate(symItems.map((s) => ({ uid: s.uid, cls: s.cls, bbox: s.bboxPt })), texts.map((t) => ({ uid: t.uid, roles: t.roles, bbox: t.bboxPt })), { scale });
  const symByUid = new Map(symItems.map((s) => [s.uid, s])), txtByUid = new Map(texts.map((t) => [t.uid, t]));
  for (const l of links) {
    const t = txtByUid.get(l.textUid), s = symByUid.get(l.symbolUid);
    const a = { textUid: l.textUid, symbolUid: l.symbolUid, method: l.method, relation: l.relation, gap: l.gap, score: l.score, rank: l.rank, status: l.status, roles: t.roles };
    s.associations.push(a); t.associations.push(a);
  }
  for (const s of symItems) {
    const tagUid = primaryTag.get(s.uid);
    if (tagUid) s.attrs.tagCandidate = { textUid: tagUid, text: txtByUid.get(tagUid).text, status: "unconfirmed" };
    s.attrs.ratingCandidates = [];
    for (const a of s.associations) {
      if (a.status !== "candidate" && a.status !== "ambiguous") continue;
      const t = txtByUid.get(a.textUid);
      for (const r of t.ratingCandidates) s.attrs.ratingCandidates.push({ ...r, textUid: a.textUid, association: a.status, status: "unconfirmed" });
    }
    if (!s.attrs.ratingCandidates.length) delete s.attrs.ratingCandidates;
    if (s.associations.some((a) => a.status === "ambiguous" && a.roles.includes("tag"))) s.warnings.push("AMBIGUOUS_TAG_ASSOCIATION");
  }
  for (const t of texts) if (t.roles.some((r) => ["tag"].includes(r)) && !t.associations.length) t.warnings.push("TAG_WITHOUT_SYMBOL");
  // a tag printed more than once on the page
  const seen = new Map();
  for (const t of texts) if (t.roles.includes("tag")) seen.set(t.textNormalized, [...(seen.get(t.textNormalized) || []), t]);
  for (const [, v] of seen) if (v.length > 1) for (const t of v) t.warnings.push("DUPLICATE_TAG_ON_PAGE");

  items.push(...symItems, ...lineItems, ...texts);
  const stats = { symbols: symItems.filter((s) => s.cls !== UNKNOWN).length, unknown: symItems.filter((s) => s.cls === UNKNOWN).length, texts: texts.length, lines: lineItems.length, links: links.length };
  return { items, warnings, stats };
}
