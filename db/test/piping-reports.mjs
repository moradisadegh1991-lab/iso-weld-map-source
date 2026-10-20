#!/usr/bin/env node
/**
 * Piping reports without a model (owner's request 2026-10-20): Weld Log,
 * Bill of Materials, NDT Metrics, Progress and a load's Packing List, laid
 * out as the Piping.Tools exports — and the spool loads they ship on.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import * as XLSX from "xlsx";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { weldLog, billOfMaterials, ndtMetrics, progress, packingList, toXlsx, bomSchedule, bomMaterial, weekStart,
  WELD_LOG_HEADER, PHASES } from "../../lib/piping/reports.mjs";

const NOW = new Date("2026-10-20T15:26:00Z");
const sheet = (spec, name) => spec.sheets.find((s) => s.name === name);
const pairs = (spec) => Object.fromEntries(spec.sheets[0].rows.map((r) => [r[0], r[2] ?? r[1]]));

// ── the builders ─────────────────────────────────────────────────────────

const W = (no, o = {}) => ({ drawingNo: "ISO-1", sheet: "1/1", weldNo: no, spool: "S1", shopField: "Shop", nps: 2, kind: "BW", byMethod: {}, line: "2-LC-1", ...o });

test("weld log: the source's 30 columns, a blank where the platform holds nothing, and the filtered inch-dia total", async () => {
  equal(WELD_LOG_HEADER.length, 30);
  const spec = weldLog({ project: "F110", scope: "All Drawings", now: NOW, welds: [
    W("1", { odMm: 60.3, wallMm: 3.91, welder: "W-07", wps: "WPS-01", weldedAt: "2026-10-12", byMethod: { RT: { result: "accept", reportNo: "RT-9" } } }),
    W("2", { nps: null }),
  ] });
  const d = sheet(spec, "Weld Log Detailed");
  equal(d.rows[3], WELD_LOG_HEADER, "three title rows, then the header");
  const [r1, r2] = [d.rows[4], d.rows[5]];
  equal([r1[7], r1[8], r1[13], r1[12], r1[5], r1[21]], [60.3, 3.91, "W-07", "WPS-01", "2026-10-12", "accept · RT-9"]);
  equal([r2[6], r2[7], r2[8], r2[15]], ["", "", "", ""], "no size, no class size, no heat: blank — not a typical value");
  equal(d.rows.at(-1)[6], { f: "SUBTOTAL(109,G5:G6)" });
  const s = pairs(spec);
  equal([s.Records, s["Inch-dia"], s["Welds without a size"]], [2, 2, 1]);
  assert(/blank on 1 welds/.test(s["OD / wall"]) && /not recorded per weld/.test(s["Heat / certificate per weld"]));
});

test("BOM: schedule and material are read off the printed description; the summary adds like rows and says when a qty is unread", async () => {
  equal([bomSchedule("PIPE S40 BE ERW API 5L-B"), bomSchedule("ELBOW 90 LR SCH 80 BW"), bomSchedule("GASKET 150# RF")], ["S40", "S80", ""]);
  equal([bomMaterial("PIPE S40 BE ERW(EJ=0.85) API 5L-B PSL1"), bomMaterial("ELBOW 90 LR S40 BW A234-WPBW ERW"),
    bomMaterial("FLANGE WN 150# RF A105 ASME B16.5"), bomMaterial("VALVE BALL A216-WCB BODY"), bomMaterial("STRESS SUPPORT")],
  ["API 5L", "A234-WPBW", "A105", "A216-WCB", ""]);
  const elbow = "ELBOW 90 LR S40 BW A234-WPBW ASME B16.9";
  const spec = billOfMaterials({ project: "F110", scope: "All Drawings", now: NOW, drawings: [
    { drawingNo: "ISO-1", sheet: "1/1", rev: "0", bom: [{ qty: 3, uom: "EA", diam: 2, description: elbow }, { qty: 3.9, uom: "M", diam: 2, description: "PIPE S40 BE ERW API 5L-B" }] },
    { drawingNo: "ISO-2", sheet: "1/1", rev: "1", bom: [{ qty: 2, uom: "EA", diam: 2, description: elbow }, { qty: null, uom: "EA", diam: 2, description: elbow }] },
    { drawingNo: "ISO-3", sheet: "1/1", rev: "0", bom: [] },
  ] });
  equal(sheet(spec, "Bill of Materials Detailed").rows.length, 4 + 4);
  const sum = sheet(spec, "BOM Summary").rows.slice(4);
  equal(sum.find((r) => r[3] === elbow).slice(0, 6), ["5 + unread", "EA", 2, elbow, "S40", "A234-WPBW"],
    "a row the drawing gave no quantity for is not counted as zero");
  equal([pairs(spec)["Drawings Missing BOM"], pairs(spec)["Missing on"]], [1, "ISO-3 1/1"]);
});

test("NDT metrics: coverage by welder, system and method; pending is not a result", async () => {
  const spec = ndtMetrics({ project: "F110", now: NOW, welds: [
    W("1", { welder: "A", byMethod: { RT: { result: "accept", reportNo: "R1" } } }),
    W("2", { welder: "A", byMethod: { RT: { result: "pending" } } }),
    W("3", { welder: "B", shopField: "Field", line: "3-LC-2", byMethod: { PT: { result: "reject", reportNo: "P1" } } }),
    W("4", { welder: null }),
  ] });
  const m = Object.fromEntries(spec.sheets[0].rows.slice(1));
  equal([m["Total Welds"], m["NDT'd Welds"], m["% of Welds NDT'd"], m["% of Shop Welds NDT'd"], m["% of Field Welds NDT'd"], m["NDT Reports"]],
    [4, 2, 50, 33.3, 100, 2]);
  equal(sheet(spec, "NDT by Welder").rows.slice(1), [["A", 2, 1, 50], ["B", 1, 1, 100], ["Unknown", 1, 0, 0]]);
  equal(sheet(spec, "NDT Type Status").rows.find((r) => r[0] === "RT"), ["RT", 1, 0, 1, 0]);
  equal(sheet(spec, "NDT Type Coverage").rows.find((r) => r[0] === "PT"), ["PT", 1, 25]);
});

test("progress: each phase in its own measure, a spool without a length adds no metres, weeks start on Saturday", async () => {
  equal([weekStart("2026-10-17"), weekStart("2026-10-20"), weekStart("2026-10-23")], ["2026-10-17", "2026-10-17", "2026-10-17"]);
  equal(weekStart("2026-10-24"), "2026-10-24");
  const spec = progress({ project: "F110", scope: "All Drawings", now: NOW,
    drawings: [{ drawingNo: "ISO-1", sheet: "1/1", transmittal: "TR-01" }, { drawingNo: "ISO-2", sheet: "1/1", transmittal: null }],
    welds: [W("1", { welded: true, weldedAt: "2026-10-18", ndtDone: true }), W("2", { nps: 6, welded: true, weldedAt: "2026-10-25" }),
      W("3", { shopField: "Field", nps: 2 }), W("1", { drawingNo: "ISO-2", nps: 4 })],
    spools: [{ drawingNo: "ISO-1", sheet: "1/1", spool: "S1", lengthMm: 6000, released: true, fit_up: true, erected: false, delivered: true },
      { drawingNo: "ISO-1", sheet: "1/1", spool: "S2", lengthMm: 4000, released: true, fit_up: false, erected: false, delivered: false },
      { drawingNo: "ISO-2", sheet: "1/1", spool: "S1", lengthMm: null, released: true }] });
  const cap = Object.fromEntries(sheet(spec, "Capacity").rows.slice(1).map((r) => [r[0], r.slice(1)]));
  equal(cap["Released to shop"], [10, 10, 0, 100, "m"], "the spool without a length adds nothing to either side");
  equal(cap["Fit-up"], [6, 10, 4, 60, "m"]);
  equal(cap["Shop welding"], [8, 12, 4, 66.7, "inch-dia"]);
  equal(cap["Field welding"], [0, 2, 2, 0, "inch-dia"]);
  equal(cap["NDT complete"], [2, 14, 12, 14.3, "inch-dia"]);
  equal(cap["Delivered to site"], [6, 10, 4, 60, "m"]);
  equal(sheet(spec, "Weekly Trend").rows.slice(1), [["2026-10-17", 2, 1], ["2026-10-24", 6, 1]]);
  equal(sheet(spec, "Transmittal Completion").rows.slice(1).map((r) => r.slice(0, 3)), [["TR-01", 1, 10]]);
  equal(Object.fromEntries(spec.sheets[0].rows)["Spools without a length"], 1);
  equal(sheet(spec, "Detailed Progress Log").rows[0].length, 6 + PHASES.length + 1);
});

test("packing list: a load's spools in metres and its ship-loose totals by unit", async () => {
  const spec = packingList({ project: "F110", now: NOW,
    load: { loadNo: "Load 1", status: "shipped", destination: "Site gate 3", leaveOn: "2026-10-21" },
    spools: [{ drawingNo: "ISO-1", sheet: "1/1", rev: "0", spool: "S1", lengthMm: 6500 }, { drawingNo: "ISO-1", sheet: "1/1", rev: "0", spool: "S2", lengthMm: null }],
    items: [{ description: "GASKET 150# RF", qty: 4, uom: "EA" }, { description: "STUD BOLT", qty: 16, uom: "EA" }, { description: "PIPE", qty: 1.5, uom: "M" }] });
  const m = Object.fromEntries(spec.sheets[0].rows);
  equal([m.Status, m["Spool Count"], m["Total Spool Length (m)"], m["Spools without a length"], m["Shiploose Totals By Unit"], m["Leave Date"]],
    ["Shipped", 2, 6.5, 1, "20 EA, 1.5 M", "2026-10-21"]);
  equal(sheet(spec, "Spools").rows[1].slice(6, 9), [6.5, "Load 1", "Shipped"]);
});

test("the workbook opens, with the filter over the data and not the total row", async () => {
  const spec = weldLog({ project: "P", scope: "All Drawings", now: NOW, welds: [W("1"), W("2")] });
  const wb = XLSX.read(toXlsx(spec), { type: "buffer" });
  equal(wb.SheetNames, ["Summary", "Weld Log Detailed"]);
  const ws = wb.Sheets["Weld Log Detailed"];
  equal([ws.A4.v, ws.C5.v, ws.G7.f], ["Drawing No", "1", "SUBTOTAL(109,G5:G6)"]);
  equal(ws["!autofilter"].ref, "A4:AD6");
});

// ── a weld log of many drawings, back in ─────────────────────────────────

const { splitWeldLog, weldLogSheetName, headerRow } = await import("../../lib/register/weld-log-import.mjs");
const { modelFromWeldList } = await import("../../lib/register/weld-list.mjs");
const LOG_HEAD = ["Drawing No", "Sheet #", "Weld No", "Spool", "S/F", "Date Welded", "Size", "Type", "System"];
const logRow = (d, sh, no, sp, sf, nps, kind, line) => [d, sh, no, sp, sf, "", nps, kind, line];

test("a Piping.Tools weld log: title rows skipped, one weld list per drawing sheet, a total row is not a weld", async () => {
  const aoa = [["Weld Log"], ["F110"], [""], LOG_HEAD,
    logRow("ISO-A", "1", "1", "S1", "Shop", 2, "BW", "2-LC-1"), logRow("ISO-A", "1", "2", "", "Field", 2, "BW", "2-LC-1"),
    logRow("ISO-A", "2", "1", "S2", "Shop", 0.75, "SW", "3/4-LC-2"), ["Filtered total", "", "", "", "", "", 4.75]];
  equal(headerRow(aoa), 3);
  const r = splitWeldLog(aoa);
  equal(r.groups.map((g) => [g.drawingNo, g.sheet, g.rows.length, g.lineNo]), [["ISO-A", "1", 2, "2-LC-1"], ["ISO-A", "2", 1, "3/4-LC-2"]]);
  equal(r.found, { no: "Weld No", loc: "S/F", kind: "Type", nps: "Size", spool: "Spool" });
  equal(weldLogSheetName(["Summary", "Weld Log Detailed"]), "Weld Log Detailed");
});

test("several lines under one drawing number: their duplicate numbers are refused, and split by line they are registers", async () => {
  const aoa = [LOG_HEAD, logRow("ISO-A", "1", "1", "S1", "Shop", 2, "BW", "2-LC-1"), logRow("ISO-A", "1", "2", "S1", "Shop", 2, "BW", "2-LC-1"),
    logRow("ISO-A", "1", "1", "S1", "Shop", 0.75, "SW", "3/4-LC-2")];
  const [one] = splitWeldLog(aoa).groups;
  equal([one.lines.length, one.lineNo], [2, ""], "two lines: no line is chosen for the person");
  const m = modelFromWeldList({ meta: { drawingNo: "ISO-A" }, weldList: one.rows });
  assert(m.problems?.some((p) => p.includes("تکراری")), "weld 1 twice on one register");
  const byLine = splitWeldLog(aoa, { byLine: true }).groups;
  equal(byLine.length, 2);
  assert(byLine.every((g) => !modelFromWeldList({ meta: { drawingNo: g.drawingNo }, weldList: g.rows }).problems));
});

test("this platform's own Weld Log export reads back into the same weld lists", async () => {
  const spec = weldLog({ project: "P", scope: "All Drawings", now: NOW, welds: [
    W("1", { spool: "S1" }), W("2", { spool: "", shopField: "Field" }), W("1", { drawingNo: "ISO-2", spool: "S9", kind: "SW", nps: 0.75 })] });
  const wb = XLSX.read(toXlsx(spec), { type: "buffer" });
  const name = weldLogSheetName(wb.SheetNames);
  const r = splitWeldLog(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" }));
  equal(r.groups.map((g) => [g.drawingNo, g.rows.map((x) => `${x.no}/${x.loc}/${x.kind}/${x.nps}/${x.spool}`)]),
    [["ISO-1", ["1/Shop/BW/2/S1", "2/Field/BW/2/"]], ["ISO-2", ["1/Shop/SW/0.75/S9"]]]);
  assert(r.groups.every((g) => modelFromWeldList({ meta: { drawingNo: g.drawingNo }, weldList: g.rows }).register));
});

// ── against the database ─────────────────────────────────────────────────

process.env.PGLITE_DIR = await scratchDir("prep-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const rep = await import("../../lib/db/repos/piping-reports.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice-rep" });
const proj = await projects.createProject(db, { code: "REP", name: "R", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
let spools, welds;

await inP(async () => {
  const { rows: [pc] } = await db.query(
    "INSERT INTO piping_class (project_id, code, service_category, material_spec) VALUES ($1,'DX01','normal','API 5L Gr.B') RETURNING id", [P]);
  await db.query("INSERT INTO piping_class_size (project_id, piping_class_id, nps, schedule, wall_thickness_mm, od_mm) VALUES ($1,$2,36,'SCH 10',7.92,914.4)", [P, pc.id]);
  const { rows: [line] } = await db.query("INSERT INTO line (project_id, line_no, piping_class_id) VALUES ($1,'36-CW-1',$2) RETURNING id", [P, pc.id]);
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`, [P, "f".repeat(64)]);
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: line.id, payload: DEMO });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: line.id, model: buildModel(DEMO, {}) });
  spools = (await db.query("SELECT id, spool_no, length_mm FROM spool WHERE project_id = $1 ORDER BY spool_no", [P])).rows;
  welds = (await db.query("SELECT weld_uid, weld_no, nps FROM weld WHERE project_id = $1 ORDER BY weld_no", [P])).rows;
  const { rows: [wr] } = await db.query("INSERT INTO welder (project_id, stamp_no, name) VALUES ($1,'W-07','A') RETURNING id", [P]);
  const { rows: [wps] } = await db.query("INSERT INTO wps (project_id, wps_no, process) VALUES ($1,'WPS-01','GTAW') RETURNING id", [P]);
  await db.query("INSERT INTO weld_execution (project_id, weld_uid, welder_id, wps_id, welded_at) VALUES ($1,$2,$3,$4,'2026-10-18')",
    [P, welds[0].weld_uid, wr.id, wps.id]);
  await db.query("INSERT INTO ndt_record (project_id, weld_uid, method, report_no, result, inspected_at) VALUES ($1,$2,'RT','RT-1','reject','2026-10-19')", [P, welds[0].weld_uid]);
  await db.query("INSERT INTO ndt_record (project_id, weld_uid, method, report_no, result, repair_cycle, inspected_at) VALUES ($1,$2,'RT','RT-2','accept',1,'2026-10-20')", [P, welds[0].weld_uid]);
});

test("the weld log from the register: OD, wall and material from the line's class, the latest NDT cycle, welder and WPS", async () => {
  await inP(async () => {
    const spec = await rep.pipingReport(db, { projectId: P, kind: "weld-log", now: NOW });
    const rows = sheet(spec, "Weld Log Detailed").rows.slice(4, -1);
    equal(rows.length, welds.length);
    const r = rows.find((x) => x[2] === welds[0].weld_no);
    equal([r[0], r[7], r[8], r[11], r[12], r[13], r[5], r[21], r[27]], ["ISO-1", 914.4, 7.92, "API 5L Gr.B", "WPS-01", "W-07", "2026-10-18", "accept · RT-2", "36-CW-1"]);
  });
});

test("BOM, NDT and progress read the same register; a bad kind is refused", async () => {
  await inP(async () => {
    const bom = await rep.pipingReport(db, { projectId: P, kind: "bom", now: NOW });
    equal(sheet(bom, "Bill of Materials Detailed").rows.length - 4, DEMO.bom.length);
    const ndt = await rep.pipingReport(db, { projectId: P, kind: "ndt", now: NOW });
    equal(Object.fromEntries(ndt.sheets[0].rows.slice(1))["NDT'd Welds"], 1);
    const pr = await rep.pipingReport(db, { projectId: P, kind: "progress", now: NOW });
    const cap = Object.fromEntries(sheet(pr, "Capacity").rows.slice(1).map((r) => [r[0], r.slice(1)]));
    const totalM = spools.reduce((s, x) => s + Number(x.length_mm || 0), 0) / 1000;
    equal(cap["Released to shop"][1], Math.round(totalM * 100) / 100);
    await throws(() => rep.pipingReport(db, { projectId: P, kind: "cost" }), "unknown report");
  });
});

let L1;
test("a load: one spool rides one load; an empty load does not ship; it arrives after it leaves, not before", async () => {
  await inP(async () => {
    L1 = await rep.createLoad(db, { projectId: P, userId: alice.id, loadNo: "Load 1", destination: "Site" });
    await throws(() => rep.createLoad(db, { projectId: P, userId: alice.id, loadNo: "Load 1" }), "قبلاً ثبت");
    await throws(() => rep.setLoadStatus(db, { projectId: P, loadId: L1.id, status: "shipped", on: "2026-10-21" }), "خالی");
    await rep.addLoadSpools(db, { projectId: P, loadId: L1.id, spoolIds: [spools[0].id], userId: alice.id });
    const L2 = await rep.createLoad(db, { projectId: P, userId: alice.id, loadNo: "Load 2" });
    await throws(() => rep.addLoadSpools(db, { projectId: P, loadId: L2.id, spoolIds: [spools[0].id], userId: alice.id }), "روی بار دیگری");
    await throws(() => rep.addLoadItem(db, { projectId: P, loadId: L1.id, item: { description: "GASKET", qty: 0, uom: "EA" } }), "بیشتر از صفر");
    await rep.addLoadItem(db, { projectId: P, loadId: L1.id, item: { description: "GASKET 36\" 150#", qty: 4, uom: "EA", drawingRef: "ISO-1" } });
    await throws(() => rep.setLoadStatus(db, { projectId: P, loadId: L1.id, status: "delivered", on: "2026-10-22" }), "ارسال شده باشد");
    await rep.setLoadStatus(db, { projectId: P, loadId: L1.id, status: "shipped", on: "2026-10-21" });
    await throws(() => rep.addLoadSpools(db, { projectId: P, loadId: L1.id, spoolIds: [spools[1].id], userId: alice.id }), "اسپول تازه");
    await throws(() => rep.setLoadStatus(db, { projectId: P, loadId: L1.id, status: "delivered", on: "2026-10-20" }), "پیش از تاریخ ارسال");
    await rep.setLoadStatus(db, { projectId: P, loadId: L1.id, status: "delivered", on: "2026-10-23" });
    const { freeSpools } = await rep.listLoads(db, { projectId: P });
    assert(!freeSpools.some((s) => s.id === spools[0].id) && freeSpools.some((s) => s.id === spools[1].id));
  });
});

test("the database itself refuses a load that left without a date or arrived before it left", async () => {
  await inP(async () => {
    await throws(() => db.query("INSERT INTO ship_load (project_id, load_no, status) VALUES ($1,'X','shipped')", [P]), "load_left_is_dated");
    await throws(() => db.query("INSERT INTO ship_load (project_id, load_no, status, leave_on, delivered_on) VALUES ($1,'Y','delivered','2026-10-10','2026-10-09')", [P]),
      "load_arrives_after_leaving");
  });
});

test("the delivered load shows in the weld log, the packing list and the progress report's delivery", async () => {
  await inP(async () => {
    const wl = sheet(await rep.pipingReport(db, { projectId: P, kind: "weld-log", now: NOW }), "Weld Log Detailed").rows.slice(4, -1);
    const onLoad = wl.filter((r) => r[29] === "Load 1").map((r) => r[3]);
    assert(onLoad.length > 0 && onLoad.every((s) => s === spools[0].spool_no), "only the loaded spool's welds name the load");
    const pl = await rep.packingListOf(db, { projectId: P, loadId: L1.id, now: NOW });
    const m = Object.fromEntries(pl.sheets[0].rows);
    equal([m.Status, m["Spool Count"], m["Shiploose Totals By Unit"], m["Delivered On"]], ["Delivered", 1, "4 EA", "2026-10-23"]);
    const pr = await rep.pipingReport(db, { projectId: P, kind: "progress", now: NOW });
    const cap = Object.fromEntries(sheet(pr, "Capacity").rows.slice(1).map((r) => [r[0], r.slice(1)]));
    equal(cap["Delivered to site"][0], Math.round(Number(spools[0].length_mm) / 10) / 100, "metres, to the centimetre");
    const labels = await rep.drawingLabels(db, { projectId: P, loadId: L1.id });
    equal(labels, [{ header: "Load 1", drawingNo: "ISO-1", sheet: "1/1", rev: "0" }]);
  });
});

await run();
