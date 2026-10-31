#!/usr/bin/env node
/**
 * The no-model drawing reader (tools/iso-read.py) measured on the golden
 * sheets that print their weld markers (eval/cases/golden/HDPE-25-*).
 *
 *   node --import ./tools/register.mjs eval/reader-report.mjs [--cache <dir>] [--only 25-1004] [--jobs 4]
 *
 * Two measurements, kept apart because they answer different questions:
 *
 *   MARKS     what the reader saw against what is printed (the golden
 *             `input.weldMarks`, read by eye and checked against the
 *             contractor's register): markers found, missed and invented,
 *             and of those found, the frame's shape and the label beside it.
 *
 *   TITLE     the title block (meta: drawing number, sheet, revision)
 *             against the sheet's golden `input.meta`: right, wrong and
 *             left unknown are counted apart — unknown is not wrong, a
 *             wrong value is the failure that matters.
 *
 *   REGISTER  what the platform's own rules make of the reader's markers
 *             (lib/register/weld-marks.mjs, the sheet's BOM from the MTO,
 *             the project's declared legend) against the contractor's
 *             register (`expect.register`): weld count, number, shop/field.
 *             Size and joint type are not claimed here: the reader does not
 *             read the leg's size, so they are left for a person.
 *
 * The reader's output is cached per sheet; delete the cache to re-read.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { weldListFromMarks } from "../lib/register/weld-marks.mjs";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const value = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const CACHE = value("cache", "eval/results/reader");
const ONLY = value("only");
const JOBS = Number(value("jobs", 4));
const DIR = "eval/cases/golden";

const cases = [];
for (const f of (await readdir(DIR)).sort()) {
  if (!/^HDPE-25-.*\.json$/.test(f)) continue;
  const def = JSON.parse(await readFile(path.join(DIR, f), "utf8"));
  if (ONLY && !def.drawing.includes(ONLY)) continue;
  cases.push(def);
}
await mkdir(CACHE, { recursive: true });

async function read(def) {
  const out = path.join(CACHE, path.basename(def.drawing).replace(/\.pdf$/, ".json"));
  if (!existsSync(out)) {
    const { stdout } = await run("python3", ["-I", "tools/iso-read.py", path.join(DIR, def.drawing)], { maxBuffer: 1 << 24 });
    await writeFile(out, stdout);
  }
  return JSON.parse(await readFile(out, "utf8"));
}

// a few sheets at a time: tesseract is a process per marker
const reads = new Map();
for (let i = 0; i < cases.length; i += JOBS) {
  const batch = cases.slice(i, i + JOBS);
  const got = await Promise.all(batch.map(read));
  batch.forEach((d, k) => reads.set(d.id, got[k]));
}

const marksOf = (def) => (Array.isArray(def.input.weldMarks) ? def.input.weldMarks : def.input.weldMarks.marks);
const T = { printed: 0, found: 0, missed: 0, invented: 0, shapeOk: 0, labelOk: 0, labelPrinted: 0, labelFound: 0,
  regExpected: 0, regMade: 0, regMatched: 0, locOk: 0, locBlank: 0, kindOk: 0, kindBad: 0, kindBlank: 0, sheetsExact: 0 };
const META = ["drawingNo", "sheet", "rev"];
const TB = Object.fromEntries(META.map((k) => [k, { right: 0, wrong: [], unknown: [] }]));
const rows = [];
// the BOM against the project MTO each golden sheet carries. The MTO mostly has no PT numbers, so
// a row is matched by its description (the share of words in common, at least 0.6, best first);
// its size is right only as the MTO gives it ("6 x 3/4"); a size not read is unknown, not wrong.
// The MTO is the project's list, not a transcription of the sheet: a branch fitting it lists at
// its branch size alone (3/4) is printed "2 x 3/4" on the sheet, and counts here as wrong.
const BOM = { gold: 0, found: 0, extra: 0, sizeRight: 0, sizeConvention: 0, sizeWrong: [], sizeUnknown: 0, sheets: 0 };
const sizeParts = (v) => String(v ?? "").toLowerCase().split(/\s*x\s*/).map((t) => t.trim()).filter(Boolean);
const sizeKey = (v) => String(v ?? "").replace(/\s+/g, "").toLowerCase();
const words = (t) => new Set(String(t || "").toUpperCase().split(/[^A-Z0-9#./-]+/).filter((w) => w.length > 1));
const alike = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.max(A.size, B.size)); };
for (const def of cases) {
  const goldBom = Array.isArray(def.input.bom) ? def.input.bom : [];
  const gotBom = Array.isArray(reads.get(def.id).bom) ? reads.get(def.id).bom : [];
  if (!goldBom.length) continue;
  BOM.sheets++;
  const pairs = [];
  // rows alike in words (two pipes of one spec) are told apart by their size
  goldBom.forEach((g, i) => gotBom.forEach((r, j) => { const s = alike(g.description, r.description); if (s >= 0.6) pairs.push([s + (sizeKey(g.diam) === sizeKey(r.diam) ? 0.01 : 0), i, j]); }));
  pairs.sort((a, b) => b[0] - a[0]);
  const gi = new Set(), rj = new Set();
  for (const [, i, j] of pairs) {
    if (gi.has(i) || rj.has(j)) continue;
    gi.add(i); rj.add(j);
    const g = goldBom[i], r = gotBom[j];
    BOM.found++;
    if (r.diam == null) BOM.sizeUnknown++;
    else if (sizeKey(r.diam) === sizeKey(g.diam)) BOM.sizeRight++;
    // every figure of the shorter one in the longer: the sheet prints "2 x 3/4" where the MTO lists 3/4,
    // or "5/8" with the bolt's length in its description where the MTO lists "5/8 x 90"
    else if (((a, b) => a.every((t) => b.includes(t)))(...[sizeParts(r.diam), sizeParts(g.diam)].sort((a, b) => a.length - b.length))) BOM.sizeConvention++;
    else BOM.sizeWrong.push(`${path.basename(def.drawing, ".pdf")} PT${r.pt}: ${r.diam} (MTO ${g.diam})`);
  }
  BOM.gold += goldBom.length;
  BOM.extra += gotBom.length - rj.size;
}
// the cut-length tables transcribed for a few sheets (eval/cases/reader-cuts.json)
const CUTS = { printed: 0, found: 0, lengthRight: 0, lengthWrong: [], sizeRight: 0, sizeWrong: [], sizeUnknown: 0, invented: 0 };
const cutTruth = JSON.parse(await readFile("eval/cases/reader-cuts.json", "utf8")).sheets;
for (const def of cases) {
  const name = path.basename(def.drawing, ".pdf");
  const truth = cutTruth[name];
  if (!truth) continue;
  const got = new Map((reads.get(def.id).cutLengths || []).map((c) => [c.piece, c]));
  for (const [piece, len, ns] of truth) {
    CUTS.printed++;
    const c = got.get(piece);
    if (!c) continue;
    CUTS.found++;
    if (c.lengthMm === len) CUTS.lengthRight++; else CUTS.lengthWrong.push(`${name} <${piece}>: ${c.lengthMm} (printed ${len})`);
    if (c.ns == null) CUTS.sizeUnknown++; else if (c.ns === ns) CUTS.sizeRight++; else CUTS.sizeWrong.push(`${name} <${piece}>: ${c.ns} (printed ${ns})`);
  }
  CUTS.invented += [...got.keys()].filter((p) => !truth.some(([q]) => q === p)).length;
}
for (const def of cases) {
  const gold = marksOf(def).filter((m) => m.outline !== "dashed");
  const got = reads.get(def.id).marks;
  const meta = reads.get(def.id).meta || {};
  for (const k of META) {
    const v = meta[k], e = def.input.meta?.[k];
    if (v == null) TB[k].unknown.push(path.basename(def.drawing, ".pdf"));
    else if (v === e) TB[k].right++;
    else TB[k].wrong.push(`${path.basename(def.drawing, ".pdf")}: ${v} (printed ${e})`);
  }
  const byNo = new Map(got.map((m) => [m.no, m]));
  const gotNos = new Set(got.map((m) => m.no));
  const goldNos = new Set(gold.map((m) => m.no));
  const missed = gold.filter((m) => !byNo.has(m.no)).map((m) => m.no);
  const invented = got.filter((m) => !goldNos.has(m.no)).map((m) => m.no);
  let shapeOk = 0, labelOk = 0;
  for (const m of gold) {
    const r = byNo.get(m.no);
    if (!r) continue;
    if (r.shape === m.shape) shapeOk++;
    if ((r.label || "") === (m.label || "")) labelOk++;
    if (m.label) T.labelPrinted++;
    if (m.label && r.label === m.label) T.labelFound++;
  }
  // the register the platform's rules make of what the reader saw
  const conv = weldListFromMarks({ ...def.input, weldMarks: { marks: got.map((m) => ({ ...m, nps: null, branch: false, spool: null })) } }, def.legend || {});
  const made = new Map(conv.weldList.map((w) => [w.no, w]));
  const exp = def.expect.register || [];
  let matched = 0, locOk = 0, locBlank = 0;
  for (const e of exp) {
    const w = made.get(e.no);
    if (!w) continue;
    matched++;
    if (!w.loc) locBlank++; else if (w.loc === e.loc) locOk++;
    if (!e.kind) continue;
    if (!w.kind) T.kindBlank++; else if (w.kind === e.kind) T.kindOk++; else T.kindBad++;
  }
  const exact = missed.length === 0 && invented.length === 0;
  Object.assign(T, {
    printed: T.printed + gold.length, found: T.found + gold.length - missed.length, missed: T.missed + missed.length,
    invented: T.invented + invented.length, shapeOk: T.shapeOk + shapeOk, labelOk: T.labelOk + labelOk,
    regExpected: T.regExpected + exp.length, regMade: T.regMade + conv.weldList.length, regMatched: T.regMatched + matched,
    locOk: T.locOk + locOk, locBlank: T.locBlank + locBlank, sheetsExact: T.sheetsExact + (exact ? 1 : 0),
  });
  rows.push({ sheet: path.basename(def.drawing, ".pdf"), printed: gold.length, found: gold.length - missed.length, missed, invented,
    shape: `${shapeOk}/${gold.length - missed.length}`, register: `${conv.weldList.length}/${exp.length}`, loc: `${locOk}/${matched}` });
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
for (const r of rows) {
  const flag = r.missed.length || r.invented.length ? "  " : "✓ ";
  console.log(`${flag}${r.sheet.padEnd(16)} found ${String(r.found).padStart(3)}/${String(r.printed).padEnd(3)} shape ${r.shape.padEnd(7)} register ${r.register.padEnd(7)} loc ${r.loc.padEnd(7)}` +
    `${r.missed.length ? ` missed [${r.missed.join(",")}]` : ""}${r.invented.length ? ` invented [${r.invented.join(",")}]` : ""}`);
}
console.log(`\n${cases.length} sheets · ${T.sheetsExact} read exactly (every marker, nothing invented)`);
console.log(`MARKS     found ${T.found}/${T.printed} (${pct(T.found, T.printed)}) · invented ${T.invented} · shape ${pct(T.shapeOk, T.found)} · label ${pct(T.labelOk, T.found)} (printed labels found ${T.labelFound}/${T.labelPrinted})`);
console.log(`TITLE     ${META.map((k) => `${k} right ${TB[k].right}/${cases.length}, wrong ${TB[k].wrong.length}, unknown ${TB[k].unknown.length}`).join(" · ")}`);
for (const k of META) if (TB[k].wrong.length) console.log(`          ${k} wrong: ${TB[k].wrong.join("; ")}`);
console.log(`BOM       ${BOM.sheets} sheets · rows matched ${BOM.found}/${BOM.gold} (${pct(BOM.found, BOM.gold)}) · rows not matched to the MTO ${BOM.extra} · size right ${BOM.sizeRight}, as printed where the MTO writes it otherwise ${BOM.sizeConvention}, wrong ${BOM.sizeWrong.length}, unknown ${BOM.sizeUnknown}`);
if (BOM.sizeWrong.length) console.log(`          size wrong: ${BOM.sizeWrong.slice(0, 20).join("; ")}${BOM.sizeWrong.length > 20 ? " …" : ""}`);
console.log(`CUT       ${Object.keys(cutTruth).length} sheets transcribed · pieces found ${CUTS.found}/${CUTS.printed} · invented ${CUTS.invented} · length right ${CUTS.lengthRight}, wrong ${CUTS.lengthWrong.length} · size right ${CUTS.sizeRight}, wrong ${CUTS.sizeWrong.length}, unknown ${CUTS.sizeUnknown}`);
for (const x of [...CUTS.lengthWrong, ...CUTS.sizeWrong]) console.log(`          ${x}`);
console.log(`JOINT     type set by the rules on ${T.kindOk + T.kindBad} welds, right on ${pct(T.kindOk, T.kindOk + T.kindBad)} · ${T.kindBlank} left for a person (no size is read off the drawing)`);
console.log(`REGISTER  welds ${T.regMade} made for ${T.regExpected} in the contractor's register · matched by number ${T.regMatched} (${pct(T.regMatched, T.regExpected)}) · shop/field right ${pct(T.locOk, T.regMatched - T.locBlank)} (${T.locBlank} left blank)`);
await writeFile(path.join(CACHE, "summary.json"), JSON.stringify({ totals: T, title: TB, bom: BOM, cuts: CUTS, rows }, null, 2));
