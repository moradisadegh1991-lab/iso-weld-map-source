#!/usr/bin/env node
/**
 * P&ID reading evaluation (docs/audit/phase-11-pid-intelligence.md §evaluation).
 *   npm run eval:pid            per-category metrics over eval/pid/cases/*.json
 *   npm run eval:pid -- --check  fail when a category is worse than eval/pid/baseline.json
 *   npm run eval:pid -- --update write the baseline
 *
 * READ THIS BEFORE QUOTING A NUMBER: the cases are SYNTHETIC (`"synthetic": true`): they are built with known ground truth to exercise the
 * deterministic engine — OCR adapter (lib/pid/draft.mjs), proposal sanitizer, off-page resolution, duplicate detection — on the difficult
 * conditions a real set has (dense symbols, overlapping text, low resolution, crossing lines, off-page connectors, similar instrument tags,
 * revision clouds, multi-page packages). They are NOT a measurement of K110 accuracy; a real figure needs the OCR run on the set and a hand-labelled
 * gold. Categories are reported separately; a missing value is a miss, never a correct prediction.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { draftFromOcr, sanitizeProposal } from "../../lib/pid/draft.mjs";
import { resolveOffpage } from "../../lib/pid/graph.mjs";
import { validatePid } from "../../lib/engineering/validation.mjs";
import { setMetrics, edgeMetrics, offpageMetrics, pool } from "./metrics.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const cases = readdirSync(path.join(dir, "cases")).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(path.join(dir, "cases", f), "utf8")));
const tagOf = (i) => i.tag;

export function predict(c) {
  const ocr = draftFromOcr({ page: c.pageNumber || 1, w: c.page.width, h: c.page.height, items: c.ocr || [] }, c.bubbles?.length ? c.bubbles : null);
  const prop = c.proposal?.items?.length ? sanitizeProposal(c.proposal, { page: c.page }).draft : { items: [], edges: [] };
  const items = [...ocr.items, ...prop.items];
  const names = new Map(items.map((i) => [i.uid, i.tag || i.attrs?.lineNo]));
  const dir = (c.directory || []).map((d) => ({ docNo: d }));
  const off = resolveOffpage(ocr, { directory: dir }).map((o) => ({ ref: o.ref, status: o.status }));
  const v = validatePid({ draft: { ...ocr, items }, directory: dir });
  return {
    equipment: items.filter((i) => i.cls === "equipment").map(tagOf).filter(Boolean),
    instruments: items.filter((i) => i.cls === "instrument").map(tagOf).filter(Boolean),
    lines: items.filter((i) => i.cls === "line").map(tagOf).filter(Boolean),
    valves: items.filter((i) => i.cls === "valve").map((i) => `${i.tag}|${i.symbol}`),
    edges: prop.edges.map((e) => [names.get(e.from), names.get(e.to), e.type]),
    offpage: off,
    dupGroups: [...new Set(v.findings.filter((f) => f.code === "P_EQ_DUP_TAG").map((f) => f.entityNumber))],
  };
}

export function evaluate() {
  const per = [], cat = { equipmentTag: [], instrumentTag: [], lineNumber: [], valveSymbol: [], connectivity: [], duplicateDetection: [] }, off = [];
  for (const c of cases) {
    const p = predict(c), g = c.gold;
    const m = {
      equipmentTag: setMetrics(p.equipment, g.equipment), instrumentTag: setMetrics(p.instruments, g.instruments), lineNumber: setMetrics(p.lines, g.lines),
      valveSymbol: setMetrics(p.valves, g.valves.map((x) => `${x.tag}|${x.symbol}`)), connectivity: edgeMetrics(p.edges, g.edges),
      duplicateDetection: setMetrics(p.dupGroups, g.dupGroups) };
    for (const k of Object.keys(cat)) cat[k].push(m[k]);
    const o = offpageMetrics(p.offpage, g.offpage); off.push(o);
    per.push({ name: c.name, tags: c.tags, m, offpage: o });
  }
  const pooled = Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, pool(v)]));
  const og = off.reduce((t, o) => ({ gold: t.gold + o.gold, correct: t.correct + o.correct, wrongResolved: t.wrongResolved + o.wrongResolved, missed: t.missed + o.missed }), { gold: 0, correct: 0, wrongResolved: 0, missed: 0 });
  pooled.offpageResolution = { ...og, accuracy: og.gold ? og.correct / og.gold : null, falseResolutionRate: og.gold ? og.wrongResolved / og.gold : null };
  // the false-positive rate over everything read as an item (tags, lines, valves), pooled — reported on its own
  const allItems = ["equipmentTag", "instrumentTag", "lineNumber", "valveSymbol"].map((k) => pooled[k]);
  const pr = allItems.reduce((t, m) => ({ predicted: t.predicted + m.predicted, fp: t.fp + m.fp }), { predicted: 0, fp: 0 });
  pooled.falsePositiveRate = { predicted: pr.predicted, fp: pr.fp, rate: pr.predicted ? pr.fp / pr.predicted : null };
  return { synthetic: true, cases: per, pooled };
}

const pct = (x) => (x == null ? "  —  " : `${(x * 100).toFixed(1)}%`.padStart(6));
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const r = evaluate();
  console.log("P&ID reading evaluation — SYNTHETIC golden cases (not a K110 accuracy figure)\n");
  console.log("category              gold  pred    tp   fp   fn  precision  recall     F1    FP-rate");
  for (const [k, m] of Object.entries(r.pooled)) {
    if (k === "offpageResolution") console.log(`${k.padEnd(20)} ${String(m.gold).padStart(5)}  —      correct ${m.correct}  wrongly-resolved ${m.wrongResolved}  missed ${m.missed}   accuracy ${pct(m.accuracy)}  false-resolution ${pct(m.falseResolutionRate)}`);
    else if (k === "falsePositiveRate") console.log(`${k.padEnd(20)} items read ${m.predicted}, not in gold ${m.fp}  →  ${pct(m.rate)}`);
    else console.log(`${k.padEnd(20)} ${String(m.gold).padStart(5)} ${String(m.predicted).padStart(5)} ${String(m.tp).padStart(5)} ${String(m.fp).padStart(4)} ${String(m.fn).padStart(4)}  ${pct(m.precision)}  ${pct(m.recall)} ${pct(m.f1)}   ${pct(m.falsePositiveRate)}`);
  }
  console.log("\nper case:"); for (const c of r.cases) console.log(`  ${c.name.padEnd(30)} [${c.tags.join(", ")}]  eq ${pct(c.m.equipmentTag.recall)}/${pct(c.m.equipmentTag.precision)}  line ${pct(c.m.lineNumber.recall)}/${pct(c.m.lineNumber.precision)}  instr ${pct(c.m.instrumentTag.recall)}/${pct(c.m.instrumentTag.precision)}`);
  const basePath = path.join(dir, "baseline.json");
  if (process.argv.includes("--update")) { writeFileSync(basePath, JSON.stringify(r.pooled, null, 1) + "\n"); console.log("\nbaseline written"); }
  if (process.argv.includes("--check")) {
    if (!existsSync(basePath)) { console.error("no baseline"); process.exit(1); }
    const base = JSON.parse(readFileSync(basePath, "utf8")); const bad = [];
    for (const [k, m] of Object.entries(r.pooled)) for (const f of ["precision", "recall", "accuracy"]) if (base[k]?.[f] != null && (m[f] ?? -1) < base[k][f] - 1e-9) bad.push(`${k}.${f} ${m[f]} < ${base[k][f]}`);
    for (const f of ["falsePositiveRate"]) if (base[f]?.rate != null && r.pooled[f].rate > base[f].rate + 1e-9) bad.push(`falsePositiveRate rose`);
    if (bad.length) { console.error("\nREGRESSION:\n  " + bad.join("\n  ")); process.exit(1); }
    console.log("\nP&ID EVAL PASSED — no category worse than the baseline.");
  }
}
