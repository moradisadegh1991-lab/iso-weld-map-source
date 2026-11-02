#!/usr/bin/env node
/**
 * A weld's Tie-in reference picked as isometric / sheet / weld (lib/sheet/tie-in.mjs):
 * written and read back the same, a plain weld number stays this sheet's, a free
 * note stays as typed, and the project's welds group into isometric → sheet → welds.
 */
import { test, run, equal } from "./harness.mjs";
import { formatRef, parseRef, groupTargets, classifyTarget } from "../../lib/sheet/tie-in.mjs";

test("a picked reference reads back as the same three choices", () => {
  const ref = formatRef({ doc: "ISO-12", sheet: "2/3", weld: "W5" });
  equal(ref, "ISO-12 | 2/3 | W5");
  equal(parseRef(ref), { doc: "ISO-12", sheet: "2/3", weld: "W5", uid: "" });
});

test("a reference carries the weld's identity when the picker knew it, and reads back without it otherwise", () => {
  const ref = formatRef({ doc: "ISO-12", sheet: "2/3", weld: "W5", uid: "uid-9" });
  equal(ref, "ISO-12 | 2/3 | W5 | uid-9");
  equal(parseRef(ref), { doc: "ISO-12", sheet: "2/3", weld: "W5", uid: "uid-9" });
  equal(parseRef("ISO-12 | 2/3 | W5").uid, "");
});

test("an isometric chosen before its sheet and weld still reads back", () => {
  equal(parseRef(formatRef({ doc: "ISO-12", sheet: "", weld: "", uid: "" })), { doc: "ISO-12", sheet: "", weld: "", uid: "" });
  equal(parseRef(formatRef({ doc: "ISO-12", sheet: "2/3", weld: "", uid: "" })), { doc: "ISO-12", sheet: "2/3", weld: "", uid: "" });
});

test("a plain weld number is this sheet's; a free note stays as typed", () => {
  equal(formatRef({ weld: " 12 " }), "12");
  equal(parseRef("12"), { doc: "", sheet: "", weld: "12", uid: "" });
  equal(parseRef("FIELD RUN 3 / see P&ID"), { doc: "", sheet: "", weld: "FIELD RUN 3 / see P&ID", uid: "" });
  equal(parseRef(""), { doc: "", sheet: "", weld: "", uid: "" });
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

test("where a reference stands: ok, renamed (with the new reference), gone, missing", () => {
  const f = { doc_no: "ISO-1", sheet_no: "1/1", weld_no: "5" };
  equal(classifyTarget(f, { ...f }), { status: "ok" });
  equal(classifyTarget(f, { ...f, weld_no: "7" }), { status: "renamed", current: { doc: "ISO-1", sheet: "1/1", weld: "7" } });
  equal(classifyTarget(f, { ...f, sheet_no: "2/2" }).status, "renamed", "moved to another sheet");
  equal(classifyTarget(f, null), { status: "gone" });
  equal(classifyTarget(null, null), { status: "missing" });
});

await run();
