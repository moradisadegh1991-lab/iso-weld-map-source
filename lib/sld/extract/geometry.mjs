/**
 * Page model and coordinates (Phase 12.3). Pure.
 *
 * THE FRAME: every coordinate this engine stores is in the DISPLAY frame of the page — points (1/72 in), origin top-left, y down, AFTER the page's /Rotate
 * is applied — exactly what a viewer shows, so an overlay needs no transform. Poppler reports a page's size UNROTATED (a landscape sheet made by /Rotate 90 on a
 * portrait MediaBox reads "portrait"); `pageModel` swaps it back, and records the rotation so the original (unrotated) user-space point can be recovered.
 * Normalised coordinates are the display coordinates divided by the display size: [0, 1] on both axes.
 */
export const ROTATIONS = Object.freeze([0, 90, 180, 270]);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** { number, mediaWidth, mediaHeight (UNROTATED), rotation, width, height (DISPLAY), scale (px per pt when raster), source } */
export function pageModel({ number, mediaWidth, mediaHeight, rotation = 0, dpi = null, source = "pdf" }) {
  const rot = ((Math.round(Number(rotation) / 90) * 90) % 360 + 360) % 360;
  if (!(mediaWidth > 0) || !(mediaHeight > 0)) throw Object.assign(new Error("page size is not positive"), { status: 422, code: "PAGE_SIZE_INVALID" });
  const swap = rot % 180 === 90;
  return { number, mediaWidth: round(mediaWidth), mediaHeight: round(mediaHeight), rotation: rot,
    width: round(swap ? mediaHeight : mediaWidth), height: round(swap ? mediaWidth : mediaHeight),
    orientation: (swap ? mediaHeight : mediaWidth) >= (swap ? mediaWidth : mediaHeight) ? "landscape" : "portrait", scale: dpi ? round(dpi / 72, 4) : 1, dpi: dpi || null, source };
}

/** clamp a display-frame box to the page; returns { box, clamped } (a box wholly outside is clamped to a zero-area box on the edge and flagged). */
export function clampBox(b, page) {
  const [x0, y0, x1, y1] = b;
  const c = [Math.min(Math.max(Math.min(x0, x1), 0), page.width), Math.min(Math.max(Math.min(y0, y1), 0), page.height),
    Math.min(Math.max(Math.max(x0, x1), 0), page.width), Math.min(Math.max(Math.max(y0, y1), 0), page.height)];
  return { box: c.map((v) => round(v)), clamped: c.some((v, i) => Math.abs(v - [x0, y0, x1, y1][i]) > 1e-6 && Math.abs(v - [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)][i]) > 1e-6) };
}

/** display box → normalised [0,1] box */
export const normalize = (b, page) => [b[0] / page.width, b[1] / page.height, b[2] / page.width, b[3] / page.height].map((v) => round(Math.min(Math.max(v, 0), 1), 5));
/** normalised → display points */
export const denormalize = (n, page) => [n[0] * page.width, n[1] * page.height, n[2] * page.width, n[3] * page.height].map((v) => round(v));

/** a display-frame point → the page's UNROTATED user space (origin bottom-left, as the PDF content stream writes it) */
export function toUserSpace(x, y, page) {
  const Wu = page.mediaWidth, Hu = page.mediaHeight;
  switch (page.rotation) { case 90: return [round(y), round(x)]; case 180: return [round(Wu - x), round(y)]; case 270: return [round(Wu - y), round(Hu - x)]; default: return [round(x), round(Hu - y)]; }
}
/** the inverse: unrotated user space → display frame */
export function fromUserSpace(ux, uy, page) {
  const Wu = page.mediaWidth, Hu = page.mediaHeight;
  switch (page.rotation) { case 90: return [round(uy), round(ux)]; case 180: return [round(Wu - ux), round(uy)]; case 270: return [round(Hu - uy), round(Wu - ux)]; default: return [round(ux), round(Hu - uy)]; }
}

export const box = { w: (b) => b[2] - b[0], h: (b) => b[3] - b[1], cx: (b) => (b[0] + b[2]) / 2, cy: (b) => (b[1] + b[3]) / 2,
  area: (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]),
  union: (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
  contains: (o, i, tol = 0) => i[0] >= o[0] - tol && i[1] >= o[1] - tol && i[2] <= o[2] + tol && i[3] <= o[3] + tol,
  containsPoint: (b, x, y, tol = 0) => x >= b[0] - tol && x <= b[2] + tol && y >= b[1] - tol && y <= b[3] + tol,
  /** the shortest distance between two boxes (0 when they touch or overlap) */
  gap: (a, b) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3])),
  iou: (a, b) => { const i = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])); const u = box.area(a) + box.area(b) - i; return u > 0 ? i / u : 0; } };
