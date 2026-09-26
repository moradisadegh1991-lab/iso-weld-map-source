import * as XLSX from "xlsx";
import { DISCLAIMER_FA, DISCLAIMER_EN, approvalLine, disclaimerRows } from "./disclaimer.mjs";
import { TYPE_FA } from "./standards";

const W = (...w) => w.map((wch) => ({ wch }));

export function exportWorkbook(model, data, approval = null) {
  const meta = data.meta || {};
  const wb = XLSX.utils.book_new();

  /* 1 — Line Data */
  const line = [
    ["ISO WELD MAP — Line Data"],
    [],
    ["Drawing No", meta.drawingNo || ""],
    ["Revision", meta.rev || ""],
    ["Sheet", meta.sheet || ""],
    ["Project", meta.project || ""],
    ["Unit / D.Area", `${meta.unit || ""} / ${meta.area || ""}`],
    ["Piping Class", meta.pipingClass || ""],
    ["Nominal Size", `${meta.nps || model.nps}"`],
    ["Schedule", meta.schedule || ""],
    ["Pipe Spec", meta.pipeSpec || ""],
    ["Fitting Spec", meta.fittingSpec || ""],
    ["Pup Piece", meta.pupLength ? `${meta.pupLength} mm per fitting end` : "none"],
    ["CL Length (drawing)", meta.clLengthM != null ? `${meta.clLengthM} m` : ""],
    ["CL Length (computed)", `${(model.totals.clCalc / 1000).toFixed(2)} m`],
    ["Test Fluid", meta.testFluid || ""],
    ["Test Pressure", meta.testPressureBarg != null ? `${meta.testPressureBarg} Bar g` : ""],
    ["Insulation", meta.insulation || ""],
    ["Heat Trace", meta.heatTrace || ""],
    [],
    ["Weld count", model.totals.welds],
    ["  of which Field", model.totals.field],
    ["  of which Shop", model.totals.shop],
    ["  of which Girth", model.totals.girth],
    ["Spools", model.spoolIds.length],
    [],
    ["Nodes"],
    ["ID", "Type", "E (mm)", "N (mm)", "EL (mm)", "Continuation Ref"],
    ...model.nodes.map((n) => [n.id, TYPE_FA[n.type] ? n.type : n.type, n.E, n.N, n.EL, n.ref || ""]),
  ];
  const wsLine = XLSX.utils.aoa_to_sheet(line);
  wsLine["!cols"] = W(26, 46, 14, 14, 14, 24);
  XLSX.utils.book_append_sheet(wb, wsLine, "Line Data");

  /* 2 — Weld Register (the sheet QC actually fills in) */
  const reg = [
    ["WELD REGISTER", "", "", `${meta.drawingNo || ""} Rev ${meta.rev || ""}`, "", "", "", "", "", "", "", ""],
    [],
    ["Weld No", "Spool", "Shop/Field", "Weld Type", "Joint", "Size", "EL (mm)",
      "NDT Required", "WPS No", "Welder ID", "NDT Report No", "Status"],
    ...model.register.map((w) => [w.no, w.spool, w.loc, w.kind, w.role, w.size, w.el, w.ndt, "", "", "", ""]),
  ];
  const wsReg = XLSX.utils.aoa_to_sheet(reg);
  wsReg["!cols"] = W(10, 9, 11, 11, 24, 13, 12, 15, 14, 13, 16, 12);
  wsReg["!freeze"] = { xSplit: 0, ySplit: 3 };
  wsReg["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + model.register.length, c: 11 } }) };
  XLSX.utils.book_append_sheet(wb, wsReg, "Weld Register");
  XLSX.utils.sheet_add_aoa(wsReg, [[], [DISCLAIMER_FA], [approvalLine(approval)]],
    { origin: -1 });

  /* 3 — Spool List */
  const bySpool = {};
  model.elements.forEach((e) => {
    const s = (bySpool[e.spool] = bySpool[e.spool] || { len: 0, parts: {}, sizes: new Set() });
    s.len += e.length || 0;
    s.parts[e.kind] = (s.parts[e.kind] || 0) + 1;
    s.sizes.add(e.nps || model.nps);
  });
  const spool = [
    ["SPOOL LIST"],
    [],
    ["Spool", "Size(s)", "Length (m)", "Pipe pcs", "Pup pcs", "Fittings", "Internal welds", "Boundary welds"],
    ...model.spoolIds.map((id) => {
      const s = bySpool[id] || { len: 0, parts: {}, sizes: new Set() };
      const inside = model.register.filter((w) => w.spool === id && w.loc === "Shop").length;
      const bound = model.register.filter((w) => w.spool === id && w.loc === "Field").length;
      return [id, [...s.sizes].sort((a, b) => b - a).map((x) => `${x}"`).join(" / "),
        +(s.len / 1000).toFixed(3), s.parts.pipe || 0, s.parts.pup || 0, s.parts.fitting || 0, inside, bound];
    }),
  ];
  const wsSpool = XLSX.utils.aoa_to_sheet(spool);
  wsSpool["!cols"] = W(10, 14, 13, 11, 10, 11, 15, 16);
  XLSX.utils.book_append_sheet(wb, wsSpool, "Spool List");

  /* 4 — MTO, drawing vs computed */
  const mto = [
    ["MATERIAL TAKE-OFF"],
    [],
    ["PT", "Group", "Description", "Diam (in)", "Stock Code", "Qty (drawing)"],
    ...(data.bom || []).map((b) => [b.pt, b.group, b.description, b.diam, b.stockCode, b.qty]),
    [],
    ["Computed from geometry"],
    ["Size (in)", "Straight pipe (m)", "Pup pieces (m)", "Total (m)"],
    ...Object.keys(model.bySize || {}).sort((a, b) => Number(b) - Number(a)).map((k) => [
      Number(k),
      +(model.bySize[k].pipe / 1000).toFixed(3),
      +(model.bySize[k].pup / 1000).toFixed(3),
      +((model.bySize[k].pipe + model.bySize[k].pup) / 1000).toFixed(3),
    ]),
  ];
  const wsMto = XLSX.utils.aoa_to_sheet(mto);
  wsMto["!cols"] = W(6, 18, 62, 11, 16, 16);
  XLSX.utils.book_append_sheet(wb, wsMto, "MTO");

  /* 5 — Validation */
  const val = [
    ["VALIDATION"],
    [],
    ["Check", "Result", "Detail"],
    ...model.checks.map((c) => [c.label, c.status.toUpperCase(), c.detail]),
    [],
    ["Basis"],
    ["Take-outs", "ASME B16.9 (LR elbows, tees)"],
    ["Pipe OD / wall", "ASME B36.10M"],
    ["NDT / preheat / PWHT", "ASME B31.3"],
    ["Note", "Output is a draft. Must be reviewed against the latest revision, the project piping class and the contractor's fabrication philosophy before fabrication."],
  ];
  const wsVal = XLSX.utils.aoa_to_sheet(val);
  wsVal["!cols"] = W(40, 12, 90);
  XLSX.utils.book_append_sheet(wb, wsVal, "Validation");

  /* 6 — Disclaimer. A spreadsheet gets emailed, forwarded and printed, and at
     every hop it stops looking like software output. The warning travels with
     it rather than staying next to the download button. */
  XLSX.utils.book_append_sheet(
    wb, XLSX.utils.aoa_to_sheet(disclaimerRows(approval)), "Disclaimer");

  const name = `${(meta.drawingNo || "weld-register").replace(/\s+/g, "_")}_R${meta.rev || "0"}.xlsx`;
  XLSX.writeFile(wb, name);
}
