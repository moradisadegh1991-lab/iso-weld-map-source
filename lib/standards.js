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
      // B16.9 reducer overall length H; the vertex sits at the large end.
      return isBranch ? 0 : Math.round(od(n) * 0.62);
    case "flange-wn":
    case "valve-flanged":
    case "valve-bw":
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
