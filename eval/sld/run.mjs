#!/usr/bin/env node
/**
 * SLD extraction evaluation (Phase 12.3).
 *   npm run eval:sld                 per-category precision / recall / F1 over eval/sld/cases.mjs
 *   npm run eval:sld -- --check      fail when a category is worse than eval/sld/baseline.json (tolerance 0.02)
 *   npm run eval:sld -- --update     write the baseline
 *
 * READ THIS BEFORE QUOTING A NUMBER: every case is SYNTHETIC — drawn by eval/sld/dsl.mjs with clean, regular symbols and Helvetica text, with the ground truth recorded as it is
 * drawn. The figures say the rules do what they were written to do on sheets built to the same conventions; they say NOTHING about real single-line diagrams, whose symbols,
 * fonts, scales and clutter differ. Categories are reported separately and are never combined. See eval/sld/README.md for the real-data package a real figure needs.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pdfOf, scannedPdf } from "./synth.mjs";
import { CASES } from "./cases.mjs";
import { scoreCase, pool } from "./metrics.mjs";
import { extractSld } from "../../lib/sld/extract/run.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const CATS = ["symbolDetection", "symbolClassification", "textExtraction", "tagExtraction", "symbolToTagAssociation", "ratingExtraction"];

export function pdfFor(c) {
  const drawings = c.build();
  const vector = pdfOf(drawings.map((d) => d.page));
  if (c.kind !== "scan") return { pdf: vector, drawings };
  const img = scannedPdf(vector, { dpi: c.dpi, noise: c.noise });
  return { pdf: pdfOf([{ width: img.Wu, height: img.Hu, image: img }]), drawings: [drawings[0]] };
}

export async function runCase(c, options = {}) {
  const { pdf, drawings } = pdfFor(c);
  const r = await extractSld(pdf, { ...(c.kind === "scan" ? { dpi: 200 } : {}), ...options }, { tools: {} });
  const gold = { symbols: [], texts: [], tags: [], assoc: [], ratings: [] };
  let off = 0;
  for (const d of drawings) {
    gold.symbols.push(...d.gold.symbols.map((s) => ({ ...s, id: s.id + off })));
    gold.texts.push(...d.gold.texts); gold.tags.push(...d.gold.tags);
    gold.assoc.push(...d.gold.assoc.map(([t, id]) => [t, id + off])); gold.ratings.push(...d.gold.ratings.map(([id, w]) => [id + off, w]));
    off += d.gold.symbols.length;
  }
  return { id: c.id, draft: r.draft, scores: scoreCase(r.draft.items, gold), gold };
}

export async function evaluate({ only } = {}) {
  // `categories` pools the VECTOR cases (poppler is deterministic: this is what the gate checks); `scanCategories` pools the SCANNED cases (OCR / OpenCV versions move them: reported, NOT gated)
  const per = [], cat = Object.fromEntries(CATS.map((k) => [k, []])), scan = Object.fromEntries(CATS.map((k) => [k, []]));
  for (const c of CASES.filter((x) => !only || only.includes(x.id))) {
    const r = await runCase(c);
    per.push({ id: c.id, kind: c.kind, scores: Object.fromEntries(CATS.map((k) => [k, pool([r.scores[k]])])) });
    for (const k of CATS) (c.kind === "scan" ? scan : cat)[k].push(r.scores[k]);
  }
  return { synthetic: true, categories: Object.fromEntries(CATS.map((k) => [k, pool(cat[k])])), scanCategories: Object.fromEntries(CATS.map((k) => [k, pool(scan[k])])), cases: per };
}

const fmt = (v) => (v == null ? "  n/a" : v.toFixed(3));
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), basePath = path.join(dir, "baseline.json");
  const res = await evaluate();
  console.log("SLD extraction — SYNTHETIC cases only (see the header of eval/sld/run.mjs before quoting any number)\n");
  const table = (title, cats) => { console.log(title); console.log("category                    gold  pred   tp   fp   fn   precision recall   f1");
    for (const k of CATS) { const m = cats[k]; console.log(`${k.padEnd(26)} ${String(m.gold).padStart(5)} ${String(m.predicted).padStart(5)} ${String(m.tp).padStart(4)} ${String(m.fp).padStart(4)} ${String(m.fn).padStart(4)}   ${fmt(m.precision)}    ${fmt(m.recall)}  ${fmt(m.f1)}`); } };
  table("VECTOR sheets (gated):", res.categories); console.log(""); table("SCANNED sheets (raster reader; reported, NOT gated — OCR / OpenCV versions move these):", res.scanCategories);
  console.log("\nper case F1 (symbolDetection / classification / text / tag / association / rating):");
  for (const c of res.cases) console.log(`  ${c.id.padEnd(36)} ${CATS.map((k) => fmt(c.scores[k].f1)).join(" ")}`);
  if (args.includes("--update")) { writeFileSync(basePath, JSON.stringify({ synthetic: true, note: "synthetic VECTOR cases only; not a real-drawing accuracy", categories: Object.fromEntries(CATS.map((k) => [k, { precision: res.categories[k].precision, recall: res.categories[k].recall, f1: res.categories[k].f1 }])) }, null, 2) + "\n"); console.log("\nbaseline written"); }
  if (args.includes("--check")) {
    if (!existsSync(basePath)) { console.error("no baseline"); process.exit(2); }
    const base = JSON.parse(readFileSync(basePath, "utf8")); let bad = 0;
    for (const k of CATS) for (const m of ["precision", "recall", "f1"]) { const now = res.categories[k][m], was = base.categories[k]?.[m]; if (was != null && (now == null || now < was - 0.02)) { console.error(`REGRESSION ${k}.${m}: ${fmt(now)} < baseline ${fmt(was)}`); bad++; } }
    console.log(bad ? `\nGATE FAILED (${bad})` : "\nGATE PASSED — no category worse than the baseline (synthetic cases)");
    process.exit(bad ? 1 : 0);
  }
}
