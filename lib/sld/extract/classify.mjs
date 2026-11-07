/**
 * Electrical symbol detection (Phase 12.3): geometry-first rules over the page's primitives and words. Pure.
 *
 *   detectSymbols({ page, prims, words }) → { symbols, usedPrims, usedWords }
 *
 * Each symbol is a CANDIDATE: { cls, bbox (display pt), confidence, rule, basis[], alternatives[], attrs, warnings[] }. Confidence is a HEURISTIC score of how strongly the rule's
 * evidence supports the class — it is not a probability and is not calibrated against real drawings (see docs/audit/phase-12-sld-intelligence.md §19).
 * Rules never connect anything: a line passing through a circle is evidence of a CT shape, not of a circuit.
 * Sizes are in points, scaled by `s` (page size / A4 landscape) because a symbol's size is a property of the drawing, not of electricity.
 */
import { box } from "./geometry.mjs";
import { INNER_TEXT, UNKNOWN } from "./vocab.mjs";
import { lineLen, isH, isV, axisAngle, bboxOfPrim, rectsFromLines } from "./primitives.mjs";
import { normalizeText } from "./text.mjs";

export const RULES_VERSION = "sld-rules/1";
const R2 = (n) => Math.round(n * 100) / 100;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export function pageScale(page) { return Math.min(4, Math.max(1, Math.max(page.width, page.height) / 842)); }

export function detectSymbols({ page, prims, words }) {
  const s = pageScale(page);
  const symbols = [], usedPrims = new Set();
  const wordsIn = (b, tol = 1) => words.filter((w) => box.containsPoint(b, box.cx(w.b), box.cy(w.b), tol));
  const sym = (o) => { symbols.push({ alternatives: [], attrs: {}, warnings: [], basis: [], ...o }); for (const id of o.prims || []) usedPrims.add(id); return symbols[symbols.length - 1]; };
  const wordEv = (w) => ({ kind: "word", id: w.id, text: w.t, conf: w.c ?? 1 });
  const wc = (w) => (w.src === "ocr" ? Math.min(1, 0.6 + 0.4 * (w.c ?? 0.5)) : 1);       // native text is exact; OCR scales the rule's confidence

  const lines = prims.filter((p) => p.type === "line");
  // rectangles drawn as four separate segments (raster) are rebuilt; their segments are then not conductors
  const built = rectsFromLines(lines, { tol: 2.5 * s, min: 5 * s, max: 120 * s });
  const rects = [...prims.filter((p) => p.type === "rect"), ...built.rects];
  for (const id of built.used) usedPrims.add(id);
  const circles = prims.filter((p) => p.type === "circle" && p.r >= 2.5 * s && p.r <= 45 * s);
  const dots = prims.filter((p) => p.type === "dot");
  const polys = prims.filter((p) => p.type === "poly" && p.closed);
  const thinW = median(lines.map((l) => l.lw).filter((x) => x > 0)) || 1;
  const conductors = lines.filter((l) => !built.used.has(l.id));

  // ── rectangles ────────────────────────────────────────────────────────────────────────────────────
  const diagThrough = (r) => {
    const w = r.x1 - r.x0, h = r.y1 - r.y0, tol = 0.2 * Math.min(w, h) + 1;
    const hit = (ax, ay, bx, by) => conductors.find((l) => !isH(l, 12) && !isV(l, 12) && ((dist([l.x0, l.y0], [ax, ay]) < tol && dist([l.x1, l.y1], [bx, by]) < tol) || (dist([l.x1, l.y1], [ax, ay]) < tol && dist([l.x0, l.y0], [bx, by]) < tol)));
    const a = hit(r.x0, r.y0, r.x1, r.y1), b = hit(r.x0, r.y1, r.x1, r.y0);
    return a && b ? [a, b] : null;
  };
  const touching = (r) => {                                   // conductor ends meeting the rectangle's two opposite sides
    const near = (x, y, tol = 2 * s) => conductors.filter((l) => (Math.abs(l.x0 - x) < tol && Math.abs(l.y0 - y) < tol) || (Math.abs(l.x1 - x) < tol && Math.abs(l.y1 - y) < tol));
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    return { vertical: near(cx, r.y0).length && near(cx, r.y1).length, horizontal: near(r.x0, cy).length && near(r.x1, cy).length };
  };
  const bigRects = [];
  for (const r of rects) {
    const w = r.x1 - r.x0, h = r.y1 - r.y0, mn = Math.min(w, h), mx = Math.max(w, h), bb = [r.x0, r.y0, r.x1, r.y1];
    const inside = wordsIn(bb, 0.5);
    if (mn >= 40 * s) { bigRects.push({ r, bb, inside }); continue; }
    if (mn < 4 * s || mx > 60 * s) continue;
    const prims_ = [r.id, ...(r.from || [])];
    const X = diagThrough(r);
    if (X && mx / mn < 1.4 && mx >= 6 * s) {
      sym({ cls: "circuit_breaker", bbox: bb, confidence: 0.85, rule: "square-with-diagonals", prims: [...prims_, X[0].id, X[1].id], basis: [{ kind: "primitive", id: r.id, note: "small square" }, { kind: "primitive", id: X[0].id }, { kind: "primitive", id: X[1].id }] });
      continue;
    }
    const hit = inside.length === 1 ? INNER_TEXT.rect.find(([re]) => re.test(normalizeText(inside[0].t))) : null;
    if (hit) { sym({ cls: hit[1], bbox: bb, confidence: R2(0.8 * wc(inside[0])), rule: "box-with-text", prims: prims_, basis: [{ kind: "primitive", id: r.id }, wordEv(inside[0])], attrs: { printedAs: inside[0].t } }); continue; }
    const ansi = inside.length === 1 && /^\d{1,3}[A-Z]{0,2}(?:\/\d{1,3}[A-Z]{0,2})*$/.test(normalizeText(inside[0].t)) ? inside[0] : null;
    if (ansi) { sym({ cls: "protection_relay", bbox: bb, confidence: R2(0.7 * wc(ansi)), rule: "box-with-device-code", prims: prims_, basis: [{ kind: "primitive", id: r.id }, wordEv(ansi)], attrs: { deviceCode: ansi.t } }); continue; }
    const aspect = mx / mn, t = touching(r);
    if (aspect >= 2.2 && mn <= 9 * s && mx >= 10 * s && (t.vertical || t.horizontal)) { sym({ cls: "fuse", bbox: bb, confidence: 0.7, rule: "narrow-box-on-conductor", prims: prims_, basis: [{ kind: "primitive", id: r.id, note: `aspect ${R2(aspect)}` }], attrs: { orientation: w > h ? "horizontal" : "vertical" } }); continue; }
    if (aspect < 1.4 && (t.vertical || t.horizontal)) {
      sym({ cls: UNKNOWN, bbox: bb, confidence: 0.3, rule: "square-on-conductor", prims: prims_, basis: [{ kind: "primitive", id: r.id, note: "square on a conductor, no marking" }],
        alternatives: [{ cls: "circuit_breaker", confidence: 0.35 }, { cls: "contactor", confidence: 0.2 }], warnings: ["UNMARKED_SWITCHING_SQUARE"] });
      continue;
    }
    sym({ cls: UNKNOWN, bbox: bb, confidence: 0.2, rule: "unrecognised-box", prims: prims_, basis: [{ kind: "primitive", id: r.id }].concat(inside.map(wordEv)), warnings: ["UNRECOGNISED_BOX"] });
  }

  // ── circles ───────────────────────────────────────────────────────────────────────────────────────
  const taken = new Set();
  const cs = circles.filter((c) => !c.nested);
  for (const c of cs) {
    if (taken.has(c.id)) continue;
    const overl = cs.filter((o) => o !== c && !taken.has(o.id) && dist([c.cx, c.cy], [o.cx, o.cy]) <= c.r + o.r + 0.5 * s && dist([c.cx, c.cy], [o.cx, o.cy]) >= 0.35 * (c.r + o.r) && Math.abs(o.r - c.r) / Math.max(o.r, c.r) < 0.3);
    if (overl.length) {
      // a chain of overlapping rings: two or three windings
      const group = [c, ...overl];
      for (const g of group) taken.add(g.id);
      const bb = group.map((g) => [g.cx - g.r, g.cy - g.r, g.cx + g.r, g.cy + g.r]).reduce(box.union);
      const small = Math.max(...group.map((g) => g.r)) <= 7 * s;
      if (group.length <= 3) {
        const windings = group.length;
        const alt = windings === 2 ? [{ cls: "voltage_transformer", confidence: small ? 0.5 : 0.25 }] : [];
        sym({ cls: "transformer", bbox: bb, confidence: windings === 2 ? (small ? 0.5 : 0.8) : 0.75, rule: "overlapping-circles", prims: group.map((g) => g.id),
          basis: group.map((g) => ({ kind: "primitive", id: g.id, note: "winding circle" })), alternatives: alt, attrs: { windings }, warnings: windings === 2 && small ? ["TRANSFORMER_OR_VT"] : [] });
      } else sym({ cls: UNKNOWN, bbox: bb, confidence: 0.2, rule: "circle-cluster", prims: group.map((g) => g.id), basis: group.map((g) => ({ kind: "primitive", id: g.id })), warnings: ["CIRCLE_CLUSTER"] });
      continue;
    }
    taken.add(c.id);
    const bb = [c.cx - c.r, c.cy - c.r, c.cx + c.r, c.cy + c.r], inside = wordsIn(bb, 0.5);
    const ev = [{ kind: "primitive", id: c.id, note: `circle r=${R2(c.r)}` }];
    if (inside.length === 1) {
      const t = normalizeText(inside[0].t), hit = INNER_TEXT.circle.find(([re]) => re.test(t));
      if (hit) { sym({ cls: hit[1], bbox: bb, confidence: R2(0.85 * wc(inside[0])), rule: "circle-with-letter", prims: [c.id], basis: [...ev, wordEv(inside[0])], attrs: { printedAs: inside[0].t } }); continue; }
      if (/^\d{1,3}[A-Z]{0,2}$/.test(t)) { sym({ cls: "protection_relay", bbox: bb, confidence: R2(0.65 * wc(inside[0])), rule: "circle-with-device-code", prims: [c.id], basis: [...ev, wordEv(inside[0])], attrs: { deviceCode: inside[0].t } }); continue; }
      sym({ cls: UNKNOWN, bbox: bb, confidence: 0.2, rule: "circle-with-unrecognised-text", prims: [c.id], basis: [...ev, wordEv(inside[0])], warnings: ["UNRECOGNISED_CIRCLE_TEXT"] });
      continue;
    }
    // a conductor running through the ring, beyond it on both sides: the shape of a current transformer
    const through = conductors.find((l) => { const m = [(l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2]; return lineLen(l) > 2 * c.r && distToSeg([c.cx, c.cy], l) < 0.35 * c.r && (dist([l.x0, l.y0], [c.cx, c.cy]) > c.r || dist([l.x1, l.y1], [c.cx, c.cy]) > c.r) && (isH(l, 4) || isV(l, 4)) && !!m; });
    if (through && c.r <= 8 * s) { sym({ cls: "current_transformer", bbox: bb, confidence: 0.55, rule: "ring-on-conductor", prims: [c.id], basis: [...ev, { kind: "primitive", id: through.id, note: "conductor through the ring" }], alternatives: [{ cls: UNKNOWN, confidence: 0.3 }], warnings: ["NOT_CONFIRMED_BY_TEXT"] }); continue; }
    sym({ cls: UNKNOWN, bbox: bb, confidence: 0.2, rule: "plain-circle", prims: [c.id], basis: ev, warnings: ["CIRCLE_WITHOUT_MARKING"] });
  }

  // ── polygons: off-page outlines ──────────────────────────────────────────────────────────────────────
  for (const p of polys) {
    const bb = p.bbox, n = p.pts.length;
    if (n === 5 && !p.curved && box.w(bb) >= 8 * s && box.w(bb) <= 90 * s) {
      const inside = wordsIn(bb, 0.5);
      sym({ cls: "offpage_reference", bbox: bb, confidence: 0.65, rule: "pentagon-outline", prims: [p.id], basis: [{ kind: "primitive", id: p.id, note: "five-sided outline" }, ...inside.map(wordEv)], attrs: { shape: "pentagon" } });
    } else if (n === 3 && box.w(bb) >= 5 * s && box.w(bb) <= 40 * s) {
      sym({ cls: UNKNOWN, bbox: bb, confidence: 0.2, rule: "triangle", prims: [p.id], basis: [{ kind: "primitive", id: p.id, note: "triangle" }], alternatives: [{ cls: "load", confidence: 0.25 }], warnings: ["TRIANGLE_NOT_CLASSIFIED"] });
    }
  }
  // a box that prints an off-page text is also a reference (text evidence, kept separate from the outline rule)
  for (const w of words) {
    if (!/\b(?:SH(?:EET)?\.?\s*\d|OFF[- ]?PAGE|DWG)/i.test(normalizeText(w.t))) continue;
    const host = symbols.find((x) => x.cls === UNKNOWN && x.rule === "unrecognised-box" && box.containsPoint(x.bbox, box.cx(w.b), box.cy(w.b), 0.5));
    if (host) { host.cls = "offpage_reference"; host.confidence = R2(0.6 * wc(w)); host.rule = "box-with-offpage-text"; host.warnings = host.warnings.filter((x) => x !== "UNRECOGNISED_BOX"); host.basis.push(wordEv(w)); }
  }

  // ── lines: busbar, ground, battery, isolator ─────────────────────────────────────────────────────
  const free = () => conductors.filter((l) => !usedPrims.has(l.id));
  const rasterPage = lines.length > 0 && lines.every((l) => l.src === "raster");        // a scan's stroke widths are noisy (anti-aliasing): a lower ratio, stated
  const heavy = Math.max((rasterPage ? 1.5 : 2.2) * thinW, 2.4 * Math.min(s, 1.5));
  for (const l of free()) {
    if ((isH(l) || isV(l)) && lineLen(l) >= 50 * s && l.lw >= heavy) {
      sym({ cls: "busbar", bbox: padBox(bboxOfPrim(l), Math.max((l.lw || 0) / 2, 1)), confidence: R2(Math.min(0.9, 0.6 + 0.1 * (l.lw / heavy))), rule: "long-heavy-line", prims: [l.id], basis: [{ kind: "primitive", id: l.id, note: `length ${R2(lineLen(l))}, width ${l.lw} (page median ${R2(thinW)})` }], attrs: { orientation: isH(l) ? "horizontal" : "vertical", length: R2(lineLen(l)) } });
    }
  }
  // stacked parallel plates: decreasing = ground, alternating = battery
  for (const orient of ["h", "v"]) {
    const pl = free().filter((l) => (orient === "h" ? isH(l) : isV(l)) && lineLen(l) >= 3 * s && lineLen(l) <= 40 * s);
    const key = (l) => (orient === "h" ? (l.y0 + l.y1) / 2 : (l.x0 + l.x1) / 2), ctr = (l) => (orient === "h" ? (l.x0 + l.x1) / 2 : (l.y0 + l.y1) / 2);
    const sorted = [...pl].sort((a, b) => key(a) - key(b)), seen = new Set();
    for (const a of sorted) {
      if (seen.has(a.id)) continue;
      const stack = [a];
      for (const b of sorted) {
        const last = stack[stack.length - 1];
        if (b === a || seen.has(b.id) || stack.includes(b)) continue;
        const gap = key(b) - key(last);
        if (gap > 0.6 * s && gap <= 7 * s && Math.abs(ctr(b) - ctr(a)) <= 2.5 * s) stack.push(b);
      }
      if (stack.length < 3) continue;
      const len = stack.map(lineLen);
      const decreasing = len.every((x, i) => i === 0 || x < len[i - 1] - 0.5);
      const increasing = len.every((x, i) => i === 0 || x > len[i - 1] + 0.5);
      const alternating = stack.length >= 4 && len.every((x, i) => i === 0 || (i % 2 ? x < len[i - 1] / 1.4 : x > len[i - 1] * 1.4));
      const bb = stack.map(bboxOfPrim).reduce(box.union);
      if (decreasing || increasing) { stack.forEach((x) => seen.add(x.id)); sym({ cls: "ground", bbox: bb, confidence: 0.8, rule: "decreasing-plates", prims: stack.map((x) => x.id), basis: stack.map((x) => ({ kind: "primitive", id: x.id, note: `plate ${R2(lineLen(x))}` })), attrs: { plates: stack.length } }); }
      else if (alternating) { stack.forEach((x) => seen.add(x.id)); sym({ cls: "battery", bbox: bb, confidence: 0.75, rule: "alternating-plates", prims: stack.map((x) => x.id), basis: stack.map((x) => ({ kind: "primitive", id: x.id, note: `plate ${R2(lineLen(x))}` })), attrs: { plates: stack.length } }); }
    }
  }
  // isolator blade: a short oblique segment hinged on the end of a straight conductor
  for (const l of free()) {
    const ang = axisAngle(l), len = lineLen(l);
    if (ang < 15 || ang > 75 || len < 8 * s || len > 36 * s) continue;
    const axis = free().filter((o) => o !== l && (isH(o) || isV(o)));
    const hinge = axis.find((o) => [[o.x0, o.y0], [o.x1, o.y1]].some((e) => [[l.x0, l.y0], [l.x1, l.y1]].some((p) => dist(e, p) < 2 * s)));
    if (!hinge) continue;
    sym({ cls: "isolator", bbox: bboxOfPrim(l), confidence: 0.55, rule: "oblique-blade-on-conductor", prims: [l.id], basis: [{ kind: "primitive", id: l.id, note: `blade ${R2(ang)}° from the axis` }, { kind: "primitive", id: hinge.id, note: "conductor end at the blade's hinge" }],
      alternatives: [{ cls: "load_break_switch", confidence: 0.2 }, { cls: "earthing_switch", confidence: 0.15 }], warnings: ["SWITCH_KIND_NOT_CONFIRMED"] });
  }
  // junction dots
  for (const dt of dots) sym({ cls: "junction", bbox: bboxOfPrim(dt), confidence: 0.7, rule: "filled-dot", prims: [dt.id], basis: [{ kind: "primitive", id: dt.id, note: `dot r=${dt.r}` }] });

  // ── panels / switchgear: a large outline that holds other symbols (kept AFTER the others so containment is known) ─────────────────
  for (const { r, bb, inside } of bigRects) {
    const held = symbols.filter((x) => box.contains(bb, x.bbox, 1)).length;
    if (held >= 2) sym({ cls: "panel_switchgear", bbox: bb, confidence: R2(Math.min(0.6, 0.35 + 0.05 * held)), rule: "outline-holding-symbols", prims: [r.id, ...(r.from || [])], basis: [{ kind: "primitive", id: r.id, note: `large outline holding ${held} symbols` }, ...inside.slice(0, 3).map(wordEv)], warnings: ["OUTLINE_IS_NOT_A_PANEL_UNTIL_REVIEWED"] });
    else sym({ cls: UNKNOWN, bbox: bb, confidence: 0.15, rule: "large-outline", prims: [r.id, ...(r.from || [])], basis: [{ kind: "primitive", id: r.id }], warnings: ["LARGE_OUTLINE"] });
  }
  return { symbols, usedPrims, conductors: conductors.filter((l) => !usedPrims.has(l.id)), thinWidth: thinW, scale: s };
}

const padBox = (b, p) => [b[0] - (b[2] - b[0] < 2 * p ? p : 0), b[1] - (b[3] - b[1] < 2 * p ? p : 0), b[2] + (b[2] - b[0] < 2 * p ? p : 0), b[3] + (b[3] - b[1] < 2 * p ? p : 0)];
function distToSeg(p, l) {
  const [vx, vy] = [l.x1 - l.x0, l.y1 - l.y0], len2 = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - l.x0) * vx + (p[1] - l.y0) * vy) / len2));
  return Math.hypot(p[0] - (l.x0 + t * vx), p[1] - (l.y0 + t * vy));
}
