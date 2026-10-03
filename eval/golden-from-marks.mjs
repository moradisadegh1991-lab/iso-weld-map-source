#!/usr/bin/env node
/**
 * Golden cases for sheets whose designer printed every joint number.
 *
 *   npm run golden:marks -- <folder of read sheets> <register.xlsx|.csv> [--pdfs <folder>] [--shop circle --field square]
 *
 * Each read sheet is a JSON of `meta`, `bom` and `weldMarks` — what is
 * PRINTED on the drawing, marker by marker (the extraction's ground truth,
 * the `welds` pass's job). The case's `expect` is written from the
 * contractor's register for that sheet, never from what the rules make of
 * the markers: an expectation copied from our own output would make every
 * later run agree with today's mistakes.
 *
 * Where the drawing and the register disagree on a joint and nobody has yet
 * said which is right, the read sheet lists it under `_disputes`
 * ({no, field, register, drawing}); that field is left out of `expect` and
 * the dispute is carried into the case for an engineer to settle.
 */
import { readdir, readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guessMapping, toRegister, scopeRows } from "../lib/truth/parse.mjs";
import { readRegister } from "./weldmap-truth.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, "cases", "golden");

/** 004-1 → 4-1, 001 → 1: the number as the drawing prints it. */
export const printedNo = (no) => String(no).trim().replace(/\d+/g, (d) => String(Number(d)));

/** The expectation for one sheet, from the register rows of that sheet. */
export function expectFrom(truth, disputes = []) {
  const skip = new Set(disputes.map((d) => `${printedNo(d.no)}.${d.field}`));
  const register = truth.map((w) => {
    const no = printedNo(w.no);
    const row = { no };
    for (const f of ["loc", "kind", "nps"]) if (w[f] != null && w[f] !== "" && !skip.has(`${no}.${f}`)) row[f] = w[f];
    return row;
  });
  const field = register.filter((w) => w.loc === "Field").map((w) => w.no);
  const spools = new Set(truth.map((w) => w.spool).filter(Boolean));
  // A joint whose shop or field is disputed may carry the only mark of a
  // spool on one side and none on the other: the register's spool count
  // then settles the dispute by the back door, so it is not expected.
  const locDisputed = disputes.some((d) => d.field === "loc");
  return {
    weldCount: register.length,
    fieldWeldCount: field.length,
    fieldWelds: field,
    ...(truth.some((w) => w.loc === "Shop") && !locDisputed ? { spoolCount: spools.size } : {}),
    register,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const pdfs = opt("--pdfs");
  const legend = { shop: opt("--shop") || "circle", field: opt("--field") || "square" };
  const [dir, regFile] = args;
  if (!dir || !regFile) {
    console.error("usage: golden:marks -- <folder of read sheets> <register.xlsx|.csv> [--pdfs <folder>] [--shop circle --field square]");
    process.exit(2);
  }
  const reg = await readRegister(regFile);
  const { mapping } = guessMapping(reg.headers, undefined, reg.rows);
  await mkdir(path.join(GOLDEN, "drawings"), { recursive: true });
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json")).sort()) {
    const read = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    const meta = read.meta || {};
    const scope = scopeRows(reg.headers, reg.rows, { drawingNo: meta.drawingNo, sheet: meta.sheet, rev: meta.rev });
    const truth = toRegister(scope.rows, mapping);
    const sheetNo = String(meta.sheet || "1").split("/")[0];
    const base = String(meta.drawingNo).replace(/^ISO-/i, "");
    const id = `HDPE-${base}-SH${sheetNo}${meta.rev && meta.rev !== "0" ? `-${meta.rev}` : ""}`;
    const pdfName = `${base}-SH${sheetNo}-${meta.rev || "0"}.pdf`;
    let drawing = null;
    if (pdfs && existsSync(path.join(pdfs, pdfName))) {
      await copyFile(path.join(pdfs, pdfName), path.join(GOLDEN, "drawings", pdfName));
      drawing = `drawings/${pdfName}`;
    }
    const disputes = read._disputes || [];
    const def = {
      id,
      kind: "golden",
      title: `${meta.drawingNo} sheet ${meta.sheet} rev ${meta.rev} — ${truth.length} joints printed on the sheet`,
      source: { drawingNo: meta.drawingNo, sheet: meta.sheet, revision: meta.rev, project: "HDPE plant, unit 25",
        register: "contractor's joint history (S/F, Type, Size per joint)", bom: "project MTO, this sheet" },
      drawing,
      provenance: `input.weldMarks: ${read._provenance || "transcribed from the drawing"}. expect: the contractor's register for this sheet — not this engine's output.`,
      verifiedBy: "",
      verifiedAt: "",
      legend,
      input: { meta, bom: read.bom || [], weldMarks: read.weldMarks },
      expect: expectFrom(truth, disputes),
      ...(disputes.length ? { _disputes: disputes } : {}),
      ...(scope.note ? { _note: scope.note } : {}),
    };
    await writeFile(path.join(GOLDEN, `${id}.json`), JSON.stringify(def, null, 1) + "\n");
    console.log(`${id}: ${truth.length} joints in the register, ${read.weldMarks.marks.length} markers read${disputes.length ? `, ${disputes.length} disputed` : ""}${drawing ? "" : " (no PDF copied)"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
