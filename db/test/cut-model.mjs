#!/usr/bin/env node
/**
 * The cut pieces as a model (lib/register/cut-model.mjs): the weld at each end, the spool and the
 * angle are checked against the sheet's own marks — said, not decided.
 */
import { test, run, equal } from "./harness.mjs";
import { cutChecks, endSpools } from "../../lib/register/cut-model.mjs";

const W = (no, spool) => ({ kind: "weld-shop", no, attrs: spool ? { spool } : {} });
const S = (no) => ({ kind: "spool", no, attrs: {} });
const ITEMS = [W("1", "SP-1"), W("2", "SP-1"), W("3", "SP-2"), S("SP-1"), S("SP-2")];

test("a consistent piece raises nothing", () => {
  equal(cutChecks([{ piece: 1, lengthMm: 900, from: "1", to: "2", spool: "SP-1", angle: "90" }], ITEMS), []);
  equal(cutChecks([{ piece: 2, lengthMm: 500 }], ITEMS), [], "a piece with nothing said about its ends is not wrong");
});

test("an end that is not a weld of the sheet, or the same weld twice, is said", () => {
  const p = cutChecks([{ piece: 1, from: "1", to: "9" }, { piece: 2, from: "2", to: "2" }], ITEMS);
  equal(p.length, 2);
  equal([/سرجوش 9/.test(p[0]), /یک سرجوش است/.test(p[1])], [true, true]);
});

test("the spool must be a spool of the sheet and one of the spools its end welds are in", () => {
  const p = cutChecks([{ piece: 1, from: "1", to: "2", spool: "SP-2" }, { piece: 2, spool: "SP-9" }], ITEMS);
  equal(p.length, 2);
  equal([/دو سرش در SP-1/.test(p[0]), /SP-9 روی این برگ علامت ندارد/.test(p[1])], [true, true]);
  equal(endSpools({ from: "1", to: "3" }, ITEMS), ["SP-1", "SP-2"], "a piece between two spools names both");
  equal(cutChecks([{ piece: 3, from: "1", to: "3", spool: "SP-2" }], ITEMS), [], "either end's spool is accepted");
});

test("the angle is a number above 0 up to 90", () => {
  equal(cutChecks([{ piece: 1, angle: "45" }, { piece: 2, angle: "0" }, { piece: 3, angle: "120" }, { piece: 4, angle: "x" }], ITEMS).length, 3);
});

await run();
