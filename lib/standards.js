// ASME B36.10M outside diameters (mm) and B16.9 LR elbow centre-to-face (mm)
export const OD = {
  2: 60.3, 3: 88.9, 4: 114.3, 6: 168.3, 8: 219.1, 10: 273.1, 12: 323.9,
  14: 355.6, 16: 406.4, 18: 457.2, 20: 508, 24: 610, 30: 762, 36: 914.4,
  42: 1066.8, 48: 1219.2,
};

// LR (1.5D) 90 deg elbow, centre-to-face  "A"
export const ELL90 = {
  2: 76, 3: 114, 4: 152, 6: 229, 8: 305, 10: 381, 12: 457, 14: 533,
  16: 610, 18: 686, 20: 762, 24: 914, 30: 1143, 36: 1372, 42: 1600, 48: 1829,
};

// LR 45 deg elbow, centre-to-face  "B"
export const ELL45 = {
  2: 35, 3: 51, 4: 64, 6: 95, 8: 127, 10: 159, 12: 190, 14: 222,
  16: 254, 18: 286, 20: 318, 24: 381, 30: 476, 36: 565, 42: 660, 48: 756,
};

export const od = (nps) => OD[nps] ?? nps * 25.4 * 1.14;

/** Centre-to-face take-out for a node type, mm. */
export function takeOut(type, nps) {
  const d = od(nps);
  switch (type) {
    case "elbow90": return ELL90[nps] ?? 1.5 * d;
    case "elbow45": return ELL45[nps] ?? 1.5 * d * Math.tan(Math.PI / 8);
    case "tee": return ELL90[nps] ? ELL90[nps] * 0.85 : 1.27 * d;
    case "reducer": return 0.5 * d;
    default: return 0; // tie-in, weld point, flange face
  }
}

/** Welds produced at a node. */
export function weldsAtNode(type, hasPup) {
  if (type === "tie-in") return 1;
  if (type === "flange-wn") return 1;
  if (type === "valve-bw") return 2;
  if (type === "valve-flanged") return 0;
  if (type === "reducer") return hasPup ? 4 : 2;
  if (type === "tee") return hasPup ? 5 : 3;
  if (type === "elbow90" || type === "elbow45") return hasPup ? 4 : 2;
  return 2;
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
