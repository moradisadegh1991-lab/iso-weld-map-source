#!/usr/bin/env node
/**
 * Printed-marker extraction against the contractor's register, at scale.
 *
 *   npm run weldmap:truth -- <folder of extraction JSONs> <register.xlsx|.csv> [--shop circle --field square] [--thd-labelled] [--json out.json]
 *
 * Each JSON is one sheet as the piping page holds it after extraction —
 * `meta` (drawing number, sheet, revision), `bom`, and `weldMarks` from the
 * `welds` pass — or the saved payload of a run. The register may be a whole
 * project's joint history: each sheet is compared with its own rows only
 * (lib/truth/parse.mjs scopeRows).
 *
 * WHAT IT MEASURES, AND WHAT IT DOES NOT
 *
 * The count and the numbering (a joint missing is a joint nobody inspects;
 * one invented is a line the shop queries), Shop/Field, joint type and size —
 * each over the joints both sides carry a value for, with the blanks the
 * rules left for a person counted apart, never as right or wrong. The
 * register is the contractor's: where it is wrong this number is wrong, and
 * it is still the only one worth printing.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseDelimited, guessMapping, toRegister, scopeRows } from "../lib/truth/parse.mjs";
import { compareRegister } from "../lib/truth/compare.mjs";
import { weldListFromMarks } from "../lib/register/weld-marks.mjs";

/** Header row and rows of a register file, whatever its format. */
export async function readRegister(file) {
  if (/\.(xlsx|xlsm|xls)$/i.test(file)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await readFile(file), { type: "buffer" });
    const all = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
    return { headers: all[0].map(String), rows: all.slice(1).map((r) => r.map((v) => String(v ?? ""))) };
  }
  const p = parseDelimited(await readFile(file, "utf8"));
  return { headers: p.headers, rows: p.rows };
}

/** One sheet: its rows of the register against the register read from its markers. */
export function scoreSheet(payload, register, legend) {
  const meta = payload.meta || {};
  const { mapping } = guessMapping(register.headers, undefined, register.rows);
  const scope = scopeRows(register.headers, register.rows, { drawingNo: meta.drawingNo, sheet: meta.sheet, rev: meta.rev });
  const truth = toRegister(scope.rows, mapping);
  const conv = weldListFromMarks(payload, legend);
  const read = conv.weldList.map((w) => ({ no: w.no, loc: w.loc || null, kind: w.kind || null, nps: Number(w.nps) || null }));
  const c = compareRegister(truth, read);
  const blanks = Object.fromEntries(["loc", "kind", "nps"].map((f) => [f, read.filter((w) => !w[f]).length]));
  return {
    sheet: `${meta.drawingNo || "?"} ${meta.sheet || ""}`.trim(),
    truth: truth.length, read: read.length, matched: c.counts.matched,
    missing: c.missing.map((w) => w.no), extra: c.extra.map((w) => w.no),
    countExact: truth.length === 0 ? read.length === 0 : c.weldCountExact,
    fields: c.fields, blanks, note: scope.note,
    wrong: c.matched.flatMap((m) => m.diffs.filter((d) => !d.same).map((d) => `${m.no}.${d.field}: ${d.truth}≠${d.computed}`)),
  };
}

export function summarise(rows) {
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const field = (f) => {
    const compared = rows.reduce((a, r) => a + r.fields[f].compared, 0);
    const correct = rows.reduce((a, r) => a + r.fields[f].correct, 0);
    return { compared, correct, accuracy: compared ? correct / compared : null, blank: rows.reduce((a, r) => a + r.blanks[f], 0) };
  };
  const truth = sum("truth");
  return {
    sheets: rows.length,
    sheetsCountExact: rows.filter((r) => r.countExact).length,
    truthJoints: truth, readJoints: sum("read"), matched: sum("matched"),
    missing: rows.reduce((a, r) => a + r.missing.length, 0), extra: rows.reduce((a, r) => a + r.extra.length, 0),
    recall: truth ? sum("matched") / truth : null,
    loc: field("loc"), kind: field("kind"), nps: field("nps"),
  };
}

const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const thd = args.indexOf("--thd-labelled");
  if (thd >= 0) args.splice(thd, 1);
  const legend = { shop: opt("--shop"), field: opt("--field"), thdLabelled: thd >= 0 };
  const out = opt("--json");
  const [dir, regFile] = args;
  if (!dir || !regFile) {
    console.error("usage: weldmap:truth -- <folder of extraction JSONs> <register.xlsx|.csv> [--shop circle --field square] [--json out.json]");
    process.exit(2);
  }
  const register = await readRegister(regFile);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const rows = [];
  for (const f of files) {
    const payload = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    rows.push({ file: f, ...scoreSheet(payload, register, legend) });
  }
  for (const r of rows) {
    console.log(`${r.countExact ? "✓" : "✗"} ${r.sheet.padEnd(22)} register ${String(r.truth).padStart(3)} · read ${String(r.read).padStart(3)}` +
      (r.missing.length ? ` · missing ${r.missing.join(",")}` : "") + (r.extra.length ? ` · extra ${r.extra.join(",")}` : "") +
      (r.wrong.length ? ` · ${r.wrong.join(" ")}` : "") + (r.note ? ` · ${r.note}` : ""));
  }
  const s = summarise(rows);
  console.log(`\n${s.sheets} sheets · count exact on ${s.sheetsCountExact} · ${s.truthJoints} joints in the register, ${s.readJoints} read, ` +
    `${s.matched} matched (recall ${pct(s.recall)}), ${s.missing} missing, ${s.extra} extra`);
  for (const f of ["loc", "kind", "nps"]) {
    console.log(`  ${f.padEnd(4)} ${pct(s[f].accuracy).padStart(6)} of ${s[f].compared} compared · ${s[f].blank} left blank for a person`);
  }
  if (out) await writeFile(out, JSON.stringify({ summary: s, sheets: rows }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
