#!/usr/bin/env node
/**
 * The isometric's information (owner's request of 2026-11-02;
 * lib/register/iso-info.mjs): every value in a logical section, from what the
 * system already holds; a missing drawing number or revision is an error, the
 * rest are warnings — nothing is corrected.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { INFO_SECTIONS, INFO_FIELDS, infoProblems, infoValue } from "../../lib/register/iso-info.mjs";
import { LISTS, COLUMN_LIST } from "../../lib/register/value-lists.mjs";

test("every field is one the system already holds: the sheet's meta, or the line list the reader and the line carry", () => {
  const meta = ["drawingNo", "rev", "sheet", "lineNo", "unit", "pipingClass", "nps", "schedule"];
  const line = ["lineClass", "designPressure", "operatingPressure", "designTemp", "operatingTemp", "testPressure", "testFluid", "ndt", "pwht", "paint", "insulationType", "insulationThk"];
  equal(INFO_FIELDS.filter((f) => f.from === "meta").map((f) => f.key).sort(), [...meta].sort());
  equal(INFO_FIELDS.filter((f) => f.from === "line").map((f) => f.key).sort(), [...line].sort());
  equal(new Set(INFO_FIELDS.map((f) => f.key)).size, INFO_FIELDS.length, "no field twice");
  equal(INFO_SECTIONS.map((s) => s.id), ["identity", "line", "conditions", "test", "coating"]);
  for (const f of INFO_FIELDS) if (COLUMN_LIST[f.key]) assert(LISTS[COLUMN_LIST[f.key]], `${f.key} picks from a real list`);
});

test("a value is read from the store it lives in; blank is blank", () => {
  const f = (k) => INFO_FIELDS.find((x) => x.key === k);
  equal([infoValue(f("rev"), { rev: " A0 " }, { rev: "X" }), infoValue(f("designTemp"), { designTemp: "no" }, { designTemp: " 65 " }), infoValue(f("ndt"), {}, null)], ["A0", "65", ""]);
});

test("a missing drawing number or revision is an error; a complete, consistent sheet has none", () => {
  equal(infoProblems({}, {}).errors, ["شمارهٔ نقشه نوشته نشده", "رویژن نوشته نشده"]);
  equal(infoProblems({ drawingNo: "ISO-1", rev: "0", sheet: "3/4", nps: "2" }, { designPressure: "7.4", operatingPressure: "2.3", designTemp: "65", operatingTemp: "43", testPressure: "11.1" }), { errors: [], warnings: [] });
});

test("warnings, never corrections: a sheet not N/M or past the last, a value with no number, operating above design, test below design, a size that is not one", () => {
  const w = (meta, line) => infoProblems({ drawingNo: "A", rev: "0", ...meta }, line).warnings;
  assert(/به صورت N\/M نیست/.test(w({ sheet: "three" }, {})[0]));
  assert(/از تعداد برگ‌ها بیشتر/.test(w({ sheet: "5/4" }, {})[0]));
  assert(/عددی ندارد/.test(w({}, { insulationThk: "thick" })[0]));
  equal(w({}, { designPressure: "FV", insulationThk: "-", designTemp: "-29/65" }), [], "FV, a dash and a range are values");
  assert(/فشار کاری \(8.1\) از طراحی \(7.4 barg\) بیشتر/.test(w({}, { designPressure: "7.4 barg", operatingPressure: "8.1" })[0]));
  assert(/دمای کاری \(80\) از طراحی \(65\)/.test(w({}, { designTemp: "65", operatingTemp: "80" })[0]));
  assert(/فشار تست \(5\) از فشار طراحی \(7.4\) کمتر/.test(w({}, { designPressure: "7.4", testPressure: "5" })[0]));
  assert(/قطر لوله به نظر نمی‌رسد/.test(w({ nps: "abc" }, {})[0]));
  equal(w({ nps: "1.1/2" }, {}), [], "a size as the sheets write it");
});

await run();
