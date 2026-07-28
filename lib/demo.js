// Reference dataset: ISO SW 265022A, K110 Ethane Cracking Plant, Kavian Olefin-2
export const DEMO = {
  meta: {
    drawingNo: "SW 265022A", rev: "0", sheet: "1/1",
    project: "K110 Ethane Cracking Plant \u2014 Kavian Olefin Plant-2",
    unit: "30", area: "2B01U", pipingClass: "DX01",
    nps: 36, schedule: "SCH 10", clLengthM: 17.0,
    testFluid: "H (Hydrostatic)", testPressureBarg: 12.74,
    insulation: "N \u00d8 (none)", heatTrace: "NONE",
    pipeSpec: "API 5L Gr.B SAW, Bevelled End B16.25, THK B36.10",
    fittingSpec: "ASTM A234 WPB/W, BW Ends, B16.9, SCH 10",
    pupLength: 150, pupNote: "DETAIL A \u2014 pipe length 150 mm typ. each side of every elbow"
  },
  bom: [
    { pt: 1, group: "PIPE", description: "Welded Pipe, API 5L Gr.B SAW, Bevelled End B16-25 THK B36-10, SCH 10", diam: 36, stockCode: "PC06TSS00AB", qty: 12.6 },
    { pt: 2, group: "FITTINGS", description: "Elbow 90 LR, ASTM A234 WPB/W Welded, BW Ends, B16.9, SCH 10", diam: 36, stockCode: "AC03C95J0AB", qty: 1 },
    { pt: 3, group: "FITTINGS", description: "Elbow 45 LR, ASTM A234 WPB/W Welded, BW Ends, B16.9, SCH 10", diam: 36, stockCode: "AC03C45J0AB", qty: 1 },
    { pt: 4, group: "MISCELLANEOUS", description: "Welded Pipe (pup pieces per Detail A), API 5L Gr.B SAW, SCH 10", diam: 36, stockCode: "PC06TSS00AB", qty: 0.6 }
  ],
  nodes: [
    { id: "N1", type: "tie-in",  ref: "2B01U-SW265004A", E: 118948, N: 384836, EL: 96846 },
    { id: "N2", type: "elbow45", ref: "",                E: 118948, N: 385918, EL: 97928 },
    { id: "N3", type: "elbow90", ref: "",                E: 118948, N: 399000, EL: 97928 },
    { id: "N4", type: "tie-in",  ref: "3B04A-SW265022A", E: 118948, N: 399000, EL: 100300 }
  ],
  notes: [
    "For 1 1/2\" and smaller CS piping and 1\" and smaller alloy/SS piping, routing, dimensions and elevations to be checked by field erection contractor before fabrication.",
    "All materials with Gr.316/316L for S.S piping components to be used instead of Gr.304/304L."
  ]
};
