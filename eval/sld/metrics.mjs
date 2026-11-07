/**
 * SLD evaluation metrics — precision / recall / F1 PER CATEGORY, never one number (the same discipline as eval/pid/metrics.mjs, whose pooling it reuses).
 * Categories: symbolDetection (a box matched), symbolClassification (matched AND the right class), textExtraction, tagExtraction, association (tag→symbol), ratingExtraction.
 * A value the engine did not give is a MISS (lowers recall); a wrong one is a false positive AND a miss.
 */
import { pool } from "../pid/metrics.mjs";
export { pool };

const counts = (tp, fp, fn) => ({ gold: tp + fn, predicted: tp + fp, tp, fp, fn });
const iou = (a, b) => { const i = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])); const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i; return u > 0 ? i / u : 0; };
const key = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9./]/g, "");

/** greedy one-to-one matching of predicted symbol boxes to gold boxes by IoU (highest first) */
export function matchBoxes(pred, gold, thr = 0.4) {
  const pairs = [];
  pred.forEach((p, i) => gold.forEach((g, j) => { if (p.page === g.page) { const v = iou(p.bboxPt, g.bbox); if (v >= thr) pairs.push([v, i, j]); } }));
  pairs.sort((a, b) => b[0] - a[0]);
  const pu = new Set(), gu = new Set(), match = [];
  for (const [, i, j] of pairs) if (!pu.has(i) && !gu.has(j)) { pu.add(i); gu.add(j); match.push([i, j]); }
  return match;
}

/** @returns per-category counts for one case */
export function scoreCase(items, gold) {
  const symbols = items.filter((i) => i.kind === "symbol" && !["junction"].includes(i.cls) || (i.kind === "symbol" && i.cls === "junction"));
  const gs = gold.symbols;
  const m = matchBoxes(symbols, gs);
  // detection counts every gold symbol (incl. UNKNOWN shapes: a shape that should be flagged) and every predicted symbol item
  const det = counts(m.length, symbols.length - m.length, gs.length - m.length);
  const clsOk = m.filter(([i, j]) => symbols[i].cls === gs[j].cls).length;
  const cls = counts(clsOk, m.length - clsOk + (symbols.length - m.length), gs.length - clsOk);
  const texts = items.filter((i) => i.kind === "text");
  const predText = new Map(); for (const t of texts) predText.set(key(t.textNormalized), (predText.get(key(t.textNormalized)) || 0) + 1);
  // text: gold words may be merged by the reader (33/11 + kV): a gold word counts as read when some predicted text contains it
  const joined = texts.map((t) => key(t.textNormalized));
  let ttp = 0; for (const g of gold.texts) if (joined.some((p) => p.includes(key(g)))) ttp++;
  const txt = counts(ttp, Math.max(0, texts.length - ttp), gold.texts.length - ttp);
  const predTags = texts.filter((t) => t.cls === "equipment_tag").map((t) => key(t.textNormalized));
  const goldTags = gold.tags.map(key);
  const gt = [...goldTags], used = new Set(); let tagTp = 0;
  for (const p of predTags) { const k = gt.findIndex((g, n) => g === p && !used.has(n)); if (k >= 0) { used.add(k); tagTp++; } }
  const tag = counts(tagTp, predTags.length - tagTp, goldTags.length - tagTp);
  // association: gold [tag, symbolId] — correct when the matched predicted symbol's tagCandidate has that text
  const byGold = new Map(m.map(([i, j]) => [gs[j].id, symbols[i]]));
  let atp = 0, afp = 0;
  for (const [t, sid] of gold.assoc) { const p = byGold.get(sid); const got = p?.attrs?.tagCandidate?.text; if (got && key(got) === key(t)) atp++; }
  for (const s of symbols) if (s.attrs?.tagCandidate) { const j = m.find(([i]) => symbols[i] === s)?.[1]; const gj = j === undefined ? null : gs[j].id; if (!gold.assoc.some(([t, sid]) => sid === gj && key(t) === key(s.attrs.tagCandidate.text))) afp++; }
  const assoc = counts(atp, afp, gold.assoc.length - atp);
  // ratings: gold [symbolId, "kind:value:unit"]
  const fmt = (r) => `${r.kind}:${JSON.stringify(r.value)}:${r.unit}`;
  let rtp = 0, rfp = 0;
  for (const [sid, want] of gold.ratings) { const p = byGold.get(sid); if (p?.attrs?.ratingCandidates?.some((r) => fmt(r) === want)) rtp++; }
  for (const s of symbols) { const j = m.find(([i]) => symbols[i] === s)?.[1]; const gj = j === undefined ? null : gs[j].id; for (const r of s.attrs?.ratingCandidates ?? []) if (!gold.ratings.some(([sid, w]) => sid === gj && w === fmt(r))) rfp++; }
  const rat = counts(rtp, rfp, gold.ratings.length - rtp);
  return { symbolDetection: det, symbolClassification: cls, textExtraction: txt, tagExtraction: tag, symbolToTagAssociation: assoc, ratingExtraction: rat };
}
