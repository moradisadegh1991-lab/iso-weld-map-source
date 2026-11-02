#!/usr/bin/env node
/**
 * A weld's Tie-in reference picked as isometric / sheet / weld (lib/sheet/tie-in.mjs):
 * written and read back the same, a plain weld number stays this sheet's, a free
 * note stays as typed, and the project's welds group into isometric → sheet → welds.
 */
import { test, run, equal } from "./harness.mjs";
import { formatRef, parseRef, groupTargets } from "../../lib/sheet/tie-in.mjs";

test("a picked reference reads back as the same three choices", () => {
  const ref = formatRef({ doc: "ISO-12", sheet: "2/3", weld: "W5" });
  equal(ref, "ISO-12 | 2/3 | W5");
  equal(parseRef(ref), { doc: "ISO-12", sheet: "2/3", weld: "W5" });
});

test("an isometric chosen before its sheet and weld still reads back", () => {
  equal(parseRef(formatRef({ doc: "ISO-12", sheet: "", weld: "" })), { doc: "ISO-12", sheet: "", weld: "" });
  equal(parseRef(formatRef({ doc: "ISO-12", sheet: "2/3", weld: "" })), { doc: "ISO-12", sheet: "2/3", weld: "" });
});

test("a plain weld number is this sheet's; a free note stays as typed", () => {
  equal(formatRef({ weld: " 12 " }), "12");
  equal(parseRef("12"), { doc: "", sheet: "", weld: "12" });
  equal(parseRef("FIELD RUN 3 / see P&ID"), { doc: "", sheet: "", weld: "FIELD RUN 3 / see P&ID" });
  equal(parseRef(""), { doc: "", sheet: "", weld: "" });
});

test("the project's welds group into isometric → sheet → weld numbers, in order, without repeats", () => {
  const g = groupTargets([
    { doc_no: "ISO-2", sheet_no: "1/1", revision: "A", weld_no: "1" },
    { doc_no: "ISO-1", sheet_no: "2/2", revision: "B", weld_no: "9" },
    { doc_no: "ISO-1", sheet_no: "1/2", revision: "B", weld_no: "3" },
    { doc_no: "ISO-1", sheet_no: "1/2", revision: "B", weld_no: "3" },
    { doc_no: "", sheet_no: "1/1", weld_no: "7" },
  ]);
  equal(g.map((x) => [x.doc, x.sheets.map((s) => [s.sheet, s.revision, s.welds])]),
    [["ISO-1", [["1/2", "B", ["3"]], ["2/2", "B", ["9"]]]], ["ISO-2", [["1/1", "A", ["1"]]]]]);
});

await run();
