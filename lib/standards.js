// ASME B36.10M outside diameter (mm)
export const OD = {
  2: 60.3, 3: 88.9, 4: 114.3, 6: 168.3, 8: 219.1, 10: 273.1, 12: 323.9,
  14: 355.6, 16: 406.4, 18: 457.2, 20: 508, 22: 559, 24: 610, 26: 660,
  28: 711, 30: 762, 32: 812.8, 34: 864, 36: 914.4, 42: 1066.8, 48: 1219.2,
};

// ASME B16.9 LR (1.5D) 90 deg elbow, centre-to-face "A" (mm)
export const ELL90 = {
  2: 76, 3: 114, 4: 152, 6: 229, 8: 305, 10: 381, 12: 457, 14: 533,
  16: 610, 18: 686, 20: 762, 22: 838, 24: 914, 26: 991, 28: 1067,
  30: 1143, 32: 1219, 34: 1295, 36: 1372, 42: 1600, 48: 1829,
};

// ASME B16.9 LR 45 deg elbow, centre-to-face "B" (mm)
export const ELL45 = {
  2: 35, 3: 51, 4: 64, 6: 95, 8: 127, 10: 159, 12: 190, 14: 222,
  16: 254, 18: 286, 20: 318, 22: 343, 24: 381, 26: 435, 28: 448,
  30: 476, 32: 502, 34: 533, 36: 565, 42: 660, 48: 756,
};

// ASME B16.9 tee, centre-to-end of run "C" (mm), keyed on the RUN size
export const TEE_C = {
  2: 64, 3: 86, 4: 105, 6: 143, 8: 178, 10: 216, 12: 254, 14: 279,
  16: 305, 18: 343, 20: 381, 22: 406, 24: 432, 26: 495, 28: 521,
  30: 559, 32: 597, 34: 635, 36: 673, 42: 749, 48: 864,
};

/**
 * Which node types actually form a welded joint.
 *
 * A flanged valve is bolted, not welded: it contributes no weld of its own, and
 * the pipe either side of it terminates in a flange that carries its own weld.
 * Everything else on this list joins by welding.
 */
export const WELDED_JOINT = {
  "tie-in": true, elbow90: true, elbow45: true, tee: true, reducer: true,
  "flange-wn": true, "valve-bw": true, "valve-flanged": false,
};
export const isWeldedJoint = (type) => WELDED_JOINT[type] !== false;

/**
 * In-line components whose body sits BETWEEN two collinear legs. A tee's
 * straight-through run is drawn by its own dedicated branch; these are the
 * types that need a body drawn across a collinear pair instead of skipped.
 */
export const INLINE_BODY = new Set(["reducer", "valve-bw"]);

/**
 * Half the body length of an in-line component, in mm.
 *
 * WHERE THE NODE SITS
 *
 * An elbow or a tee has a centreline intersection, and that is what the
 * extraction places its node on. An in-line component — a valve, a reducer, a
 * flange — has no intersection, so the convention has to be stated rather
 * than inferred: **the node sits at the CENTRE of the body**, and each weld
 * is half the body length away from it.
 *
 * That convention is now written into the extraction prompt. Before it was
 * written down the engine assumed it silently and got a reducer twice as long
 * as the fitting it represents.
 *
 * `node.faceToFace` carries the real dimension off the drawing. Tables that
 * would supply it — B16.10 for valves, B16.9 for reducers, B16.5 for flange
 * hubs — key on valve type, pressure class or reduction ratio, none of which
 * the extraction reads, so a table lookup here would be inventing engineering
 * data rather than reading it.
 */
export function bodyHalfLength(node) {
  const ff = Number(node?.faceToFace);
  return Number.isFinite(ff) && ff > 0 ? ff / 2 : 0;
}

/** Kept for the valve call sites; the rule is the same for every in-line body. */
export const valveTakeOut = bodyHalfLength;

/**
 * Approximate B16.9 overall length H for a concentric reducer.
 *
 * `od * 0.62` lands within a couple of millimetres at NPS 12 and drifts by
 * roughly 10% at the extremes of the range, so it is an estimate and is
 * reported as one. A drawing that dimensions the reducer should put the real
 * figure in `node.faceToFace`, which takes precedence.
 */
export const reducerLengthEstimate = (nps) => Math.round(od(nps) * 0.62);

export const od = (nps) => OD[nps] ?? Number(nps) * 25.4 * 1.14;
const pick = (tbl, nps) => {
  if (tbl[nps] != null) return tbl[nps];
  const keys = Object.keys(tbl).map(Number).sort((a, b) => a - b);
  const near = keys.reduce((p, k) => (Math.abs(k - nps) < Math.abs(p - nps) ? k : p), keys[0]);
  return tbl[near] * (od(nps) / od(near));
};

/**
 * Centre-to-face take-out at a node, for one specific incident edge.
 * runNps = the node's governing (largest) size; edgeNps = size of this leg.
 */
export function takeOut(type, runNps, edgeNps, isBranch) {
  const n = Number(runNps) || Number(edgeNps) || 0;
  switch (type) {
    case "elbow90": return pick(ELL90, Number(edgeNps) || n);
    case "elbow45": return pick(ELL45, Number(edgeNps) || n);
    case "tee":
      // B16.9 keys both C (run) and M (branch) on the run size for reduced tees.
      return pick(TEE_C, n);
    case "reducer":
      // HALF the overall length: the node is the centre of the body, so each
      // weld sits H/2 away. Using H itself as the take-out — which this did —
      // modelled every reducer at twice its real length and shortened the
      // pipe either side by about 100 mm at NPS 12.
      return isBranch ? 0 : Math.round(reducerLengthEstimate(n) / 2);
    // A butt-weld valve's half-length comes from the drawing, via valveTakeOut,
    // because B16.10 needs a valve type and class that extraction does not read.
    case "valve-bw":
    case "flange-wn":
    case "valve-flanged":
    case "tie-in":
    default:
      return 0;
  }
}

export const TYPE_FA = {
  "tie-in": "Tie-in",
  elbow90: "زانو ۹۰° LR",
  elbow45: "زانو ۴۵° LR",
  tee: "سه‌راهی",
  reducer: "تبدیل",
  "flange-wn": "فلنج WN",
  "valve-bw": "شیر BW",
  "valve-flanged": "شیر فلنجی",
};
