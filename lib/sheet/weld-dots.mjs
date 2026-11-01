/**
 * A sheet with no weld numbers printed: the weld dots the no-model reader
 * found on the pipe (tools/iso-read.py weld_points) become suggested welds
 * for a person to check — each a row of the weld list with its mark joined
 * to its dot by a leader, the frame set beside it.
 *
 * What is not on the drawing is not made up here: the location (shop or
 * site) stays blank and the mark a dashed circle until a person says; the
 * numbers are only an order to start from — along the pipe, each dot followed
 * by the nearest one not yet numbered — and the note says so.
 *
 * A socket end (the filled block a socket-weld fitting is drawn with) is a
 * weld too, and the symbol says how it is made: its row's type is SW.
 */
import { frameSpot } from "./markup.mjs";

const round = (v) => Math.round(v * 10000) / 10000;

/** The dots in an order along the pipe: from the top-left-most, each next the nearest not yet taken. */
export function orderAlongPipe(dots, aspect = Math.SQRT2) {
  const left = dots.map((d, i) => ({ x: d[0], y: d[1], i, d }));
  if (!left.length) return [];
  const dist = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) / aspect);
  left.sort((a, b) => (a.x + a.y / aspect) - (b.x + b.y / aspect));
  const out = [left.shift()];
  while (left.length) {
    const last = out[out.length - 1];
    let k = 0;
    for (let j = 1; j < left.length; j++) if (dist(last, left[j]) < dist(last, left[k])) k = j;
    out.push(left.splice(k, 1)[0]);
  }
  return out.map((d) => d.d);
}

const point = (d) => Array.isArray(d) && d.length === 2 && d.every((v) => Number.isFinite(v) && v >= 0 && v <= 1);

/**
 * @param {Array<[number, number]>} dots     weld dots, fractions of the page
 * @param {number} aspect                    the page's width / height
 * @param {Array<[number, number]>} sockets  socket ends, fractions of the page
 * @returns {{ rows: object[], marks: Record<string, {x, y, ax, ay, src}> }}
 */
export function suggestFromDots(dots, aspect = Math.SQRT2, sockets = []) {
  const ok = [...(dots || []).filter(point).map((d) => [d[0], d[1], ""]), ...(sockets || []).filter(point).map((d) => [d[0], d[1], "SW"])];
  const rows = [], marks = {}, placed = [];
  orderAlongPipe(ok, aspect).forEach(([x, y, kind], i) => {
    const no = String(i + 1);
    const f = frameSpot({ x, y }, placed, aspect);
    const m = { x: round(f.x), y: round(f.y), ax: round(x), ay: round(y), src: kind ? "reader-socket" : "reader-dot" };
    placed.push({ kind: "weld-unknown", x: m.x, y: m.y });
    marks[no] = m;
    rows.push({ no, spool: "", loc: "", kind, nps: "", schedule: "", material: "", wps: "", ref: "" });
  });
  return { rows, marks };
}
