#!/usr/bin/env node
/**
 * Evaluation runner for the deterministic weld engine.
 *
 *   npm run eval                    run everything, print a report
 *   npm run eval:check              same, but exit non-zero on regression  (CI)
 *   npm run eval:update             re-record the baseline
 *   node --import ./eval/register.mjs eval/run.mjs --only SW-265022A
 *   ... --json eval/results/run.json
 *
 * The engine is deterministic, so this needs no API key, no GPU and no
 * network. That is the whole point: accuracy of the part that decides what
 * gets welded is measurable on every commit, for free.
 */
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "../lib/engine.js";
import { evaluateCase, aggregate } from "./lib/metrics.mjs";
import { printResults, printSummary, compareToBaseline, printGate } from "./lib/report.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(HERE, "cases");
const BASELINE = path.join(HERE, "baseline.json");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};

async function loadCases() {
  const cases = [];
  for (const kind of ["golden", "rules"]) {
    const dir = path.join(CASES_DIR, kind);
    if (!existsSync(dir)) continue;
    for (const file of (await readdir(dir)).sort()) {
      if (!file.endsWith(".json") || file.startsWith("_")) continue;
      const def = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      def.kind = def.kind || (kind === "golden" ? "golden" : "rule");
      def.id = def.id || path.basename(file, ".json");
      def.__file = path.relative(process.cwd(), path.join(dir, file));
      cases.push(def);
    }
  }
  return cases;
}

async function main() {
  let cases = await loadCases();
  const only = value("only");
  if (only) cases = cases.filter((c) => c.id.includes(only));
  if (!cases.length) {
    console.error("no cases found — did you point --only at something that exists?");
    process.exit(2);
  }

  const results = cases.map((def) => {
    let model;
    try {
      model = buildModel(def.input, def.options || {});
    } catch (e) {
      model = { error: `threw: ${e.message}` };
    }
    return { ...evaluateCase(def, model), file: def.__file };
  });

  const summary = aggregate(results);
  printResults(results);
  printSummary(summary);

  const run = {
    recordedAt: new Date().toISOString(),
    engine: "lib/engine.js",
    summary,
    cases: results.map((r) => ({
      id: r.id, kind: r.kind, status: r.status, file: r.file,
      failed: r.assertions.filter((a) => !a.ok).map((a) => a.name),
    })),
  };

  const jsonOut = value("json");
  if (jsonOut) {
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify(run, null, 2) + "\n");
    console.log(`\nwrote ${jsonOut}`);
  }

  if (flag("update-baseline")) {
    await writeFile(BASELINE, JSON.stringify(run, null, 2) + "\n");
    console.log(`\nbaseline recorded in ${path.relative(process.cwd(), BASELINE)}`);
    console.log("commit it — it is the reference every later run is judged against.");
    return;
  }

  if (flag("check")) {
    const baseline = existsSync(BASELINE)
      ? JSON.parse(await readFile(BASELINE, "utf8")) : null;
    const gate = compareToBaseline(summary, results, baseline);
    printGate(gate);
    if (gate.problems.length) process.exit(1);
  }

  // A plain run still fails on an outright broken case, so `npm run eval`
  // is useful on its own during development.
  if (summary.fail > 0 && !flag("check")) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
