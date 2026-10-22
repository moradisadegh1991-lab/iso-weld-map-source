#!/usr/bin/env node
/**
 * Every Excel template the platform gives out (lib/import-templates.mjs),
 * written to a workbook and read back exactly as its own importer reads a
 * file — a template its importer cannot read is worse than none.
 */
import { test, run, assert, equal } from "./harness.mjs";
import * as XLSX from "xlsx";
import { TEMPLATES } from "../../lib/import-templates.mjs";
import { parseDelimited, guessMapping, toRegister, HEADER_PATTERNS } from "../../lib/truth/parse.mjs";
import { parseEquipmentList } from "../../lib/equipment/parse.mjs";
import { LIST_PATTERNS } from "../../lib/register/weld-list.mjs";
import { parseCatalogue } from "../../lib/warehouse/mesc.mjs";
import { DESIGN_PATTERNS } from "../../lib/contracts/design-import.mjs";
import { parsePmsRows, checkPms } from "../../lib/controls/pms.mjs";
import { readPmsWorkbook } from "../../lib/db/repos/pms.mjs";
import { readPlanFile } from "../../lib/db/repos/eps-import.mjs";
import { fromSheet } from "../../lib/eps/import.mjs";
import { fromPlanSheet } from "../../lib/eps/planning.mjs";

/** The workbook the download button writes, as bytes. */
const book = (key) => {
  const wb = XLSX.utils.book_new();
  for (const s of TEMPLATES[key].sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(TEMPLATES[key].guide), "Guide");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};
/** What the pages that read the first sheet as CSV see. */
const csv = (key) => { const wb = XLSX.read(book(key), { type: "buffer" }); return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]); };

test("every template has its data first and a guide naming each column", () => {
  for (const [k, t] of Object.entries(TEMPLATES)) {
    assert(t.file.endsWith(".xlsx") && t.sheets[0].rows.length > 2, `${k}: a workbook with examples`);
    assert(t.guide.length > 2, `${k}: a guide`);
  }
});

test("the EPS template imports as a version: nodes nested by parent code, activities under them, W.F and dates as written", () => {
  const plan = readPlanFile("sheet", book("eps"));
  equal(plan.problems, []);
  equal(plan.nodes.map((n) => [n.code, plan.nodes.find((p) => p.key === n.parentKey)?.code || null, n.wf]),
    [["01", null, 100], ["01.01", "01", 60], ["01.02", "01", 40]]);
  equal(plan.activities.map((a) => [a.code, plan.nodes.find((n) => n.key === a.nodeKey).code, a.wf, a.volume, a.plan_start, a.plan_end]),
    [["A-010", "01.01", 60, 700, "2026-11-01", "2027-01-15"], ["A-020", "01.01", 40, 500, "2026-12-01", "2027-02-28"], ["A-030", "01.02", 100, 300, "2027-01-01", "2027-03-31"]]);
});

test("the planning template reads back line by line: WBS code where given, days, dates, ten decimals", () => {
  const wb = XLSX.read(book("planning"), { type: "buffer", cellDates: true });
  const r = fromPlanSheet(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false }));
  equal(r.problems, []);
  equal(r.lines.map((l) => [l.wbs, l.code, l.startOn, l.days, l.endOn, l.doneBefore, l.volumePlan]), [
    ["PM01.C.01.01", "PM01.C.01.01.01", "2026-11-01", 10, null, 0, 120.5],
    [null, "PM01.C.01.01.02", "2026-11-05", null, "2026-11-30", 40, null],
    [null, "A-030", null, null, null, null, 0.1234567891]]);
});

test("an EPS sheet without a Type column, as the tree's own export writes it, and what it cannot place", () => {
  const plan = fromSheet([
    ["Level", "Parent code", "Code", "Name", "W.F", "Plan start"],
    [0, "", "10", "Civil", 100, ""],
    [1, "10", "10.1", "Excavation", 100, 46000],              // an Excel serial day
    [2, "10.1", "E-1", "Dig", 100, "1405/08/01"],             // a Jalali date: not guessed
    [1, "99", "X-1", "Orphan", 0, ""],
  ]);
  equal(plan.nodes.map((n) => [n.code, n.plan_start]), [["10", null], ["10.1", "2025-12-09"]], "a row named as a parent is a node; a serial day read as a date");
  equal(plan.activities.map((a) => [a.code, a.plan_start]), [["E-1", null]]);
  assert(plan.problems.some((p) => /1405\/08\/01/.test(p)), "a date it cannot read is named, not guessed");
  assert(plan.problems.some((p) => /X-1/.test(p)), "an activity with no node in the file is named, not placed");
  equal(fromSheet([["a", "b"], [1, 2]]).nodes, [], "no Code column: nothing");
});

test("the PMS template reads as the contractor's workbook, and agrees with itself", () => {
  const { rows } = readPmsWorkbook(book("pms"));
  const { title, nodes } = parsePmsRows(rows);
  equal(title, "Sample project");
  equal(nodes.filter((n) => n.kind === "step").map((n) => [n.code, n.stepWeight, n.wf]), [["CC01", 0.05, 0.03], ["CC02", 0.95, 0.57], ["CC01", 1, 0.4]]);
  equal(checkPms(nodes), [], "weights add up at every level");
  const plan = readPlanFile("pms", book("pms"));
  equal([plan.nodes.length, plan.activities.length], [3, 3], "and imports as a version");
});

test("the design-quantities template: every column found by its header", () => {
  const { headers } = parseDelimited(csv("design"));
  const { mapping } = guessMapping(headers, DESIGN_PATTERNS);
  equal(Object.keys(mapping).sort(), Object.keys(DESIGN_PATTERNS).sort());
});

test("the equipment template: every tag read", () => {
  const r = parseEquipmentList(csv("equipment"));
  equal(r.tags.map((t) => t.tagNo), ["P-7001A", "TK-7001"]);
});

test("the weld-register and weld-list templates: every column found", () => {
  const reg = parseDelimited(csv("truth"));
  const { mapping } = guessMapping(reg.headers, HEADER_PATTERNS, reg.rows);
  equal(Object.keys(mapping).sort(), Object.keys(HEADER_PATTERNS).sort());
  equal(toRegister(reg.rows, mapping).map((r) => r.no), ["W-01", "W-02"]);
  const wl = parseDelimited(csv("weldList"));
  equal(Object.keys(guessMapping(wl.headers, LIST_PATTERNS, wl.rows).mapping).sort(), Object.keys(LIST_PATTERNS).sort());
});

test("the MESC template: groups and an item, and nothing refused", () => {
  const r = parseCatalogue(csv("mesc"));
  equal(r.problems, []);
  equal([r.groups.length, r.items.length], [2, 1]);
});

await run();
