#!/usr/bin/env node
/**
 * A register from the joint numbers printed on the sheet
 * (lib/register/weld-marks.mjs): the model reports each marker's frame, the
 * project's declared convention says shop or field, the sheet's own BOM says
 * the joint type where it can — and every blank stays blank.
 *
 * The sheet below is modelled on a real area-25 isometric whose contractor
 * register agreed with every printed number: 2" butt-weld run with four
 * shop and two field joints, a 3/4" branch on a half coupling (an OLET, two
 * socket welds and a threaded cap), and one joint of the next sheet drawn
 * dashed.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { weldListFromMarks, endTypes, sizesOf } from "../../lib/register/weld-marks.mjs";
import { modelFromWeldList } from "../../lib/register/weld-list.mjs";
import { compareRegister } from "../../lib/truth/compare.mjs";

const BOM = [
  { pt: 1, group: "PIPE", description: "PIPE S40 BE SMLS A333-6 ASME B36.10", diam: 2 },
  { pt: 2, group: "PIPE", description: "PIPE S80 PE SMLS A333-6 ASME B36.10", diam: 0.75 },
  { pt: 3, group: "FITTINGS", description: "HALF COUPLING 3000# SW A350-LF2 CL.1", diam: "2 x 3/4" },
  { pt: 4, group: "FITTINGS", description: "ELBOW 90 LR S40 BW A420-WPL6 ASME B16.9", diam: 2 },
  { pt: 5, group: "FITTINGS", description: "CAP 3000# NPT A350-LF2 CL.1 ASME B16.11", diam: 0.75 },
  { pt: 6, group: "VALVES", description: "VALVE GLOBE 800# SW A350-LF2 CL.1", diam: 0.75 },
];
const mark = (no, shape, extra = {}) => ({ no, shape, outline: "solid", label: "", nps: "2", branch: false, spool: null, ...extra });
const MARKS = [
  mark("1", "square", { label: "FFW" }),
  mark("2", "circle", { spool: "SP-1" }),
  mark("3", "circle", { spool: "SP-1" }),
  mark("4", "square", { nps: "3/4", branch: true }),
  mark("5", "square", { nps: "3/4" }),
  mark("6", "square", { nps: "3/4", label: "THD" }),
  mark("7", "circle", { spool: "SP-2" }),
  mark("8", "square"),
  mark("9", "square", { outline: "dashed" }),
];
const SHEET = { meta: { drawingNo: "ISO-25-9001", sheet: "1/2", nps: 2 }, bom: BOM, weldMarks: { marks: MARKS } };
const LEGEND = { shop: "circle", field: "square" };

test("the frame decides shop or field only through the project's declared convention", async () => {
  const r = weldListFromMarks(SHEET, LEGEND);
  equal(r.weldList.map((w) => [w.no, w.loc]), [["1", "Field"], ["2", "Shop"], ["3", "Shop"], ["4", "Field"], ["5", "Field"],
    ["6", "Field"], ["7", "Shop"], ["8", "Field"]]);
  equal(r.weldList.find((w) => w.no === "1").ref, "FFW", "a field-fit weld says so");
  equal(r.weldList.filter((w) => w.spool).map((w) => [w.no, w.spool]), [["2", "SP-1"], ["3", "SP-1"], ["7", "SP-2"]], "a spool mark only on shop joints");
  const swapped = weldListFromMarks(SHEET, { shop: "square", field: "circle" });
  equal(swapped.weldList.find((w) => w.no === "2").loc, "Field", "another project's convention, another answer — the rule is the project's");
});

test("undeclared, no joint gets a location — and the register says why", async () => {
  const r = weldListFromMarks(SHEET, {});
  assert(r.weldList.every((w) => w.loc === "" || w.ref === "FFW") && r.weldList.filter((w) => w.loc).length === 0, "nothing assumed");
  assert(r.problems.some((p) => /نماد جوش کارگاهی و سایتی این پروژه ثبت نشده/.test(p)), r.problems.join(" | "));
  assert(/محل جوش/.test(modelFromWeldList({ meta: SHEET.meta, weldList: r.weldList }).error || ""), "and the list cannot be saved like that");
});

test("a dashed frame belongs to the next sheet and is left out, not counted", async () => {
  const r = weldListFromMarks(SHEET, LEGEND);
  equal(r.weldList.length, 8);
  equal(r.excluded, [{ no: "9", why: "قاب خط‌چین — جوش برگ مجاور" }]);
  const zero = weldListFromMarks({ ...SHEET, weldMarks: { marks: [mark("0", "square"), mark("1", "square")] } }, LEGEND);
  equal([zero.weldList.map((w) => w.no), zero.excluded.map((e) => e.no)], [["1"], ["0"]], "a frame printed 0 is a slip, not a joint");
  assert(zero.problems.some((p) => /شمارهٔ «0»/.test(p)), "and it is named for a person to check");
});

test("the joint type: printed THD, a branch OLET, else the sheet's BOM at that size — mixed stays blank", async () => {
  const r = weldListFromMarks(SHEET, LEGEND);
  const kind = Object.fromEntries(r.weldList.map((w) => [w.no, w.kind]));
  equal(kind["6"], "THD", "printed beside the frame");
  equal(weldListFromMarks({ ...SHEET, weldMarks: { marks: [mark("1", "square", { label: "BR" })] } }, LEGEND).weldList[0].kind, "BR", "and so is a branch weld");
  equal(kind["4"], "OLET", "the half coupling's weld to the run");
  equal(kind["2"], "BW", "2\": BE pipe and BW elbows only — the coupling's SW end is its 3/4\" branch, not the run");
  equal(kind["5"], "", "3/4\": socket-weld valve and a threaded cap — the BOM cannot say which, so nobody guesses");
  assert(r.notes.some((n) => /BOM همین برگ معلوم نمی‌کند[^:]*: 5$/.test(n)), r.notes.join(" | "));
});

test("declared «THD at every threaded joint»: an unlabelled joint among socket welds is SW; undeclared, it stays blank", async () => {
  const r = weldListFromMarks(SHEET, { ...LEGEND, thdLabelled: true });
  equal(r.weldList.find((w) => w.no === "5").kind, "SW");
  equal(r.weldList.find((w) => w.no === "6").kind, "THD", "the labelled one is still threaded");
  equal(weldListFromMarks(SHEET, LEGEND).weldList.find((w) => w.no === "5").kind, "", "not declared, not assumed");
});

test("a joint whose size has no pipe on this sheet is joined to the next sheet: its type is not this BOM's to say", async () => {
  const bom = [...BOM, { pt: 7, group: "FITTINGS", description: "REDUCING TEE S40 S80 BW A234-WPB ASME B16.9", diam: "2 x 1" }];
  const r = weldListFromMarks({ ...SHEET, bom, weldMarks: { marks: [mark("1", "square", { nps: "1" }), mark("2", "circle", { spool: "SP-1" })] } }, LEGEND);
  equal(r.weldList.map((w) => [w.no, w.kind]), [["1", ""], ["2", "BW"]],
    "the tee's 1\" branch runs off the sheet — BW on this side says nothing about the pipe it meets");
});

test("numbers read twice, and numbers missing from the run, are both named", async () => {
  const r = weldListFromMarks({ ...SHEET, weldMarks: { marks: [mark("10", "square"), mark("12", "square"), mark("12", "circle"), mark("15", "square"), mark("14", "square", { outline: "dashed" })] } }, LEGEND);
  assert(r.problems.some((p) => /12 دو بار/.test(p)), "a duplicate");
  assert(r.notes.some((n) => /در میانهٔ ردیف این برگ خوانده نشد: 11، 13/.test(n)), `11 and 13 missing, 14 is the dashed one (${r.notes.join(" | ")})`);
  const added = weldListFromMarks({ ...SHEET, weldMarks: { marks: [mark("1", "square"), mark("2", "square"), mark("4-1", "square"), mark("3", "square")] } }, LEGEND);
  assert(!added.notes.some((n) => /در میانهٔ ردیف/.test(n)), `4-1 is a joint added in a revision, not 41 (${added.notes.join(" | ")})`);
});

test("completed by a person, the list is a register; scored against the contractor's, blanks are not scored", async () => {
  const r = weldListFromMarks(SHEET, LEGEND);
  const truth = [
    { no: "001", loc: "Field", kind: "BW", nps: 2 }, { no: "002", loc: "Shop", kind: "BW", nps: 2 }, { no: "003", loc: "Shop", kind: "BW", nps: 2 },
    { no: "004", loc: "Field", kind: "OLET", nps: 0.75 }, { no: "005", loc: "Field", kind: "SW", nps: 0.75 }, { no: "006", loc: "Field", kind: "THD", nps: 0.75 },
    { no: "007", loc: "Shop", kind: "BW", nps: 2 }, { no: "008", loc: "Field", kind: "BW", nps: 2 },
  ];
  const c = compareRegister(truth, r.weldList.map((w) => ({ no: w.no, loc: w.loc || null, kind: w.kind || null, nps: Number(w.nps) || null })));
  equal([c.weldCountExact, c.fields.loc.correct, c.fields.loc.compared], [true, 8, 8]);
  equal([c.fields.kind.correct, c.fields.kind.compared], [7, 7], "the blank type of 5 is not scored either way");
  const done = r.weldList.map((w) => (w.no === "5" ? { ...w, kind: "SW" } : w));
  const m = modelFromWeldList({ meta: SHEET.meta, weldList: done });
  assert(!m.error, m.error);
  equal(m.register.length, 8);
});

test("end types and sizes are read from the BOM text as written", async () => {
  equal([...endTypes("ELBOW 90 LR S40 BW A420-WPL6")], ["BW"]);
  equal([...endTypes("PIPE S80 PE SMLS")], ["SW"]);
  equal([...endTypes("CAP 3000# NPT A350-LF2")], ["THD"]);
  equal([...endTypes("FLANGE WELDING NECK S40 150# RF")], [], "a description that does not say is not read as anything");
  equal(sizesOf("2 x 3/4"), [2, 0.75]);
  equal(sizesOf("1 1/2"), [1.5]);
  equal(sizesOf(3), [3]);
});

await run();
