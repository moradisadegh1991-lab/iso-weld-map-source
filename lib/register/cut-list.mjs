/**
 * The cut list of one isometric: every straight piece the shop saws — pipe
 * runs and pups — with its spool, size, the length between its two welds
 * and the welds at its ends, from the engine's model (lib/engine.js).
 *
 * The lengths are the engine's, between weld points, as the drawing
 * dimensions them: no root gap is taken off and no allowance added — that
 * is the shop's practice to apply, not a number to invent here.
 *
 * When the drawing prints its own CUT PIPE LENGTH table (`data.cutLengths`,
 * as read), each printed piece is paired with a computed one of the same
 * size within the engine's own tolerance (max 5 mm, 0.5%), the same rule
 * the engine's check uses; a printed piece with no partner, and a computed
 * one no printed piece matches, are both listed as such. Nothing is
 * reconciled by hand here: a mismatch is shown for a person to settle.
 */
const WELD_TOL = 2;     // mm: an end and a weld closer than this are the same point (lib/engine.js)
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

export function printedPieces(data, defaultNps) {
  return (data?.cutLengths || [])
    .map((c) => ({ piece: String(c.piece ?? c.pieceNo ?? "?"), len: Number(c.lengthMm ?? c.cutLength ?? c.length),
      nps: Number(c.nps ?? c.diam ?? defaultNps) }))
    .filter((c) => Number.isFinite(c.len) && c.len > 0);
}

/**
 * { rows, unmatchedPrinted, bySpool, bySize, total }
 *   rows: { no, spool, kind, nps, schedule, lengthMm, endA, endB, printed: {piece,len}|null }
 */
export function cutList(model, data) {
  if (!model || model.error) return { rows: [], unmatchedPrinted: [], bySpool: [], bySize: [], total: 0 };
  // the schedule printed for the line is the main size's; a piece of another size has its own, not read here
  const schedule = data?.meta?.schedule || "";
  const mainNps = Number(data?.meta?.nps) || model.nps;
  const welds = model.welds || [];
  const weldAt = (p) => {
    if (!p) return null;
    let best = null;
    for (const w of welds) { const d = dist(w.at, p); if (d < WELD_TOL && (!best || d < best.d)) best = { d, w }; }
    return best ? best.w.no : null;
  };
  const pieces = model.elements
    .filter((e) => e.kind === "pipe" || e.kind === "pup")
    .slice().sort((a, b) => String(a.spool).localeCompare(String(b.spool)) || a.seq - b.seq);
  const rows = pieces.map((e, i) => ({
    no: i + 1, spool: e.spool, kind: e.kind, nps: Number(e.nps) || model.nps,
    schedule: (Number(e.nps) || model.nps) === mainNps ? schedule : "",
    lengthMm: Math.round(e.length), endA: weldAt(e.a), endB: weldAt(e.b), printed: null,
  }));

  // pair the printed pieces with computed ones, the engine's tolerance (lib/engine.js, CUT PIPE LENGTH)
  const unmatchedPrinted = [];
  for (const c of printedPieces(data, model.nps)) {
    const tol = Math.max(5, c.len * 0.005);
    const hit = rows.filter((r) => !r.printed && r.nps === c.nps && Math.abs(r.lengthMm - c.len) <= tol)
      .sort((a, b) => Math.abs(a.lengthMm - c.len) - Math.abs(b.lengthMm - c.len))[0];
    if (hit) hit.printed = { piece: c.piece, len: c.len };
    else unmatchedPrinted.push(c);
  }

  const group = (key) => {
    const m = new Map();
    for (const r of rows) {
      const k = key(r);
      const g = m.get(k) || { key: k, pieces: 0, lengthMm: 0 };
      g.pieces++; g.lengthMm += r.lengthMm;
      m.set(k, g);
    }
    return [...m.values()];
  };
  return {
    rows, unmatchedPrinted,
    bySpool: group((r) => r.spool),
    bySize: group((r) => r.nps).sort((a, b) => b.key - a.key),
    total: rows.reduce((s, r) => s + r.lengthMm, 0),
    printedCount: printedPieces(data, model.nps).length,
  };
}

const KIND_EN = { pipe: "Pipe", pup: "Pup" };

/** The list as rows of cells — the Excel sheet and the printed page are the same table. */
export function cutListTable(cl) {
  const head = ["No", "Spool", "Piece", "NPS (in)", "Schedule", "Cut length (mm)", "End A", "End B", "Drawing piece", "Drawing length (mm)"];
  const rows = cl.rows.map((r) => [r.no, r.spool, KIND_EN[r.kind] || r.kind, r.nps, r.schedule, r.lengthMm, r.endA || "", r.endB || "",
    r.printed ? `<${r.printed.piece}>` : "", r.printed ? r.printed.len : ""]);
  return { head, rows };
}
