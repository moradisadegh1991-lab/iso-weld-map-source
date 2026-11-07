/**
 * Drawing primitives (Phase 12.3). Pure. Turns the raw vector sub-paths of a page (inputs.mjs vectorPaths) or the raster reader's output (tools/sld-raster.py)
 * into ONE vocabulary the symbol rules read: line, circle, dot, rect, poly. Rectangles that exist only as four separate segments (a raster read) are rebuilt
 * with `rectsFromLines`. Geometry only: nothing here names a symbol.
 */
import { box } from "./geometry.mjs";

const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const bboxOf = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
const round = (n) => Math.round(n * 100) / 100;

/** [{ pts, curves, closed, lw, filled }] → primitives (display frame). Glyph-sized specks (< 1.2 pt) are dropped. */
export function fromVectorPaths(paths) {
  const out = [];
  let id = 0;
  const push = (p) => out.push({ id: `vp${id++}`, src: "vector", ...p });
  for (const s of paths) {
    const pts = s.pts.slice();
    if (s.closed && pts.length > 1 && d(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
    if (!pts.length) continue;
    const bb = bboxOf(s.pts), w = bb[2] - bb[0], h = bb[3] - bb[1];
    if (w < 1.2 && h < 1.2 && !s.filled) continue;
    if (s.curves >= 4 && w > 0 && h > 0 && Math.abs(w - h) / Math.max(w, h) < 0.12) {
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, r = (w + h) / 4;
      // a true circle: every vertex at about one radius from the centre
      if (pts.every((p) => Math.abs(d(p, [cx, cy]) - r) / r < 0.12)) {
        push(s.filled && r <= 3 ? { type: "dot", cx: round(cx), cy: round(cy), r: round(r) } : { type: "circle", cx: round(cx), cy: round(cy), r: round(r), filled: !!s.filled, lw: s.lw });
        continue;
      }
    }
    if (s.curves > 0) { push({ type: "poly", pts: s.pts.map(([x, y]) => [round(x), round(y)]), closed: s.closed, filled: !!s.filled, lw: s.lw, curved: true, bbox: bb.map(round) }); continue; }
    if (!s.closed && pts.length === 2) { push({ type: "line", x0: round(pts[0][0]), y0: round(pts[0][1]), x1: round(pts[1][0]), y1: round(pts[1][1]), lw: s.lw }); continue; }
    if (s.closed && pts.length === 4) {
      const xs = [...new Set(pts.map((p) => round(p[0])))], ys = [...new Set(pts.map((p) => round(p[1])))];
      if (xs.length === 2 && ys.length === 2) { push({ type: "rect", x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), filled: !!s.filled, lw: s.lw }); continue; }
    }
    if (s.closed && pts.length >= 3) { push({ type: "poly", pts: pts.map(([x, y]) => [round(x), round(y)]), closed: true, filled: !!s.filled, lw: s.lw, bbox: bb.map(round) }); continue; }
    for (let i = 0; i + 1 < pts.length; i++) push({ type: "line", x0: round(pts[i][0]), y0: round(pts[i][1]), x1: round(pts[i + 1][0]), y1: round(pts[i + 1][1]), lw: s.lw });
  }
  return out;
}

/** raster reader primitives → ids + src */
export function fromRaster(prims) { return prims.map((p, i) => ({ id: `rp${i}`, src: "raster", ...p })); }

export const lineLen = (l) => Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
/** angle of a line from the horizontal axis, 0..90 */
export const axisAngle = (l) => { const a = Math.abs(Math.atan2(l.y1 - l.y0, l.x1 - l.x0)) * 180 / Math.PI; return Math.min(a, 180 - a); };
export const isH = (l, tol = 3) => axisAngle(l) <= tol;
export const isV = (l, tol = 3) => axisAngle(l) >= 90 - tol;
export const bboxOfPrim = (p) => p.type === "line" ? [Math.min(p.x0, p.x1), Math.min(p.y0, p.y1), Math.max(p.x0, p.x1), Math.max(p.y0, p.y1)]
  : p.type === "circle" || p.type === "dot" ? [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r] : p.type === "rect" ? [p.x0, p.y0, p.x1, p.y1] : p.bbox;

/**
 * Rectangles drawn as four separate segments: a top and a bottom horizontal that cover most of one span, and a left and a right vertical that cover most of
 * the other, all meeting within `tol`. Each rebuilt rect names the segments it came from (`from`) so they are not read again as conductors.
 */
export function rectsFromLines(lines, { tol = 2.5, min = 5, max = 120, cover = 0.6 } = {}) {
  const H = lines.filter((l) => isH(l, 4)), V = lines.filter((l) => isV(l, 4));
  const out = [], used = new Set();
  const span = (l, ax) => ax === "x" ? [Math.min(l.x0, l.x1), Math.max(l.x0, l.x1)] : [Math.min(l.y0, l.y1), Math.max(l.y0, l.y1)];
  const yOf = (l) => (l.y0 + l.y1) / 2, xOf = (l) => (l.x0 + l.x1) / 2;
  for (const top of H) {
    if (used.has(top.id)) continue;
    const [tx0, tx1] = span(top, "x");
    for (const bot of H) {
      if (bot === top || used.has(bot.id)) continue;
      const dy = yOf(bot) - yOf(top);
      if (dy < min || dy > max) continue;
      const [bx0, bx1] = span(bot, "x"), x0 = Math.max(tx0, bx0), x1 = Math.min(tx1, bx1), w = Math.max(tx1, bx1) - Math.min(tx0, bx0);
      if (x1 - x0 < cover * w || w < min || w > max) continue;
      const left = V.find((v) => !used.has(v.id) && Math.abs(xOf(v) - Math.min(tx0, bx0)) <= tol && overlap(span(v, "y"), [yOf(top), yOf(bot)]) >= cover * dy);
      const right = V.find((v) => !used.has(v.id) && v !== left && Math.abs(xOf(v) - Math.max(tx1, bx1)) <= tol && overlap(span(v, "y"), [yOf(top), yOf(bot)]) >= cover * dy);
      if (left && right) {
        const r = { id: `dr${out.length}`, src: "derived", type: "rect", x0: round(xOf(left)), y0: round(yOf(top)), x1: round(xOf(right)), y1: round(yOf(bot)), filled: false, from: [top.id, bot.id, left.id, right.id] };
        out.push(r); for (const id of r.from) used.add(id);
        break;
      }
    }
  }
  return { rects: out, used };
}
const overlap = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
export { box };
