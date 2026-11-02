#!/usr/bin/env node
/**
 * The sheet's printed cut table against its own BOM (owner's request of
 * 2026-11-02; lib/register/cut-bom.mjs): per pipe size, the pieces and their
 * length against the metres the BOM lists — over, no pipe row, no size read
 * are said; more BOM than cut is normal and is not flagged.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { cutVsBom } from "../../lib/register/cut-bom.mjs";

const BOM = [
  { pt: 1, group: "PIPE", description: "PIPE S40 BE API 5L-B", diam: "2", qty: 1.9, qtyUnit: "m" },
  { pt: 2, group: "PIPE", description: "PIPE S80 PE SMLS", diam: "3/4", qty: 0.1, qtyUnit: "m" },
  { pt: 3, group: "PIPE", description: "PIPE S40 BE", diam: "6", qty: 4, qtyUnit: "pcs" },
  { pt: 4, group: "FITTINGS", description: "ELBOW 90 LR BW", diam: "2", qty: 2, qtyUnit: "pcs" },
  { pt: 5, group: "PIPE", description: "PIPE X", diam: "10", qty: 3, qtyUnit: "m" },
  { pt: 6, group: "PIPE", description: "PIPE Y", diam: "10", qty: 2, qtyUnit: "m" },
];
const C = (piece, lengthMm, ns) => ({ piece, lengthMm, ns });

test("pieces are summed per size and set against the BOM's metres of pipe of that size", () => {
  const r = cutVsBom([C("1", 1000, "2"), C("2", 950, "2"), C("3", 4000, "10")], BOM);
  equal(r.sizes.map((s) => [s.size, s.pieces, s.cutM, s.bomM, s.status]), [[10, 1, 4, 5, "ok"], [2, 2, 1.95, 1.9, "ok"]], "two pipe rows of one size add; 0.05 m is the sheets' own rounding");
  equal([r.pieces, r.totalM, r.problems], [3, 5.95, []]);
  equal(r.sizes.find((s) => s.size === 10).pts, [5, 6]);
});

test("said, not decided: more cut than BOM, a size with no pipe row in metres, a size not read", () => {
  const r = cutVsBom([C("1", 200, "3/4"), C("2", 300, "6"), C("3", 150, "4"), C("4", 100, "")], BOM);
  const st = Object.fromEntries(r.sizes.map((s) => [String(s.size), s.status]));
  equal(st, { 6: "noBom", 4: "noBom", 0.75: "over", null: "noSize" }, "a pipe row counted in pieces is not metres; a fitting is not pipe");
  equal(r.problems.length, 4);
  assert(/0.2 m است ولی BOM فقط 0.1 m/.test(r.problems.find((p) => p.includes("0.75"))));
  equal(r.noSize, 1);
});

test("more BOM than cut is normal: shown, never flagged; nothing printed, nothing said", () => {
  equal(cutVsBom([C("1", 500, "2")], BOM).sizes[0].status, "ok");
  equal(cutVsBom([], BOM), { sizes: [], problems: [], pieces: 0, totalM: 0, noSize: 0 });
  equal(cutVsBom([C("1", 0, "2"), C("2", "x", "2"), null], BOM).pieces, 0, "a piece with no length is not counted");
});

await run();
