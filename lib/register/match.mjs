/**
 * Matching one revision's weld register against another's.
 *
 * WHY THIS REPLACES A DERIVED IDENTITY
 *
 * The backlog asked for a `weld_uid` computed from the line, the joint kind
 * and the position on the route. Every purely derived identity fails one of
 * the two things that actually happen between revisions:
 *
 *   - derive it from the weld NUMBER and a fitting inserted upstream
 *     renumbers everything downstream, so welds that never moved look new;
 *   - derive it from the POSITION and a corrected running dimension shifts
 *     the whole route, so again everything looks new.
 *
 * There is no formula that survives both, because the question "is this the
 * same weld" is not a property of one weld — it is a relationship between two
 * registers. So identity here is a surrogate: minted once, then carried
 * forward by matching. The matching is this file, and it is the same
 * computation that produces the revision diff. One mechanism, two outputs.
 *
 * ANCHORS
 *
 * Tie-in points are the one thing on an isometric that is contractual: their
 * coordinates are printed and their continuation drawing number is a
 * reference to a specific other sheet. So a tie-in whose `role` matches is
 * treated as near-certain, and the offset between a matched pair of tie-ins
 * is used to align the two registers before any distance is measured. That is
 * what makes a revision that only re-datumed the drawing a no-op instead of a
 * complete rewrite.
 */

/** Weight table, kept in one place so tuning it is a visible decision. */
export const WEIGHTS = {
  anchorRole: 100,   // a tie-in continuation reference — the strongest signal there is
  distExact: 60,     // within 2 mm after alignment: the same point
  distClose: 40,     // within 50 mm: a rounding or a pup tweak
  distNear: 25,      // within 500 mm: a local dimension correction
  distFar: 10,       // within 2 m: same neighbourhood, probably
  kind: 20,
  nps: 15,
  role: 10,
  ordinal: 8,        // same index from either end of the register
};

/** Below this, two rows are not the same weld however many weak signals agree. */
export const MIN_SCORE = 45;

const isAnchor = (row) => row.kind === "Tie-in";
const dist = (a, b, shift) => Math.hypot(
  a.pos.e - (b.pos.e + shift.e), a.pos.n - (b.pos.n + shift.n), a.pos.el - (b.pos.el + shift.el));

/**
 * The translation that puts `b`'s frame onto `a`'s.
 *
 * Taken from the first tie-in whose continuation reference appears in both
 * registers. A drawing re-issued against a different datum shifts every
 * coordinate by the same amount, and without this every weld on the sheet
 * would be reported as removed and re-added.
 */
export function alignmentShift(a, b) {
  for (const x of a.filter(isAnchor)) {
    const y = b.find((row) => isAnchor(row) && row.role && row.role === x.role);
    if (y) return { e: x.pos.e - y.pos.e, n: x.pos.n - y.pos.n, el: x.pos.el - y.pos.el, from: x.role };
  }
  return { e: 0, n: 0, el: 0, from: null };
}

export function scorePair(x, y, shift, { ordinalHint = false } = {}) {
  let s = 0;
  if (isAnchor(x) && isAnchor(y) && x.role && x.role === y.role) s += WEIGHTS.anchorRole;

  const d = dist(x, y, shift);
  if (d <= 2) s += WEIGHTS.distExact;
  else if (d <= 50) s += WEIGHTS.distClose;
  else if (d <= 500) s += WEIGHTS.distNear;
  else if (d <= 2000) s += WEIGHTS.distFar;

  if (x.kind === y.kind) s += WEIGHTS.kind;
  if (Number(x.nps) === Number(y.nps)) s += WEIGHTS.nps;
  if (x.role && x.role === y.role) s += WEIGHTS.role;
  if (ordinalHint) s += WEIGHTS.ordinal;
  return s;
}

/**
 * Greedy best-first matching.
 *
 * Greedy rather than optimal on purpose: a register is tens of rows, the
 * scores are far apart when a match is real, and an engineer reading the diff
 * can follow "the best remaining pair, then the next" in a way they cannot
 * follow a global assignment. Each row is used at most once.
 *
 * @returns {{pairs: Array<{from, to, score}>, onlyFrom: Array, onlyTo: Array, shift: object}}
 */
export function matchRegisters(fromRows, toRows, { minScore = MIN_SCORE } = {}) {
  const shift = alignmentShift(fromRows, toRows);

  const lastFrom = fromRows.length - 1, lastTo = toRows.length - 1;
  const candidates = [];
  fromRows.forEach((x, i) => {
    toRows.forEach((y, j) => {
      const ordinalHint = i === j || (lastFrom - i) === (lastTo - j);
      const score = scorePair(x, y, shift, { ordinalHint });
      if (score >= minScore) candidates.push({ i, j, score });
    });
  });

  // Ties broken by ordinal closeness so the result does not depend on input order.
  candidates.sort((p, q) => q.score - p.score || (Math.abs(p.i - p.j) - Math.abs(q.i - q.j)));

  const usedFrom = new Set(), usedTo = new Set(), pairs = [];
  for (const c of candidates) {
    if (usedFrom.has(c.i) || usedTo.has(c.j)) continue;
    usedFrom.add(c.i);
    usedTo.add(c.j);
    pairs.push({ from: fromRows[c.i], to: toRows[c.j], score: c.score });
  }

  return {
    pairs,
    onlyFrom: fromRows.filter((_, i) => !usedFrom.has(i)),
    onlyTo: toRows.filter((_, j) => !usedTo.has(j)),
    shift,
  };
}
