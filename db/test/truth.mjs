#!/usr/bin/env node
/**
 * Reading and scoring a contractor's weld register.
 *
 * The number this produces is the only evidence the project will ever have
 * for extraction accuracy, so these tests are mostly about the ways such a
 * number can flatter itself.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { parseDelimited, guessMapping, normalizeLoc, normalizeKind, toRegister } from "../../lib/truth/parse.mjs";
import { compareRegister, toGoldenExpect, weldKey } from "../../lib/truth/compare.mjs";

// ── reading the file ─────────────────────────────────────────────────────

test("a CSV, a TSV and an Excel paste all read the same", async () => {
  const rows = [["W-01", "Field", "Tie-in"], ["W-02", "Shop", "BW"]];
  for (const d of [",", "\t", ";"]) {
    const text = ["Weld No" + d + "Location" + d + "Type",
                  ...rows.map((r) => r.join(d))].join("\n");
    const p = parseDelimited(text);
    equal(p.delimiter, d);
    equal(p.rows, rows, `delimiter ${JSON.stringify(d)}`);
  }
});

test("a register pasted as aligned columns reads correctly", async () => {
  // What actually arrives when the register is copied out of a PDF, a
  // terminal or a chat message: no tabs, columns lined up with spaces. The
  // first version defaulted to a comma here, found none, and put the whole
  // row in the weld-number cell — producing a golden file that was
  // structurally valid and completely wrong.
  const p = parseDelimited([
    "Weld No   SHOP/FIELD   JOINT       NPS",
    "W-01      FIELD        TIE IN      28",
    "W-02      Shop         Butt Weld   28",
  ].join("\n"));
  equal(p.headers, ["Weld No", "SHOP/FIELD", "JOINT", "NPS"]);
  equal(p.suspectDelimiter, false);

  const { mapping } = guessMapping(p.headers);
  const reg = toRegister(p.rows, mapping);
  equal(reg[0], { no: "W-01", loc: "Field", kind: "Tie-in", nps: 28, spool: null, ndt: null });
  equal(reg[1].kind, "BW", "and a single space inside a value does not split it");
});

test("a single space never splits a column", async () => {
  // "Butt Weld", "Weld No" and "TIE IN" all contain one; two or more is the
  // separator, one is part of the word.
  const p = parseDelimited("Weld No   Joint Type\nW-01      Butt Weld");
  equal(p.headers, ["Weld No", "Joint Type"]);
  equal(p.rows[0], ["W-01", "Butt Weld"]);
});

test("a layout it cannot split says so instead of inventing a register", async () => {
  // One column, but the header names several fields we know: the separator
  // was missed. Silence here is what produced the broken golden file.
  const p = parseDelimited("Weld No|Location|Type\nW-01|Field|Tie-in");
  equal(p.headers.length, 1, "the pipe character is not a delimiter it knows");
  equal(p.suspectDelimiter, true, "and it admits the row is really several columns");
});

test("a genuinely single-column file is not accused of being wide", async () => {
  const p = parseDelimited("Weld No\nW-01\nW-02");
  equal(p.headers, ["Weld No"]);
  equal(p.suspectDelimiter, false, "one field name is not two");
});

test("a quoted cell containing the delimiter survives", async () => {
  const p = parseDelimited('Weld No,Note\nW-01,"tie-in, upper end"');
  equal(p.rows[0], ["W-01", "tie-in, upper end"]);
});

test("a short row is padded, not dropped", async () => {
  // A register with the NDT column left blank is the normal case.
  const p = parseDelimited("Weld No,Location,NDT\nW-01,Field\nW-02,Shop,RT");
  equal(p.rows.length, 2);
  equal(p.rows[0], ["W-01", "Field", ""]);
});

test("headers are recognised in both languages", async () => {
  for (const headers of [
    ["Weld No", "Location", "Weld Type", "Size"],
    ["شماره جوش", "محل جوش", "نوع جوش", "قطر"],
    ["WELD_NO", "SHOP/FIELD", "JOINT", "NPS"],
  ]) {
    const { mapping, unmapped } = guessMapping(headers);
    equal(mapping.no, 0, headers[0]);
    equal(mapping.loc, 1, headers[1]);
    equal(mapping.kind, 2, headers[2]);
    equal(mapping.nps, 3, headers[3]);
    assert(!unmapped.includes("no"), "the weld number must always be found");
  }
});

test("a column it cannot classify is reported, never guessed", async () => {
  // Guessing here would corrupt the measurement this whole file exists for.
  const { mapping, unmapped } = guessMapping(["Weld No", "Remarks", "Signature"]);
  equal(mapping.no, 0);
  assert(!("loc" in mapping), "Remarks must not become the location column");
  assert(unmapped.includes("loc") && unmapped.includes("kind"), "and it says which are missing");
});

test("Field and Shop are recognised however the register spells them", async () => {
  for (const v of ["Field", "FIELD", "F", "site", "میدانی", "سایت"]) equal(normalizeLoc(v), "Field", v);
  for (const v of ["Shop", "SHOP", "S", "fab", "کارگاه"]) equal(normalizeLoc(v), "Shop", v);
  equal(normalizeLoc(""), null, "blank stays blank rather than defaulting");
  equal(normalizeLoc("???"), null, "and so does something unrecognised");
});

test("joint types normalise, and an unknown one is kept verbatim", async () => {
  equal(normalizeKind("TIE IN"), "Tie-in");
  equal(normalizeKind("Butt Weld"), "BW");
  equal(normalizeKind("Olet"), "Olet", "an unfamiliar type is preserved, not dropped");
});

test("rows without a weld number are skipped", async () => {
  // Totals rows and blank separators live at the bottom of real registers.
  const reg = toRegister([["W-01", "Field"], ["", "Shop"], ["TOTAL", ""]], { no: 0, loc: 1 });
  equal(reg.map((w) => w.no), ["W-01", "TOTAL"], "only a genuinely empty number is dropped");
});

// ── scoring against what the engine computed ─────────────────────────────

const truth = [
  { no: "W-01", loc: "Field", kind: "Tie-in", nps: 28 },
  { no: "W-02", loc: "Shop", kind: "BW", nps: 28 },
];

test("weld numbering styles do not count as a mismatch", async () => {
  equal(weldKey("W-01"), weldKey("W01"));
  equal(weldKey("W-01"), weldKey("1"));
  const r = compareRegister(truth, [
    { no: "W01", loc: "Field", kind: "Tie-in", nps: 28 },
    { no: "2", loc: "Shop", kind: "BW", nps: 28 },
  ]);
  equal(r.counts.matched, 2);
  equal(r.fieldAccuracy, 1);
});

test("a field the register does not carry is not scored either way", async () => {
  // The trap: scoring a blank as wrong understates, scoring it as right
  // overstates. It is simply not measured.
  const r = compareRegister(
    [{ no: "W-01", loc: "Field", kind: null, nps: null }],
    [{ no: "W-01", loc: "Field", kind: "Tie-in", nps: 28 }],
  );
  equal(r.fields.loc, { compared: 1, correct: 1, measured: true });
  equal(r.fields.kind, { compared: 0, correct: 0, measured: false });
  equal(r.fieldAccuracy, 1, "and the headline is over what was actually compared");
});

test("a missed weld and an invented weld are counted apart", async () => {
  // They are different failures: one is never inspected, the other is queried
  // by the shop. A single averaged score would hide both.
  const r = compareRegister(truth, [
    { no: "W-01", loc: "Field", kind: "Tie-in", nps: 28 },
    { no: "W-09", loc: "Shop", kind: "BW", nps: 28 },
  ]);
  equal(r.counts.missing, 1, "W-02 is in the register and not in ours");
  equal(r.counts.extra, 1, "W-09 is ours and not in the register");
  equal(r.weldCountExact, false);
  equal(r.missing[0].no, "W-02");
  equal(r.extra[0].no, "W-09");
});

test("a wrong location is caught, and named", async () => {
  // Shop instead of Field changes the NDT requirement on most projects.
  const r = compareRegister(truth, [
    { no: "W-01", loc: "Shop", kind: "Tie-in", nps: 28 },
    { no: "W-02", loc: "Shop", kind: "BW", nps: 28 },
  ]);
  equal(r.counts.matched, 2);
  equal(r.fields.loc, { compared: 2, correct: 1, measured: true });
  const bad = r.matched[0].diffs.find((d) => d.field === "loc");
  equal([bad.truth, bad.computed, bad.same], ["Field", "Shop", false]);
});

test("nothing to compare yields null, not a flattering 100%", async () => {
  equal(compareRegister([], []).fieldAccuracy, null);
  equal(compareRegister([], []).weldCountExact, false, "an empty register proves nothing");
});

// ── the golden case it writes ────────────────────────────────────────────

test("the expectation is written from the register, never from our output", async () => {
  // An expectation derived from this engine would make every future run
  // agree with today's bugs.
  const expect = toGoldenExpect(truth);
  equal(expect.weldCount, 2);
  equal(expect.fieldWeldCount, 1);
  equal(expect.fieldWelds, ["W-01"]);
  equal(expect.register[0], { no: "W-01", loc: "Field", kind: "Tie-in", nps: 28 });
});

test("a field the register left blank does not become an expectation", async () => {
  const expect = toGoldenExpect([{ no: "W-01", loc: "Field", kind: null, nps: null }]);
  equal(expect.register[0], { no: "W-01", loc: "Field" }, "only what the register actually said");
});

await run();
