#!/usr/bin/env node
/**
 * The no-model reader (tools/iso-read.py) on drawing styles other than the
 * golden sheets', each against a transcription made by eye
 * (eval/cases/styles/<style>.json: the title block's line data, the BOM and
 * the CUT PIPE LENGTH table of some of its pages).
 *
 *   node --import ./tools/register.mjs eval/style-report.mjs [--cache <dir>] [--jobs 4] [--check]
 *
 * Each value is right, wrong or unknown (the reader said null), counted
 * apart: unknown is not wrong, a wrong value is the failure that matters.
 * With --check it exits 1 on any wrong value.
 *
 * The reader's output is cached per page; delete the cache to re-read.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const value = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const CACHE = value("cache", "eval/results/styles");
const JOBS = Math.max(1, Number(value("jobs", 3)));
const CHECK = argv.includes("--check");
const DIR = "eval/cases/styles";

const LINE_KEYS = ["lineNo", "lineClass", "designPressure", "operatingPressure", "designTemp", "operatingTemp", "testPressure", "testFluid", "ndt"];
const TITLE_KEYS = ["sheet", "rev"];
const norm = (v) => String(v).replace(/\s+/g, " ").trim().toUpperCase();

async function read(style, pdf, page) {
  const out = path.join(CACHE, `${style}-p${page}.json`);
  if (existsSync(out)) return JSON.parse(await readFile(out, "utf8"));
  const { stdout } = await run("python3", ["-I", "tools/iso-read.py", pdf, "--page", String(page)],
    { timeout: 300_000, maxBuffer: 1 << 26, env: { ...process.env, OMP_THREAD_LIMIT: "1" } });
  await mkdir(CACHE, { recursive: true });
  await writeFile(out, stdout);
  return JSON.parse(stdout);
}

const tally = () => ({ right: 0, wrong: 0, unknown: 0, missing: 0, invented: 0, wrongs: [] });
function score(t, what, truth, got) {
  if (got == null || got === "") t.unknown++;
  else if (norm(got) === norm(truth)) t.right++;
  else { t.wrong++; t.wrongs.push(`${what}: read ${got}, printed ${truth}`); }
}

const files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
let anyWrong = false;
for (const f of files) {
  const spec = JSON.parse(await readFile(path.join(DIR, f), "utf8"));
  const pdf = path.join(DIR, spec.drawing);
  const pages = Object.keys(spec.pages);
  const got = {};
  for (let i = 0; i < pages.length; i += JOBS) {
    await Promise.all(pages.slice(i, i + JOBS).map(async (p) => { got[p] = await read(spec.style, pdf, Number(p)); }));
  }
  const style = { generic: 0, golden: 0 };
  const title = tally(), line = tally(), bomRows = tally(), bomSize = tally(), bomQty = tally(), cut = tally();
  for (const p of pages) {
    const want = spec.pages[p], r = got[p];
    style[r.style === "generic" ? "generic" : "golden"]++;
    for (const k of TITLE_KEYS) if (want.line?.[k] != null) score(title, `p${p} ${k}`, want.line[k], r.meta?.[k]);
    for (const k of LINE_KEYS) if (want.line?.[k] != null) score(line, `p${p} ${k}`, want.line[k], r.lineData?.[k]);
    const bom = new Map((r.bom || []).map((b) => [b.pt, b]));
    for (const [pt, size, qty, unit] of want.bom || []) {
      const b = bom.get(pt);
      if (!b) { bomRows.missing++; continue; }
      bomRows.right++;
      score(bomSize, `p${p} PT ${pt} size`, size, b.diam);
      score(bomQty, `p${p} PT ${pt} qty`, `${qty} ${unit}`, b.qty == null ? null : `${b.qty} ${b.qtyUnit}`);
      bom.delete(pt);
    }
    if (want.bom) for (const pt of bom.keys()) { bomRows.invented++; bomRows.wrongs.push(`p${p} PT ${pt} is not printed`); }
    if (want.cut) {
      const cs = new Map((r.cutLengths || []).map((c) => [c.piece, c]));
      for (const [piece, mm, ns] of want.cut) {
        const c = cs.get(piece);
        if (!c) { cut.missing++; continue; }
        score(cut, `p${p} <${piece}> length`, String(mm), String(c.lengthMm));
        if (c.ns != null && norm(c.ns) !== norm(ns)) { cut.wrong++; cut.wrongs.push(`p${p} <${piece}> size: read ${c.ns}, printed ${ns}`); }
        cs.delete(piece);
      }
      for (const piece of cs.keys()) { cut.invented++; cut.wrongs.push(`p${p} <${piece}> is not printed`); }
    }
  }
  const line_ = (n, t, extra = "") => console.log(`${n.padEnd(12)} right ${t.right}  wrong ${t.wrong}  unknown ${t.unknown}${extra}`);
  console.log(`\n${spec.style} — ${pages.length} pages (${pages.join(", ")}); read as another style on ${style.generic}, as the golden layout on ${style.golden}`);
  line_("TITLE", title);
  line_("LINE DATA", line);
  console.log(`${"BOM ROWS".padEnd(12)} found ${bomRows.right}  missed ${bomRows.missing}  invented ${bomRows.invented}`);
  line_("BOM SIZE", bomSize);
  line_("BOM QTY", bomQty);
  console.log(`${"CUT".padEnd(12)} right ${cut.right}  wrong ${cut.wrong}  unknown ${cut.unknown}  missed ${cut.missing}  invented ${cut.invented}`);
  const wrongs = [title, line, bomRows, bomSize, bomQty, cut].flatMap((t) => t.wrongs);
  for (const w of wrongs) console.log(`  WRONG ${w}`);
  if (wrongs.length) anyWrong = true;
}
if (CHECK && anyWrong) process.exit(1);
