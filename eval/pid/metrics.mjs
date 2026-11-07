/**
 * Category metrics for the P&ID reading (pure). Reported SEPARATELY, never as one overall score:
 *   precision = correct / predicted, recall = correct / gold, F1; a value the reader did not give is a MISS (it lowers recall), never "correct";
 *   falsePositiveRate = predicted items that are not in the gold / predicted items (a wrong tag is a false positive AND a miss).
 * Nothing is invented to improve recall: an unread item stays unread.
 */
const key = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function setMetrics(predicted, gold) {
  const P = new Set(predicted.map(key)), G = new Set(gold.map(key));
  const tp = [...P].filter((x) => G.has(x)).length;
  const fp = P.size - tp, fn = G.size - tp;
  return { gold: G.size, predicted: P.size, tp, fp, fn,
    precision: P.size ? tp / P.size : null, recall: G.size ? tp / G.size : null,
    f1: tp ? (2 * tp) / (P.size + G.size) : (P.size || G.size ? 0 : null), falsePositiveRate: P.size ? fp / P.size : null };
}

const pairKey = ([a, b, t]) => `${[key(a), key(b)].sort().join("~")}|${t}`;
export const edgeMetrics = (predicted, gold) => setMetrics(predicted.map(pairKey), gold.map(pairKey));

/** Off-page resolution: per connector, the predicted status against the gold. A wrong "resolved" is a false positive; "unresolved" where the gold is resolved is a miss. */
export function offpageMetrics(predicted, gold) {
  const p = new Map(predicted.map((o) => [key(o.ref), o.status])), g = new Map(gold.map((o) => [key(o.ref), o.resolution]));
  let correct = 0, wrongResolved = 0, missed = 0;
  for (const [ref, res] of g) {
    const got = p.get(ref);
    if (got === res || (res === "resolved" && got === "resolved")) correct++;
    else if (got === "resolved" && res !== "resolved") wrongResolved++;
    else if (res === "resolved") missed++;
  }
  return { gold: g.size, correct, wrongResolved, missed, accuracy: g.size ? correct / g.size : null, falseResolutionRate: g.size ? wrongResolved / g.size : null };
}

/** Pool counts across cases for one category (so a rate is computed over all the items, not averaged over cases). */
export function pool(list) {
  const s = list.reduce((t, m) => ({ gold: t.gold + m.gold, predicted: t.predicted + (m.predicted ?? 0), tp: t.tp + (m.tp ?? 0), fp: t.fp + (m.fp ?? 0), fn: t.fn + (m.fn ?? 0) }), { gold: 0, predicted: 0, tp: 0, fp: 0, fn: 0 });
  return { ...s, precision: s.predicted ? s.tp / s.predicted : null, recall: s.gold ? s.tp / s.gold : null, f1: s.tp ? (2 * s.tp) / (s.predicted + s.gold) : (s.predicted || s.gold ? 0 : null), falsePositiveRate: s.predicted ? s.fp / s.predicted : null };
}
