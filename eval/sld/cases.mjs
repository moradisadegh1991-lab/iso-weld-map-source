/**
 * The SLD evaluation cases — ALL SYNTHETIC (`synthetic: true`): drawn by eval/sld/dsl.mjs with the ground truth recorded as they are drawn. They exercise the engine on
 * the conditions a real set has (rotation, multi-page, scans, noise, ambiguity, duplicate / missing tags, ratings, unknown symbols). They are NOT real SLDs and measure
 * nothing about real-world accuracy — see eval/sld/README.md for the real-data package a real figure needs.
 */
import { Drawing } from "./dsl.mjs";

function basic(rotate = 0) {
  const d = new Drawing(600, 300, { rotate });
  d.busbar(40, 40, 330, "BUS-1");
  const t = d.transformer(100, 130, { tag: "T-101", kv: ["33/11", [33, 11]], mva: "25" });
  d.wire(100, 40, 100, 120); d.junction(100, 40);
  d.breaker(200, 100, "CB-12"); d.wire(200, 40, 200, 60);
  d.motor(300, 150, "M-201"); d.wire(300, 40, 300, 140);
  d.generator(420, 150, "G-1");
  d.ground(500, 120); d.battery(540, 200);
  d.ct(250, 220); d.ammeter(380, 220); d.voltmeter(430, 220);
  void t;
  return d;
}
function second() {
  const d = new Drawing(600, 300, { number: 2 });
  d.busbar(60, 60, 360, "BUS-2");
  d.transformer(120, 150, { tag: "T-201", kv: ["11/0.4", [11, 0.4]], mva: "2.5" });
  d.fuse(250, 130); d.isolator(330, 130); d.ups(420, 120); d.relay(480, 200, "87T"); d.offpage(60, 240, "SH 3");
  return d;
}
function ambiguous() {
  const d = new Drawing(600, 300);
  d.unknownSquare(80, 120); d.unknownCircle(180, 120); d.unknownTriangle(260, 110);
  d.breaker(360, 120);                                                      // a real one among them
  return d;
}
function tags() {
  const d = new Drawing(600, 300);
  d.motor(100, 100, "M-301"); d.motor(240, 100, "M-301");                   // the SAME tag printed twice: a duplicate the draft must flag
  d.motor(400, 100);                                                        // a symbol with no tag
  d.tag(500, 240, "P-999", null, 8);                                          // a tag with no symbol
  return d;
}
function ratings() {
  const d = new Drawing(600, 300);
  d.transformer(100, 100, { tag: "TR-1", kv: ["132/33", [132, 33]], mva: "63" });
  d.transformer(350, 100, { tag: "TR-2", kv: ["6.6", 6.6, "voltage"], mva: "1.6" });
  return d;
}
function between() {
  const d = new Drawing(600, 300);
  d.motor(100, 120);                                                        // two motors, one tag printed midway: ambiguous, never attached to both
  d.motor(180, 120);
  d.tag(129, 150, "M-410", null, 8);
  return d;
}

const V = { kind: "vector" };
export const CASES = [
  { id: "vector-basic", ...V, build: () => [basic(0)] },
  { id: "vector-rotated-90", ...V, build: () => [basic(90)] },
  { id: "vector-rotated-180", ...V, build: () => [basic(180)] },
  { id: "vector-rotated-270", ...V, build: () => [basic(270)] },
  { id: "vector-multipage", ...V, build: () => [basic(0), second()] },
  { id: "vector-ambiguous-symbols", ...V, build: () => [ambiguous()] },
  { id: "vector-duplicate-and-missing-tags", ...V, build: () => [tags()] },
  { id: "vector-ratings", ...V, build: () => [ratings()] },
  { id: "vector-tag-between-two-symbols", ...V, build: () => [between()] },
  { id: "scan-150dpi", kind: "scan", dpi: 150, noise: 0, build: () => [basic(0)] },
  { id: "scan-low-resolution-100dpi", kind: "scan", dpi: 100, noise: 0, build: () => [basic(0)] },
  { id: "scan-noisy-150dpi", kind: "scan", dpi: 150, noise: 0.01, build: () => [basic(0)] },
].map((c) => ({ synthetic: true, ...c }));
