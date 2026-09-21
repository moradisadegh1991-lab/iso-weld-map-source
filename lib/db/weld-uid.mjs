/**
 * Stable identity for a weld across drawing revisions.
 *
 * PROVISIONAL — EPIC-2 story 2.1 owns the real answer.
 *
 * The identity is derived from the line and the weld's position in space,
 * quantised to 5 mm, rather than from its sequence number. Sequence numbers
 * renumber the moment a fitting is added upstream, which would make every
 * weld on the line look new; a weld that did not move keeps its identity.
 *
 * The trade-off is the opposite failure: a small dimension correction that
 * shifts the whole route by more than the quantum makes every weld look new
 * even though nothing was really added. Solving both at once needs the route
 * graph, not just coordinates, which is why EPIC-2 has a story of its own for
 * it. Until then this is honest about being a placeholder, and everything
 * that joins on `weld_uid` keeps working when it is replaced.
 */
import { createHash } from "node:crypto";

const QUANTUM_MM = 5;
const q = (v) => Math.round(Number(v) / QUANTUM_MM) * QUANTUM_MM;

export function weldUid({ lineNo, kind, e, n, el }) {
  const basis = [String(lineNo || "?"), String(kind || "?"), q(e), q(n), q(el)].join("|");
  return "W" + createHash("sha256").update(basis).digest("hex").slice(0, 15);
}

/** Absolute coordinates for a register row, from the engine's local frame. */
export function absolutePosition(origin, at) {
  return {
    e: Number(origin.E) + Number(at.x),
    n: Number(origin.N) + Number(at.z),
    el: Number(origin.EL) + Number(at.y),
  };
}
