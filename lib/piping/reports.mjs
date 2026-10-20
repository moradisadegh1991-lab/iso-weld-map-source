/**
 * Piping reports as workbooks — Weld Log, Bill of Materials, NDT Metrics,
 * Progress and a load's Packing List — laid out as the Piping.Tools exports
 * the owner sent (2026-10-20), built from what the platform holds. No model
 * is called: every cell is a stored fact or arithmetic on stored facts.
 *
 * Pure: the caller (lib/db/repos/piping-reports.mjs) reads the rows, these
 * functions shape them, `toXlsx` writes the file. What the platform does not
 * hold is left blank and the Summary sheet says which columns those are —
 * a blank is never filled with a typical value:
 *
 *   OD and wall     from the line's piping class (class size table) only;
 *                   no ASME B36.10 lookup from a schedule label
 *   heat numbers    not recorded per weld (the warehouse holds them per lot)
 *   BOM unit        only when the drawing's BOM row carried one
 *   length          only for spools whose length the engine worked out
 *
 * Lengths are metres (SI), not the feet of the source reports.
 */
import * as XLSX from "xlsx";

export const NDT_METHODS = ["RT", "UT", "MT", "PT", "VT"];

/** The NDT compliance states of lib/ndt/compliance.mjs, in the report's language. */
export const STATUS_EN = {
  not_welded: "Not welded", unknown: "NDT requirement not set", sample_not_drawn: "Random sample not drawn",
  no_welder: "No welder recorded — in no lot", welder_unsampled: "No sample from this welder's work",
  awaiting: "Awaiting NDT", awaiting_sample: "Awaiting the lot's sample", rejected: "Rejected — repair and re-examine",
  progressive: "Progressive examination (§341.3.4) open", full_examination: "Lot rejected — every weld of the lot examined",
  extension_unknown: "Sample rejected; extension not set in the NDT matrix",
  accepted: "Accepted", accepted_by_sample: "Accepted by the lot's sample",
};

// ── shared ───────────────────────────────────────────────────────────────

const round = (n, d = 3) => (n == null || !isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const pct = (part, whole) => (whole > 0 ? round((part / whole) * 100, 1) : 0);
const sum = (xs) => xs.reduce((s, x) => s + (Number(x) || 0), 0);
const blank = (v) => (v == null ? "" : v);
const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : "");
const stamp = (now) => {
  const d = now instanceof Date ? now : new Date(now);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

/** The three title rows every detailed sheet of the source reports opens with. */
const titled = (title, project, scope, header, rows, width) => ({
  rows: [[title], [project], [scope || ""], header, ...rows],
  merges: [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: Math.min(width, header.length) - 1 } })),
  headerRow: 3,
});

const summary = (title, project, pairs) => ({
  name: "Summary",
  rows: [[title], [project], [""], ...pairs.map(([k, v]) => [k, null, v])],
  merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    ...pairs.map((_, i) => ({ s: { r: i + 3, c: 2 }, e: { r: i + 3, c: 5 } }))],
  cols: [22, 4, 60],
});

/** A two-column Metric/Value summary, as the NDT, Progress and Packing reports use. */
const metrics = (pairs) => ({ name: "Summary", rows: [["Metric", "Value"], ...pairs], cols: [34, 40], headerRow: 0 });

const table = (name, header, rows, cols) => ({ name, rows: [header, ...rows], cols, headerRow: 0 });

// ── Weld Log ─────────────────────────────────────────────────────────────

export const WELD_LOG_HEADER = ["Drawing No", "Sheet #", "Weld No", "Spool", "S/F", "Date Welded", "Size", "OD (mm)", "Wall (mm)",
  "Type", "Schedule", "Material", "WPS No", "Welder ID", "Item 1 (Fitting Type)", "Heat No 1", "Certificate No 1",
  "Item 2 (Fitting Type)", "Heat No 2", "Certificate No 2", "NDT", ...NDT_METHODS.map((m) => `NDT ${m}`),
  "Remarks", "System", "Transmittal", "Load"];

/** One weld's result for one method: its latest cycle, with the report it is on. */
const methodCell = (r) => (!r ? "" : [r.result, r.reportNo].filter(Boolean).join(" · "));

/**
 * @param {object} p
 * @param {Array} p.welds  { drawingNo, sheet, weldNo, spool, shopField, weldedAt, nps, odMm, wallMm, kind,
 *                           schedule, material, wps, welder, requirement, status, byMethod:{RT:{result,reportNo}},
 *                           line, transmittal, load }
 */
export function weldLog({ project, scope, now, welds }) {
  const rows = welds.map((w) => [w.drawingNo, w.sheet, w.weldNo, blank(w.spool), w.shopField, isoDay(w.weldedAt),
    w.nps ?? "", blank(round(w.odMm, 2)), blank(round(w.wallMm, 2)), blank(w.kind), blank(w.schedule), blank(w.material),
    blank(w.wps), blank(w.welder), "", "", "", "", "", "", blank(w.requirement) || "N/A",
    ...NDT_METHODS.map((m) => methodCell(w.byMethod?.[m])), blank(w.status), blank(w.line), blank(w.transmittal), blank(w.load)]);
  const detail = { name: "Weld Log Detailed", ...titled("Weld Log", project, scope, WELD_LOG_HEADER, rows, 9),
    cols: [20, 7, 8, 8, 6, 11, 6, 8, 8, 6, 8, 16, 10, 9, 10, 9, 10, 10, 9, 10, 14, 14, 14, 14, 14, 14, 22, 26, 12, 10] };
  // the source report closes with a SUBTOTAL of the size column: inch-dia that
  // follows the sheet's own filter
  const first = 5, last = 4 + rows.length;
  detail.filterLast = detail.rows.length - 1;
  detail.rows.push(["Filtered total", null, null, null, null, null, rows.length ? { f: `SUBTOTAL(109,G${first}:G${last})` } : 0]);
  const unsized = welds.filter((w) => !(w.nps > 0)).length;
  const noClassSize = welds.filter((w) => w.odMm == null).length;
  return { sheets: [summary("Weld Log", project, [
    ["Generated", stamp(now)], ["Scope", scope], ["Records", welds.length],
    ["Inch-dia", round(sum(welds.map((w) => w.nps)), 2)],
    ["Welds without a size", unsized],
    ["OD / wall", noClassSize ? `blank on ${noClassSize} welds: the line's piping class has no size row for them` : "from the piping class of each line"],
    ["Heat / certificate per weld", "not recorded per weld — the warehouse holds heat numbers per material lot"],
  ]), detail] };
}

// ── Bill of Materials ────────────────────────────────────────────────────

/** Printed text, read — not inferred: the schedule and the material standard a BOM row names. */
export function bomSchedule(description) {
  const m = String(description || "").match(/\b(?:SCH\.?\s*|S)(\d{1,3}S?|XXS|XS|STD)\b/i);
  return m ? `S${m[1].toUpperCase()}` : "";
}
export function bomMaterial(description) {
  const m = String(description || "").match(/\b(API\s?5L|A\s?\d{3}(?:-(?:WCB|WPB[A-Z]*|F\d+[A-Z]?|[A-Z]{1,3}\d?))?|B\d{3})\b/i);
  return m ? m[1].toUpperCase().replace(/^A\s(\d)/, "A$1").replace(/^API(5L)$/, "API 5L") : "";
}

/**
 * @param {Array} p.drawings  { drawingNo, sheet, rev, bom: [{ qty, uom, diam, description }] }
 */
export function billOfMaterials({ project, scope, now, drawings }) {
  const header = ["Drawing No", "Sheet #", "Revision", "Qty", "Unit", "Dimensions", "Description", "Schedule", "Material Spec"];
  const lines = drawings.flatMap((d) => (d.bom || []).map((b) => ({ ...b, drawingNo: d.drawingNo, sheet: d.sheet, rev: d.rev })));
  const detailed = lines.map((b) => [b.drawingNo, b.sheet, b.rev, b.qty ?? "", blank(b.uom), blank(b.diam), blank(b.description),
    bomSchedule(b.description) || "-", bomMaterial(b.description) || "-"]);
  const groups = new Map();
  for (const b of lines) {
    const k = [b.uom || "", b.diam ?? "", b.description || ""].join("|");
    const g = groups.get(k) || { qty: 0, uom: b.uom, diam: b.diam, description: b.description, qtyUnknown: false };
    if (b.qty == null || !isFinite(Number(b.qty))) g.qtyUnknown = true; else g.qty += Number(b.qty);
    groups.set(k, g);
  }
  const summaryRows = [...groups.values()]
    .sort((a, b) => String(a.description).localeCompare(String(b.description)) || String(a.diam).localeCompare(String(b.diam)))
    .map((g) => [g.qtyUnknown ? `${round(g.qty)} + unread` : round(g.qty), blank(g.uom), blank(g.diam), blank(g.description),
      bomSchedule(g.description) || "-", bomMaterial(g.description) || "-"]);
  const missing = drawings.filter((d) => !(d.bom || []).length);
  return { sheets: [
    summary("Bill of Materials", project, [["Generated", stamp(now)], ["Scope", scope], ["Records", lines.length],
      ["Drawings Missing BOM", missing.length], ...(missing.length ? [["Missing on", missing.map((d) => `${d.drawingNo} ${d.sheet}`).join(", ")]] : []),
      ["Unit", lines.some((b) => !b.uom) ? "blank where the drawing's BOM row gave none" : "as the drawings give it"]]),
    { name: "Bill of Materials Detailed", ...titled("Bill of Materials", project, scope, header, detailed, 6), cols: [20, 7, 8, 8, 6, 10, 70, 9, 13] },
    { name: "BOM Summary", ...titled("BOM Summary", project, scope, header.slice(3), summaryRows, 6), cols: [10, 6, 10, 70, 9, 13] },
  ] };
}

// ── NDT Metrics ──────────────────────────────────────────────────────────

/** A weld counts as NDT'd when any method has a result on it (pending is not a result). */
const examined = (w) => NDT_METHODS.some((m) => w.byMethod?.[m] && w.byMethod[m].result !== "pending");

export function ndtMetrics({ project, jobNo, now, welds }) {
  const cover = (ws) => ({ total: ws.length, done: ws.filter(examined).length });
  const group = (key) => {
    const g = new Map();
    for (const w of welds) { const k = key(w) || "Unknown"; g.set(k, [...(g.get(k) || []), w]); }
    return [...g.entries()].map(([k, ws]) => { const c = cover(ws); return [k, c.total, c.done, pct(c.done, c.total)]; })
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  };
  const all = cover(welds), shop = cover(welds.filter((w) => w.shopField === "Shop")), field = cover(welds.filter((w) => w.shopField === "Field"));
  const results = ["accept", "reject", "pending"];
  const byType = NDT_METHODS.map((m) => {
    const rs = welds.map((w) => w.byMethod?.[m]).filter(Boolean);
    return { m, tested: rs.filter((r) => r.result !== "pending").length,
      counts: [...results.map((r) => rs.filter((x) => x.result === r).length), rs.filter((x) => !results.includes(x.result)).length] };
  });
  const reports = new Set(welds.flatMap((w) => NDT_METHODS.map((m) => w.byMethod?.[m]?.reportNo).filter(Boolean)));
  return { sheets: [
    metrics([["Project Name", project], ["Job Number", jobNo || "N/A"], ["Generated At", stamp(now)],
      ["% of Welds NDT'd", pct(all.done, all.total)], ["% of Shop Welds NDT'd", pct(shop.done, shop.total)],
      ["% of Field Welds NDT'd", pct(field.done, field.total)], ["NDT Reports", reports.size],
      ["Included methods", NDT_METHODS.join(", ")], ["Total Welds", all.total], ["NDT'd Welds", all.done],
      ["Systems", new Set(welds.map((w) => w.line || "Unknown")).size],
      ["Note", "coverage counts any result on a weld; whether a weld's required examination is complete (B31.3 sampling) is the NDT status on the Weld Log"]]),
    table("NDT by Welder", ["Welder ID", "Total Welds", "NDT'd Welds", "Coverage %"], group((w) => w.welder), [14, 12, 12, 11]),
    table("NDT by System", ["System", "Total Welds", "NDT'd Welds", "Coverage %"], group((w) => w.line), [30, 12, 12, 11]),
    table("NDT Type Coverage", ["NDT Type", "Tested Welds", "Coverage %"], byType.map((t) => [t.m, t.tested, pct(t.tested, all.total)]), [10, 13, 11]),
    table("NDT Type Status", ["NDT Type", "Accept", "Reject", "Pending", "Other"], byType.map((t) => [t.m, ...t.counts]), [10, 9, 9, 9, 9]),
  ] };
}

// ── Progress ─────────────────────────────────────────────────────────────

/**
 * Phases, in the platform's own terms (lib/platform/precedence.mjs PIPING_SPOOL):
 *   Released, Fit-up, Erected   spool steps, measured in metres of spool
 *   Shop welding, Field welding inch-dia welded
 *   NDT                         inch-dia whose required examination is complete
 *   Delivered                   metres of spool on a delivered load
 * A spool whose length the engine did not work out adds nothing to metres;
 * the Summary says how many.
 */
export const PHASES = [
  { key: "released", label: "Released to shop", unit: "m" },
  { key: "fit_up", label: "Fit-up", unit: "m" },
  { key: "shop_weld", label: "Shop welding", unit: "inch-dia" },
  { key: "ndt", label: "NDT complete", unit: "inch-dia" },
  { key: "delivered", label: "Delivered to site", unit: "m" },
  { key: "erected", label: "Erected", unit: "m" },
  { key: "field_weld", label: "Field welding", unit: "inch-dia" },
];

/** Saturday, the first day of the Iranian working week, on or before d. */
export function weekStart(d) {
  const x = new Date(`${isoDay(d)}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 1) % 7));
  return x.toISOString().slice(0, 10);
}

function phaseTotals(welds, spools) {
  const m = (sp) => (sp.lengthMm > 0 ? sp.lengthMm / 1000 : 0);
  const di = (ws) => sum(ws.map((w) => w.nps));
  const shop = welds.filter((w) => w.shopField === "Shop"), field = welds.filter((w) => w.shopField === "Field");
  const spoolPhase = (k) => ({ done: sum(spools.filter((s) => s[k]).map(m)), total: sum(spools.map(m)) });
  return {
    released: spoolPhase("released"), fit_up: spoolPhase("fit_up"), erected: spoolPhase("erected"), delivered: spoolPhase("delivered"),
    shop_weld: { done: di(shop.filter((w) => w.welded)), total: di(shop) },
    field_weld: { done: di(field.filter((w) => w.welded)), total: di(field) },
    ndt: { done: di(welds.filter((w) => w.ndtDone)), total: di(welds) },
  };
}

/**
 * @param {Array} p.drawings { drawingNo, sheet, transmittal }
 * @param {Array} p.welds    { drawingNo, sheet, nps, shopField, welded, weldedAt, ndtDone }
 * @param {Array} p.spools   { drawingNo, sheet, spool, lengthMm, released, fit_up, erected, delivered }
 */
export function progress({ project, jobNo, scope, now, drawings, welds, spools }) {
  const of = (d) => (x) => x.drawingNo === d.drawingNo && x.sheet === d.sheet;
  const overall = (t) => {
    const parts = PHASES.map((p) => (t[p.key].total > 0 ? t[p.key].done / t[p.key].total : null)).filter((x) => x !== null);
    return parts.length ? round((sum(parts) / parts.length) * 100, 1) : 0;
  };
  const detail = drawings.map((d) => {
    const t = phaseTotals(welds.filter(of(d)), spools.filter(of(d)));
    const ws = welds.filter(of(d)), ss = spools.filter(of(d));
    return [d.drawingNo, d.sheet, blank(d.transmittal), round(sum(ws.map((w) => w.nps)), 2),
      round(sum(ss.map((s) => (s.lengthMm > 0 ? s.lengthMm / 1000 : 0))), 2), ss.length,
      ...PHASES.map((p) => pct(t[p.key].done, t[p.key].total)), overall(t)];
  });
  const t = phaseTotals(welds, spools);
  const shopField = ["Shop", "Field"].map((sf) => {
    const ws = welds.filter((w) => w.shopField === sf);
    const total = sum(ws.map((w) => w.nps)), done = sum(ws.filter((w) => w.welded).map((w) => w.nps));
    return [sf, ws.length, round(total, 2), round(done, 2), round(total - done, 2), pct(done, total)];
  });
  const trs = new Map();
  for (const d of drawings) if (d.transmittal) trs.set(d.transmittal, [...(trs.get(d.transmittal) || []), d]);
  const trRows = [...trs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([no, ds]) => {
    const ws = welds.filter((w) => ds.some((d) => of(d)(w))), ss = spools.filter((s) => ds.some((d) => of(d)(s)));
    const tt = phaseTotals(ws, ss);
    return [no, ds.length, round(sum(ws.map((w) => w.nps)), 2), overall(tt), ...PHASES.map((p) => pct(tt[p.key].done, tt[p.key].total))];
  });
  const weeks = new Map();
  for (const w of welds.filter((x) => x.welded && x.weldedAt)) {
    const k = weekStart(w.weldedAt);
    const e = weeks.get(k) || { di: 0, n: 0 };
    e.di += Number(w.nps) || 0; e.n += 1; weeks.set(k, e);
  }
  const trend = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, e]) => [k, round(e.di, 2), e.n]);
  const noLength = spools.filter((s) => !(s.lengthMm > 0)).length;
  return { sheets: [
    metrics([["Project Name", project], ["Job Number", jobNo || "N/A"], ["Generated At", stamp(now)], ["Scope", scope],
      ["Total Drawings", drawings.length], ["Total inch-dia", round(t.ndt.total, 2)],
      ["Inch-dia welded", round(t.shop_weld.done + t.field_weld.done, 2)],
      ["Inch-dia remaining", round(t.ndt.total - t.shop_weld.done - t.field_weld.done, 2)],
      ["Spools", spools.length], ["Spool length (m)", round(t.released.total, 2)],
      ["Spools without a length", noLength], ["Erected / total (m)", `${round(t.erected.done, 2)} / ${round(t.erected.total, 2)}`],
      ["Week starts", "Saturday"]]),
    table("Detailed Progress Log", ["Drawing No", "Sheet #", "Transmittal No", "Inch-dia", "Spool length (m)", "Spools",
      ...PHASES.map((p) => `${p.label} %`), "Overall %"], detail, [20, 7, 13, 9, 13, 7, ...PHASES.map(() => 13), 10]),
    table("Phase Breakdown", ["Rank", "Phase", "Completion %"], PHASES.map((p, i) => [i + 1, p.label, pct(t[p.key].done, t[p.key].total)]), [6, 20, 13]),
    table("Shop vs Field", ["Scope", "Weld Count", "Total inch-dia", "Welded inch-dia", "Remaining inch-dia", "Completion %"], shopField, [8, 11, 14, 15, 17, 13]),
    table("Transmittal Completion", ["Transmittal No", "Drawings", "Inch-dia", "Overall %", ...PHASES.map((p) => `${p.label} %`)],
      trRows.length ? trRows : [["No drawing is on a transmittal"]], [14, 9, 9, 10, ...PHASES.map(() => 13)]),
    table("Weekly Trend", ["Week Start (Sat)", "Welded inch-dia", "Welded Count"], trend.length ? trend : [["No dated welding yet"]], [16, 15, 13]),
    table("Capacity", ["Phase", "Complete", "Total", "Remaining", "Completion %", "Unit"],
      PHASES.map((p) => [p.label, round(t[p.key].done, 2), round(t[p.key].total, 2), round(t[p.key].total - t[p.key].done, 2), pct(t[p.key].done, t[p.key].total), p.unit]),
      [20, 10, 10, 11, 13, 9]),
  ] };
}

// ── Packing List ─────────────────────────────────────────────────────────

const LOAD_STATUS = { pending: "Pending", shipped: "Shipped", delivered: "Delivered" };

/**
 * @param {object} p.load    { loadNo, status, destination, leaveOn, deliveredOn, notes }
 * @param {Array}  p.spools  { drawingNo, sheet, rev, spool, inspectedBy, inspectedOn, lengthMm }
 * @param {Array}  p.items   { drawingRef, spools, itemNo, description, qty, uom, notes }
 */
export function packingList({ project, jobNo, now, load, spools, items }) {
  const byUnit = new Map();
  for (const i of items) byUnit.set(i.uom, (byUnit.get(i.uom) || 0) + Number(i.qty));
  return { sheets: [
    metrics([["Project Name", project], ["Job Number", jobNo || "N/A"], ["Generated At", stamp(now)],
      ["Scope", `${load.loadNo} Packing List`], ["Load", load.loadNo], ["Status", LOAD_STATUS[load.status] || load.status],
      ["Spool Count", spools.length], ["Shiploose Count", items.length],
      ["Total Spool Length (m)", round(sum(spools.map((s) => (s.lengthMm > 0 ? s.lengthMm / 1000 : 0))), 2)],
      ["Spools without a length", spools.filter((s) => !(s.lengthMm > 0)).length],
      ["Shiploose Totals By Unit", byUnit.size ? [...byUnit.entries()].map(([u, q]) => `${round(q)} ${u}`).join(", ") : "None"],
      ["Delivery Address", load.destination || "N/A"], ["Leave Date", isoDay(load.leaveOn) || "N/A"],
      ["Delivered On", isoDay(load.deliveredOn) || "N/A"], ["Additional Notes", load.notes || "N/A"]]),
    table("Spools", ["Drawing No", "Sheet #", "Revision", "Spool", "Inspection By", "Inspection Date", "Length (m)", "Load", "Status", "Leave Date"],
      spools.map((s) => [s.drawingNo, s.sheet, s.rev, s.spool, blank(s.inspectedBy), isoDay(s.inspectedOn),
        s.lengthMm > 0 ? round(s.lengthMm / 1000, 2) : "", load.loadNo, LOAD_STATUS[load.status] || load.status, isoDay(load.leaveOn)]),
      [20, 7, 8, 8, 13, 14, 10, 10, 10, 11]),
    table("Shiploose", ["Drawing No", "Associated Spools", "Item No", "Description", "Qty", "Unit", "Notes"],
      items.map((i) => [blank(i.drawingRef), blank(i.spools), blank(i.itemNo), i.description, Number(i.qty), i.uom, blank(i.notes)]),
      [20, 16, 8, 50, 8, 6, 24]),
  ] };
}

// ── import template ──────────────────────────────────────────────────────

/** The blank weld-log template, as the source's: one row per weld, IDs kept consistent with drawing revisions. */
export const WELD_LOG_TEMPLATE = ["Drawing No", "Weld No", "Spool", "S/F", "Date", "Size", "OD", "Wall", "Type", "Schedule", "Material",
  "PQR No", "Welder ID", "Heat No", "Heat No 2", "NDT", "Remarks", "System", "Transmittal", "Load"];

// ── writing ──────────────────────────────────────────────────────────────

/** Workbook bytes. Header rows are frozen and filtered, as in the source reports. */
export function toXlsx({ sheets }) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.map((v) => (v && typeof v === "object" && v.f ? { t: "n", f: v.f } : v))));
    if (s.merges?.length) ws["!merges"] = s.merges;
    if (s.cols) ws["!cols"] = s.cols.map((wch) => ({ wch }));
    if (s.headerRow != null && s.rows.length > s.headerRow + 1) {
      const width = s.rows[s.headerRow].length;
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: s.headerRow, c: 0 }, e: { r: s.filterLast ?? s.rows.length - 1, c: width - 1 } }) };
    }
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
