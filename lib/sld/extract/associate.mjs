/**
 * Symbol ↔ text association (Phase 12.3). Pure. Every link is a CANDIDATE with its method and score; ambiguity is kept, not resolved:
 *   · a text that is about as near to two symbols is linked to BOTH, flagged ambiguous, and is the primary tag of neither;
 *   · a symbol with two competing tag texts has no primary tag;
 *   · a text no symbol is near stays on the page, unassociated; the source text is never changed.
 * Nearness is a reading aid, NOT a connection: nothing here says two pieces of equipment are wired together.
 */
import { box } from "./geometry.mjs";

export const ASSOC_VERSION = "sld-assoc/1";
const MARGIN = 1.35;                                    // best score must beat the runner-up by this factor to be "unique"
const R2 = (n) => Math.round(n * 1000) / 1000;
const ASSOCIABLE = new Set(["tag", "voltage", "rating", "cable", "device_code"]);

function relation(sb, tb) {
  if (box.contains(sb, tb, 0.5)) return "inside";
  const dx = box.cx(tb) - box.cx(sb), dy = box.cy(tb) - box.cy(sb);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "below" : "above");
}

/**
 * @param symbols  [{ uid, cls, bbox }]                 (connection lines and junctions are not associable)
 * @param texts    [{ uid, roles, bbox, ... }]
 * @returns { links: [{ textUid, symbolUid, method, relation, gap, score, rank, status }], primaryTag: Map<symbolUid,textUid> }
 */
export function associate(symbols, texts, { scale = 1 } = {}) {
  const targets = symbols.filter((s) => !["connection_line", "junction", "panel_switchgear", "ground"].includes(s.cls));
  const links = [];
  for (const t of texts) {
    if (!t.roles.some((r) => ASSOCIABLE.has(r))) continue;
    const cand = [];
    for (const s of targets) {
      const size = Math.min(Math.max(box.w(s.bbox), box.h(s.bbox)), 30 * scale);       // a long bar does not reach further for being long
      const reach = s.cls === "busbar" ? 14 * scale : Math.max(2.5 * size, 28 * scale);
      const gap = box.gap(s.bbox, t.bbox);
      if (gap > reach) continue;
      const rel = relation(s.bbox, t.bbox);
      const score = Math.exp(-gap / (0.6 * reach)) * (rel === "inside" ? 1.25 : 1) * (rel === "above" || rel === "below" || rel === "right" ? 1 : 0.9);
      cand.push({ s, gap, rel, score });
    }
    cand.sort((a, b) => b.score - a.score);
    const unique = cand.length === 1 || (cand.length > 1 && cand[0].score >= MARGIN * cand[1].score);
    cand.forEach((c, i) => links.push({ textUid: t.uid, symbolUid: c.s.uid, method: c.rel === "inside" ? "contained" : "proximity", relation: c.rel, gap: R2(c.gap), score: R2(c.score), rank: i + 1,
      status: unique && i === 0 ? "candidate" : "ambiguous" }));
  }
  // a primary tag exists only where one tag text is that symbol's unique best AND no other tag text also claims the symbol
  const tagRoleOf = new Map(texts.map((t) => [t.uid, t.roles.includes("tag")]));
  const claims = new Map();
  for (const l of links) if (l.rank === 1 && l.status === "candidate" && tagRoleOf.get(l.textUid)) claims.set(l.symbolUid, [...(claims.get(l.symbolUid) || []), l.textUid]);
  const primaryTag = new Map([...claims].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
  return { links, primaryTag };
}
