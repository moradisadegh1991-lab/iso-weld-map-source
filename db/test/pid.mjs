#!/usr/bin/env node
/**
 * A P&ID set read from its OCR (lib/pid/ocr-parse.mjs) and filed as a
 * project (lib/pid/load.mjs).
 *
 * The strings below are as the OCR returned them from the K110 ethane
 * cracking sheets — joined words, a size glued to its line number, a
 * bubble's number with a digit lost to the circle — and the rule under test
 * is the usual one: what is printed is read, what is not stays empty.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import {
  equipmentTags, lineNumbers, inches, sheetRefs, splitLetters, splitNumbers, instrumentsFromBubbles,
  dedupe, titleBlock, dataBoxes, parseSheet,
} from "../../lib/pid/ocr-parse.mjs";
import { equipmentSection, instrumentSection, purposeOf } from "../../lib/pid/load.mjs";
import { legendFluid, equipmentType } from "../../lib/pid/legend-k110.mjs";
import { isoDate, registers } from "../../tools/pid-registers.mjs";

test("a line number is read by the legend's own pattern: size, fluid, plant, section, serial, class, insulation", async () => {
  const [l] = lineNumbers('6*BW110901A-JA01-H');
  equal([l.size, l.lineNo, l.fluid, l.plant, l.section, l.serial, l.kind, l.pipingClass, l.insulation],
    [6, "BW110901A", "BW", "1", "10", "901", "main", "JA01", "H"]);
  equal(lineNumbers('2" SL160902A-JA01-P')[0].section, "60", "a utility line crossing the sheet keeps its own section");
  equal(lineNumbers("BW110902A-JA02-H")[0].size, null, "no size printed in the string, none invented");
  equal([inches("3/4"), inches("1 1/2"), inches("1.1/2"), inches("x")], [0.75, 1.5, 1.5, null]);
});

test("equipment tags, however the hyphens fall, and never a drawing number", async () => {
  equal(equipmentTags("30-E1129").map((e) => e.tag), ["30-E-1129"]);
  equal(equipmentTags("CRACKINGFURNACES30-F-1109-ECONOMIZERCOIL").map((e) => e.tag), ["30-F-1109"]);
  equal(equipmentTags("30-D-1301AB").map((e) => e.tag), ["30-D-1301AB"]);
  equal(equipmentTags("K110-30-PID-0021-10-93/1"), [], "PID is a document type, not an equipment letter");
  equal(equipmentTags("30 E 1422 A").map((e) => e.tag), ["30-E-1422A"], "printed with spaces on many sheets");
  equal(equipmentTags("30 P 1403 A/B").map((e) => e.tag), ["30-P-1403A", "30-P-1403B"], "A/B is two pumps");
  equal([equipmentType("30-E-1129"), equipmentType("30-TK-7001"), equipmentType("30-STC-1501")], ["E", "TK", null], "only the legend's type letters");
});

test("off-page boxes name the sheet they continue on", async () => {
  equal(sheetRefs("D221-10-14/1"), ["K110-30-PID-0021-10-14"]);
  equal(sheetRefs("K110-30-PID-0021-10-93/1"), ["K110-30-PID-0021-10-93"]);
});

test("a row of bubbles the OCR read as one string is split only when it splits evenly", async () => {
  equal(splitNumbers("110212110312110412110512"), ["110212", "110312", "110412", "110512"]);
  equal(splitLetters("FICVFICVFIC/FIC", 4), ["FIC", "FIC", "FIC", "FIC"]);
  equal(splitNumbers("1102121103"), null, "ten digits is not two loop numbers");
});

test("bubbles: letters over the loop number, ISA letters only, and a slip on the drawing named, not corrected", async () => {
  const { instruments, problems } = instrumentsFromBubbles([
    { x: 1, y: 1, lines: [["FT", 0.99], ["110912", 1]] },
    { x: 2, y: 1, lines: [["F I", 0.9], ["161905", 1]] },
    { x: 3, y: 1, lines: [["TE", 0.99], ["1109953", 1]] },
    { x: 4, y: 1, lines: [['6"', 0.8]] },
    { x: 5, y: 1, lines: [["PDT", 0.9], ["13O221", 0.9]] },
    { x: 6, y: 1, lines: [["P", 0.9], ["140001", 0.9]] },
    { x: 7, y: 1, lines: [["T1", 0.7], ["140101", 1]] },
  ]);
  equal(instruments.map((i) => i.tag), ["FT-110912", "FI-161905", "TE-1109953", "PDT-130221", "TI-140101"],
    "a 1 in the letters line is an I (T1 → TI); an O among the digits a 0");
  equal(instruments[0].category, "transmitter");
  assert(/TE-1109953/.test(problems[0]) && problems.length === 1, "the seven-digit number is named for a person");
  // P-140001 has no succeeding letter: a pump number, not an instrument (ISA 5.1)
});

test("a fluid code the legend lacks is repaired only when one legend code is a single look-alike away", async () => {
  equal([legendFluid("UW"), legendFluid("UV"), legendFluid("CV"), legendFluid("SL"), legendFluid("DD")], ["UW", "UW", "CW", null, null]);
});

test("the OCR's doubled strings are kept once", async () => {
  const items = dedupe([
    { t: "OPEN", c: 0.86, b: [346, 326, 360, 333] }, { t: "OPEN", c: 0.94, b: [346.2, 326.2, 360.2, 333.1] },
    { t: "CLOSE", c: 0.97, b: [349, 356, 365, 363] },
  ]);
  equal(items.map((i) => [i.t, i.c]), [["CLOSE", 0.97], ["OPEN", 0.94]]);
});

test("the title block: owner's number, revisions newest first, purpose as printed", async () => {
  const W = 1191, H = 842;
  const t = titleBlock([
    { t: "2", c: 1, b: [918, 600, 924, 607] }, { t: "17/12/16", c: 1, b: [934, 600, 971, 607] },
    { t: "FOR AS BUILT", c: 1, b: [975, 600, 1020, 607] }, { t: "PROJECT", c: 1, b: [1022, 600, 1050, 607] }, { t: "f.n", c: 1, b: [1072, 600, 1080, 607] },
    { t: "Drawn by:", c: 1, b: [1067, 656, 1095, 664] },
    { t: "1", c: 1, b: [919, 635, 925, 642] }, { t: "21/05/12", c: 1, b: [935, 635, 968, 642] }, { t: "AS BUILT", c: 1, b: [996, 634, 1031, 643] },
    { t: "0", c: 1, b: [917, 644, 923, 652] }, { t: "30/01/10", c: 1, b: [935, 643, 974, 652] }, { t: "ISSUED FOR DESIGN", c: 1, b: [974, 643, 1048, 651] },
    { t: "DRAWING TITLE:", c: 1, b: [906, 751, 970, 759] }, { t: "SECTION 10", c: 1, b: [999, 754, 1048, 762] },
    { t: "CRACKINGFURNACES30-F-1109-ECONOMIZERCOIL", c: 1, b: [935, 765, 1112, 771] },
    { t: "CONTRACTOR", c: 1, b: [909, 785, 949, 793] },
    { t: "K110-30-PID-0021-10-96/1", c: 1, b: [962, 807, 1110, 817] },
  ], W, H);
  equal([t.ownerNo, t.issue, t.section], ["K110-30-PID-0021-10-96", "1", "10"]);
  equal(t.revisions, [{ rev: "2", date: "17/12/16", purpose: "FOR AS BUILT PROJECT" },
    { rev: "1", date: "21/05/12", purpose: "AS BUILT" }, { rev: "0", date: "30/01/10", purpose: "ISSUED FOR DESIGN" }],
    "a block grown above the title block still read; the purpose in all its words, and no signer's name");
  equal(t.title, ["SECTION 10", "CRACKINGFURNACES30-F-1109-ECONOMIZERCOIL"]);
  equal([isoDate("21/05/12"), isoDate("31/13/12")], ["2012-05-21", null]);
});

test("equipment: two readings of one place that disagree file nothing; a bare base beside its trains is not its own tag", async () => {
  const it = (t, b, c = 0.9) => ({ t, c, b });
  const s = parseSheet({ page: 171, w: 1191, h: 842, items: [
    it("30C1701I", [459.5, 440.3, 510.6, 448.6]), it("30C1701F", [459.9, 440.2, 510.6, 448.5], 0.8),
    it("30 C 1701 A/B", [606.8, 751.3, 653.6, 758.5]), it("30C1701", [702.9, 439.9, 749.0, 448.2]),
    it("30 S 1401 A/B", [100, 100, 150, 108]), it("30S 1401", [100, 100, 140, 108]),
    it("30 P 1302 A/B/C", [200, 100, 260, 108]), it("30-P-1302A/B/C", [200, 100, 259, 108]),
  ] });
  equal(s.equipment.map((e) => e.tag).sort(), ["30-C-1701", "30-C-1701A", "30-C-1701B",
    "30-P-1302A", "30-P-1302B", "30-P-1302C", "30-S-1401A", "30-S-1401B"], "a reading that says less of the same label adds nothing; one that agrees is no clash");
  equal(s.equipmentProblems.length, 1);
  assert(/30C1701I.*30C1701F/.test(s.equipmentProblems[0]), "the clash is named");
  const reg = registers([{ ...s, ownerNo: "K110-30-PID-0021-70-11", revisions: [], title: [], dataBoxes: [], lines: [], instruments: [], refs: [] }]);
  equal(reg.equipment.map((e) => e.tag).filter((t) => /1701/.test(t)), ["30-C-1701A", "30-C-1701B"]);
  assert(reg.problems.some((p) => /«30C1701».*30-C-1701A/.test(p)), "the bare one is named, not filed");
});

test("an equipment data box: each label with the value to its right", async () => {
  const [b] = dataBoxes([
    { t: "ITEM N°", c: 1, b: [470, 771, 499, 779] }, { t: "30-F1109", c: 1, b: [528, 772, 554, 779] },
    { t: "SERVICE", c: 1, b: [470, 779, 496, 787] }, { t: "ECONOMIZER", c: 1, b: [521, 782, 556, 788] },
    { t: "DESIGN PRESS", c: 1, b: [470, 804, 509, 811] }, { t: "136", c: 1, b: [524, 805, 536, 812] }, { t: "bar.g", c: 1, b: [544, 804, 565, 812] },
  ]);
  equal(b, { tag: "30-F-1109", printedTag: "30-F1109", fields: { SERVICE: "ECONOMIZER", "DESIGN PRESS": "136 bar.g" } });
});

test("sections by the numbering the legend declares, and revision purposes the platform knows", async () => {
  equal([equipmentSection("30-E-1129"), equipmentSection("30-D-1301AB"), equipmentSection("90-W-604")], ["10", "30", null]);
  equal([instrumentSection("110912"), instrumentSection("161905"), instrumentSection("140001A1")], ["10", "60", "40"]);
  equal([purposeOf("AS BUILT"), purposeOf("TSR.no ROL1-M-95-600"), purposeOf("IFC"), purposeOf("I.F.C"), purposeOf("ISSUED FOR DESIGN")], ["AB", "AB", "IFC", "IFC", null]);
});

// ── into a project ───────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("pid-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const { loadPidSet } = await import("../../lib/pid/load.mjs");
const { missingInformation } = await import("../../lib/db/repos/assumptions.mjs");
const db = await getDb();
const me = await projects.ensureUser(db, { subject: "kc|pid" });
const proj = await projects.createProject(db, { code: "PID1", name: "P", ownerUserId: me.id });
const P = proj.id;

const sheet = (page, sheetNo, extra = {}) => ({
  page, w: 1191, h: 842, ownerNo: `K110-30-PID-0021-10-${sheetNo}`, issue: "1", contractorNo: null, section: "10",
  title: ["SECTION 10", "ECONOMIZER COIL"], asBuilt: true, equipment: [], dataBoxes: [], lines: [], instruments: [], refs: [],
  revisions: [{ rev: "1", date: "21/05/12", purpose: "AS BUILT" }, { rev: "0", date: "30/01/10", purpose: "ISSUED FOR DESIGN" }],
  ...extra,
});
const reg = registers([
  sheet(100, "96", {
    equipment: [{ tag: "30-E-1129", printed: ["30-E1129"], listed: true }, { tag: "60-P-6101", printed: ["60-P6101"], listed: false },
      { tag: "30-P-1201A", printed: ["30-P-1201A"], listed: false }, { tag: "30-Q-1101", printed: ["30-Q1101"], listed: false }],
    dataBoxes: [{ tag: "30-E-1129", fields: { SERVICE: "TER.TRANSF.LN.EXCH", TYPE: "SHELL&TUBE" } }],
    lines: lineNumbers('6*BW110901A-JA01-H 4"W110901A-JA01-H 2"SL110905A-JA01-P 1XN110903A-DA03-NI'),
    instruments: instrumentsFromBubbles([{ lines: [["FT", 1], ["110912", 1]] }, { lines: [["FI", 1], ["161905", 1]] }]).instruments,
  }),
  sheet(16, "01", { revisions: [{ rev: "3", date: "19/02/15", purpose: "TSR.noRMTI-I-93-278" }, { rev: "2", date: "20/05/12", purpose: "AS BUILT" }] }),
]);
const OPTS = { unit: { code: "30", name: "Ethane Cracking Plant" }, sections: { "10": "Cracking furnaces", "60": "Utilities" } };

test("a read set becomes a project: sections, drawings with their revisions, equipment, lines, instruments", async () => {
  const report = await withProject(db, P, (tx) => loadPidSet(tx, { projectId: P, userId: me.id }, reg, OPTS));
  equal([report.sections, report.drawings, report.revisions, report.lines], [2, 2, 3, 2]);
  equal(report.linesHeld, ["SL110905A"], "a fluid code the legend lacks is held, not loaded as a line");
  assert(!reg.lines.some((l) => l.lineNo === "W110901A") && reg.lines.find((l) => l.lineNo === "BW110901A").sheets.length === 1
    && reg.problems.some((p) => /W110901A.*جا افتاده.*BW110901A/.test(p)), "a dropped first letter merges into the one line printed whole");
  const n = reg.lines.find((l) => l.lineNo === "N110903A");
  assert(n && n.sizes.length === 0 && reg.problems.some((p) => /علامت اینچ/.test(p)), "X before a code is the inch mark; the size beside it is not trusted");
  equal(report.revisionsNotIssued.map((r) => r.printed), ["ISSUED FOR DESIGN"], "a purpose the platform has no name for is not issued as something else");
  assert(reg.problems.some((p) => /30-Q1101/.test(p)) && !reg.equipment.some((e) => e.tag === "30-Q-1101"),
    "Q is not a type letter in the legend: the string is named, not filed as equipment");
  await withProject(db, P, async () => {
    const { rows: revs } = await db.query(
      `SELECT d.doc_no, r.revision, r.purpose, r.issued_on::text AS on, r.note FROM mdr_revision r JOIN mdr_document d ON d.id = r.mdr_id
        WHERE r.project_id = $1 ORDER BY d.doc_no, r.issued_on`, [P]);
    equal(revs.map((r) => [r.doc_no.slice(-2), r.revision, r.purpose, r.on]),
      [["01", "2", "AB", "2012-05-20"], ["01", "3", "AB", "2015-02-19"], ["96", "1", "AB", "2012-05-21"]]);
    assert(/TSR/.test(revs[1].note), "a revision for a plant change keeps what the block printed");
    assert(/ISSUED FOR DESIGN/.test(revs[2].note), "and the one not issued is named on the next");

    const { rows: eqs } = await db.query(
      `SELECT t.tag_no, t.description, t.kind, s.code FROM tag t LEFT JOIN subsystem s ON s.id = t.subsystem_id
        WHERE t.project_id = $1 ORDER BY t.tag_no`, [P]);
    equal(eqs.map((e) => [e.tag_no, e.description, e.kind, e.code]), [
      ["30-E-1129", "TER.TRANSF.LN.EXCH", "static", "30-10"],
      ["30-P-1201A", "PUMPS (نوع از حرف تگ طبق لجند)", "rotating", null], // section 20 not among this project's sections: unfiled, not forced
    ], "E is a heat exchanger and P a pump by the legend's tagging table; the service printed in the data box wins as description");
    const { rows: [n] } = await db.query("SELECT count(*)::int AS n FROM tag WHERE project_id = $1 AND tag_no LIKE '60-%'", [P]);
    equal(n.n, 0, "another unit's equipment drawn for reference is not this unit's tag");

    const { rows: lns } = await db.query("SELECT line_no, piping_class, service, insulation FROM line WHERE project_id = $1 ORDER BY line_no", [P]);
    equal(lns, [{ line_no: "BW110901A", piping_class: "JA01", service: "BW — BOILER FEED WATER", insulation: "H" },
      { line_no: "N110903A", piping_class: "DA03", service: "N — NITROGEN", insulation: null }],
      "the fluid named by the set's own legend; an insulation code it does not list (NI) is left empty");

    const { rows: ins } = await db.query(
      `SELECT i.tag_no, i.category, i.eq_tag_id, s.code FROM instrument i LEFT JOIN subsystem s ON s.id = i.subsystem_id
        WHERE i.project_id = $1 ORDER BY i.tag_no`, [P]);
    equal(ins.map((i) => [i.tag_no, i.category, i.code]), [["FI-161905", "gauge", "30-60"], ["FT-110912", "transmitter", "30-10"]]);
    assert(ins.every((i) => i.eq_tag_id === null), "the sheet does not print which equipment an instrument serves; none is guessed");
  });
  const missing = await withProject(db, P, () => missingInformation(db, { projectId: P }));
  assert(Array.isArray(missing) || typeof missing === "object", "the gaps go to the missing-information register");
});

await run();
