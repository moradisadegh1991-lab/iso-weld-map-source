/**
 * The K110 P&ID set's own legend, as printed on its legend sheets.
 * A rule these tables declare is the project's, not this platform's: a code
 * not in them is reported, never mapped to the nearest one.
 *
 *   K110-30-PID-0021-00-01  process sections; line numbering
 *   K110-30-PID-0021-00-02  insulation codes, equipment and material
 *                           tagging system, fluid identification codes
 *   K110-30-PID-0021-00-03  instrument numbering system
 */

export const SECTIONS = {
  "10": "Cracking furnaces",
  "20": "Hot section and dilution steam generation",
  "30": "LP and HP cracked gas compression, caustic wash, drying and spent caustic treatment",
  "40": "Ethylene recovery and purification",
  "50": "Propylene and ethylene refrigerant cycles",
  "60": "Steam, blow down, cooling water, fuel gas and other utilities",
  "70": "Ethylene, C3+, ethane and off-spec ethylene storage tanks; fresh caustic, wash oil, sulfuric acid, methanol and light oil tanks",
  "80": "Flare",
  "90": "Section 90 (no name printed in the legend table)",
};

export const INSULATION = {
  A: "ACOUSTIC INSULATION", C: "COLD INSULATION", E: "ELECTRICAL TRACING", F: "ANTI FREEZING",
  H: "HOT INSULATION", J: "JACKETED", T: "STEAM TRACING", D: "DUAL INSULATION", B: "SOLAR PROTECTION",
  K: "ANTI CONDENSATION", AC: "COLD AND ACOUSTIC INSULATION", AH: "HOT AND ACOUSTIC INSULATION",
  N: "NOT INSULATED", P: "PERSONNAL PROTECTION", W: "TAPE WRAPPED (UNDERGROUND LINES)",
};

export const EQUIPMENT_TYPES = {
  AE: "AIR COOLERS", B: "BOILERS", C: "COMPRESSORS, FANS, EXPANDER", E: "HEAT EXCHANGERS",
  F: "FURNACES (CRACKING FURNACE)", H: "HEATERS (GENERAL COMBUSTION)", J: "EJECTORS, JETS", MX: "MIXERS",
  P: "PUMPS", R: "REACTORS, REGENATORS", S: "FILTERS, STRAINERS", ST: "STEAM TURBINE", T: "TOWERS",
  TK: "STORAGE TANKS AND SPHERES", D: "VESSELS AND DRUMS", W: "PACKAGE UNITS",
  X: "MISCELLANEOUS (DESUPERHEATERS, PITS, SILENCER, FLAME ARRESTOR, ETC..)",
};

export const FLUIDS = {
  AC: "ACID", AF: "ACID FLARE (SOUR GAS)", AP: "PROCESS AIR", AV: "AIR VENT", BD: "BLOWN DOWN",
  BW: "BOILER FEED WATER", BR: "BRINE WATER", CA: "CAUSTIC", CB: "CONTINUOUS BLOW DOWN", CD: "CHEMICAL DRAIN",
  CE: "CONTINUOUS CONTAMINATED EFFLUENT", CF: "COLD FLARE", CH: "CHEMICAL", CW: "COOLING WATER SUPPLY AND RETURN",
  DA: "DECOKING AIR", DC: "COLD DRAIN", DG: "DECOKING GAS", DS: "DILUTION STEAM", DW: "DEMINERALIZED WATER",
  ER: "ETHYLENE REFRIGERANT", FG: "FUEL GAS", FL: "FLUE GAS", FW: "FIRE WATER",
  HC: "HIGH PRESSURE STEAM CONDENSATE", HG: "HYDROGEN", HP: "HIGH PRESSURE STEAM", IA: "INSTRUMENT AIR",
  IB: "INTERMITTENT BLOW DOWN", LC: "LOW PRESSURE CONDENSATE", LF: "LOW PRESSURE FLARE (STORAGE AREA)",
  LO: "LIGHT OIL", LP: "LOW PRESSURE STEAM", LU: "LUBRICATION OIL", ME: "METHANOL",
  MC: "MEDIUM PRESSURE CONDENSATE", MP: "MEDIUM PRESSURE STEAM", N: "NITROGEN", NG: "NATURAL GAS",
  OW: "OILY SEWER WATER", P: "PROCESS (HYDROCARBONS)", PA: "PLANT AIR", PC: "PROCESS CONDENSATE",
  PH: "HYDROCARBON GAS HYDROGEN SERVICE", PR: "PROPYLENE REFRIGERANT", PO: "POTENTIALY OILY CONTAMINATED WATER",
  PW: "POTABLE WATER", QW: "QUENCH WATER", RW: "RAW WATER", SC: "SPENT CAUSTIC", SD: "SODA DRAIN",
  SN: "SANITARY", SO: "SEAL OIL", SW: "SEA WATER SUPPLY AND RETURN", TC: "TURBINE CONDENSATE",
  UW: "UTILITY WATER", VA: "VENT TO ATM", VC: "VACUUM", VH: "HIGH HIGH PRESSURE STEAM", VT: "VESSEL TRIM",
  WD: "DESALINATED WATER (SOFT WATER)", WF: "WET FLARE", WO: "WASH OIL",
};

/** 30-E-1129 → "E"; 30-TK-7001 → "TK"; null when the letters are not in the table. */
export function equipmentType(tag) {
  const m = String(tag).match(/^\d{2}-([A-Z]{1,3})-\d/);
  return m && EQUIPMENT_TYPES[m[1]] ? m[1] : null;
}

/**
 * No legend fluid code starts with X, so an X glued to the front of one
 * (`¾"N` read as `XN`, `1½"PA` as `1xPA`) is the inch mark: the code
 * after it. Anything else → null.
 */
export function inchMarkFluid(code) {
  const m = String(code).match(/^[Xx]([A-Z]{1,2})$/);
  return m && FLUIDS[m[1]] ? m[1] : null;
}

/** Characters this OCR mistakes for each other on these sheets' stroke font. */
const LOOKALIKE = { V: "W", W: "V", O: "DQ", D: "O", Q: "O", I: "L", L: "I" };

/**
 * A fluid code the legend does not have, when exactly one legend code is a
 * single look-alike character away (UV → UW): that code. Two or none → null,
 * and the code stays as read.
 */
export function legendFluid(code) {
  if (FLUIDS[code]) return code;
  const near = new Set();
  [...code].forEach((ch, i) => {
    for (const alt of LOOKALIKE[ch] || "") {
      const c = code.slice(0, i) + alt + code.slice(i + 1);
      if (FLUIDS[c]) near.add(c);
    }
  });
  return near.size === 1 ? [...near][0] : null;
}
