#!/usr/bin/env node
/**
 * The welds a sheet's BOM implies (lib/register/bom-welds.mjs; owner's
 * request of 2026-11-01): each fitting counted by its welded ends as its
 * description says they are made, pipe and nipples not counted, and what
 * the BOM does not say — or a row not read — named rather than guessed.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { piecesEnds, bomWeldEnds, compareBomWelds } from "../../lib/register/bom-welds.mjs";

const ends = (description, diam) => piecesEnds({ description, diam }).ends;

test("fittings: an elbow has two welded ends, a tee three (a reducing one's branch at the small size), a reducer one at each size, a cap one", () => {
  equal(ends("ELBOW 90 LR S40 BW A234-WPBW ASME B16.9", "6"), [{ size: 6, kind: "BW", n: 2 }]);
  equal(ends("ELBOW 90 3000# SW A105 ASME B16.11", "3/4"), [{ size: 0.75, kind: "SW", n: 2 }]);
  equal(ends("REDUCING TEE 3000# SW A105 ASME B16.11", "1.1/2 x 3/4"), [{ size: 1.5, kind: "SW", n: 2 }, { size: 0.75, kind: "SW", n: 1 }]);
  equal(ends("EQUAL TEE S40 S40 BW A234-WPB ASME B16.9", "4"), [{ size: 4, kind: "BW", n: 3 }]);
  equal(ends("REDUCER CONCENTRIC S40 S40 BW A234-WPBW ASME B16.9", "6 x 4"), [{ size: 6, kind: "BW", n: 1 }, { size: 4, kind: "BW", n: 1 }]);
  equal(ends("CAP 3000# NPT A105 ASME B16.11", "3/4"), [{ size: 0.75, kind: "THD", n: 1 }], "a threaded end is a joint, not a weld");
});

test("flanges, branch fittings and in-line items: as their ends are made", () => {
  equal(ends("FLANGE WELDING NECK S40 150# RF A105 ASME B16.5", "6"), [{ size: 6, kind: "BW", n: 1 }]);
  equal(ends("Flange, ASTM A105N, Socket welded, RF, SCH80, 150#", "3/4"), [{ size: 0.75, kind: "SW", n: 1 }]);
  equal(ends("FLANGE BLIND 150# RF A105", "2"), [], "a blind flange is bolted");
  equal(ends("FLANGE LAP JOINT 150# FF A105", "2"), [], "a lap-joint flange: its stub end is the weld");
  equal(ends("STUB END SP 10S BW A403-WP304", "2"), [{ size: 2, kind: "BW", n: 1 }]);
  equal(ends("HALF COUPLING 3000# SW A105 ASME B16.11", "6 x 3/4"), [{ size: 0.75, kind: "OLET", n: 1 }, { size: 0.75, kind: "SW", n: 1 }],
    "welded to its run (an OLET) at the branch size, and its socket");
  equal(ends("HALF COUPLING 3000# NPT A105 ASME B16.11", "6 x 3/4"), [{ size: 0.75, kind: "OLET", n: 1 }, { size: 0.75, kind: "THD", n: 1 }]);
  equal(ends("VALVE GATE 800# SW A105 BODY", "3/4"), [{ size: 0.75, kind: "SW", n: 2 }]);
  equal(ends("VALVE GATE 150# RF A216-WCB BODY", "6"), [], "a flanged valve is bolted");
  equal(ends("VALVE CHECK 150# WAFER DUAL PLATE A216-WCB", "6"), []);
  equal(ends("Gate Valve, Solid Wedge, BB, OS&Y, HO, FLGD, RF, 300#", "1.1/2"), []);
});

test("pipe, nipples and plain-end swages are counted at the sockets and bevels they meet; a swage's bevelled end is its own weld", () => {
  for (const [d, s] of [["PIPE S40 BE ERW API 5L-B", "6"], ["STRAIGHT NIPPLE S80 TOE SMLS (L=100mm)", "3/4"], ["GASKET 150# RF GRAPHITE", "6"],
    ["90 STUD BOLT ASTM A193 GR.B7 + 2 HEAVY HEX NUTS", "5/8 x 90"], ["STRESS SUPPORT", "2"], ["INSTRUMENT GAUGE #300 RF 10 930 AT-204", "1.1/2"]])
    equal(ends(d, s), [], d);
  equal(ends("SWAGED NIPPLE CON. S40 S80 BLE/PSE A234-WPB MSS SP-95", "3 x 1.1/2"), [{ size: 3, kind: "BW", n: 1 }]);
  equal(ends("REDUCER INSERT 3000# PLE X TSE (NPTF) A105", "3/4 x 1/2"), [{ size: 0.5, kind: "THD", n: 1 }]);
});

test("what the description does not say is not guessed: the row is named and the count incomplete", () => {
  equal(piecesEnds({ description: "ELBOW 90 LR S40 A234-WPB", diam: "6" }).ends, null, "an elbow that names no end type");
  equal(piecesEnds({ description: "General purpose ATTA", diam: "2" }).ends, null);
  const b = bomWeldEnds([{ pt: 1, description: "ELBOW 90 LR S40 BW", diam: "6", qty: 2, qtyUnit: "pcs" },
    { pt: 2, description: "ELBOW 90 LR S40 A234-WPB", diam: "6", qty: 1, qtyUnit: "pcs" }]);
  equal([b.total, b.complete, b.unclassified.map((u) => u.pt)], [4, false, [2]]);
});

test("quantities: the pieces multiply; a quantity not read, or a PT number missing from the run, makes the count incomplete", () => {
  const bom = [
    { pt: 1, description: "PIPE S40 BE", diam: "6", qty: 3, qtyUnit: "m" },
    { pt: 2, description: "ELBOW 90 LR S40 BW", diam: "6", qty: 2, qtyUnit: "pcs" },
    { pt: 3, description: "FLANGE WELDING NECK S40 150# RF", diam: "6", qty: 4, qtyUnit: "pcs" },
    { pt: 4, description: "HALF COUPLING 3000# SW A105", diam: "6 x 3/4", qty: 1, qtyUnit: "pcs" },
    { pt: 5, description: "CAP 3000# NPT A105", diam: "3/4", qty: 1, qtyUnit: "pcs" },
  ];
  const b = bomWeldEnds(bom);
  equal(b.ends.map((e) => [e.size, e.kind, e.n]), [[6, "BW", 8], [0.75, "OLET", 1], [0.75, "SW", 1], [0.75, "THD", 1]]);
  equal([b.total, b.threaded, b.complete, b.missingPts], [10, 1, true, []]);
  const gap = bomWeldEnds([bom[0], bom[1], bom[3]]);
  equal([gap.complete, gap.missingPts], [false, [3]], "PT 3 not read: what it holds is not counted");
  const noq = bomWeldEnds([...bom.slice(0, 2), { ...bom[2], qty: null }]);
  equal([noq.complete, noq.noQty.map((r) => r.pt), noq.total], [false, [3], 4]);
  equal(bomWeldEnds([{ pt: 1, description: "ELBOW 90 LR S40 BW", diam: "6", qty: 1.5, qtyUnit: "pcs" }]).noQty.length, 1, "a piece count that is not whole is not a count");
});

test("against the register: size by size and kind by kind; a weld with no size yet counted apart; threaded joints are not welds", () => {
  const bom = [{ pt: 1, description: "ELBOW 90 LR S40 BW", diam: "6", qty: 2, qtyUnit: "pcs" },
    { pt: 2, description: "FLANGE WELDING NECK S40 150# RF", diam: "6", qty: 1, qtyUnit: "pcs" },
    { pt: 3, description: "CAP 3000# NPT A105", diam: "3/4", qty: 1, qtyUnit: "pcs" }];
  const welds = [{ no: "1", kind: "BW", nps: 6 }, { no: "2", kind: "BW", nps: 6 }, { no: "3", kind: "BW", nps: 6 }, { no: "4", kind: "THD", nps: 0.75 }, { no: "5", kind: "", nps: "" }];
  const c = compareBomWelds(bom, welds);
  equal(c.rows.map((r) => [r.size, r.kind, r.bomEnds, r.welds]), [[6, "BW", 5, 3], [0.75, "THD", 1, 1]]);
  equal([c.total, c.least, c.weldCount, c.unsized], [5, 3, 4, "5".split("")], "5 ends: at least 3 welds (two fittings may share one), the list has 4 besides its threaded joint");
});

await run();
