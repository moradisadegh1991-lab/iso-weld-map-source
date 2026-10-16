#!/usr/bin/env node
/**
 * How good is the EXTRACTION, measured without waiting for anyone.
 *
 *   npm run extraction:report -- <folder of extraction JSONs>
 *
 * WHY THIS EXISTS
 *
 * The engine's accuracy is proven — twenty-six eval cases say so. The
 * extraction's is not, and the obvious instrument for it, a contractor's
 * weld register, has to be asked for and waited on. Meanwhile nothing can
 * be improved, because an improvement you cannot measure is a guess.
 *
 * But the drawing carries its own ground truth. The title block prints a
 * centreline length; the BOM prints quantities; many sheets print a CUT
 * PIPE LENGTH table. Those are read by the `meta` pass. The node
 * coordinates are read by the `nodes` pass. They are INDEPENDENT readings
 * of the same physical line, so comparing them is a real test, not a
 * circular one: a misread coordinate moves the computed length away from
 * the printed one.
 *
 * WHAT THIS DOES AND DOES NOT PROVE
 *
 * It measures CONSISTENCY, not correctness. A model that misreads the title
 * block AND the coordinates in mutually compatible ways would pass — that is
 * unlikely, but it is not impossible, and it is the reason this does not
 * replace the contractor's register. It covers geometry and quantity; it
 * says nothing about whether a weld is Field or Shop, which only the
 * register can settle.
 *
 * Treat the number it prints as a floor on the error rate, never a ceiling.
 */
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { buildModel } from "../lib/engine.js";

/** One drawing's worth of signals. */
export function scoreOne(data) {
  const out = { drawing: data?.meta?.drawingNo || "(unnamed)", failures: [] };

  // The routing itself. An empty edge list means the nodes pass produced no
  // path at all — the engine can sometimes recover a two-node run, but on a
  // sheet with bends the route is simply gone.
  out.nodes = (data.nodes || []).length;
  out.edges = (data.edges || []).length;
  if (out.nodes >= 2 && out.edges === 0) out.failures.push("no-edges");

  // Anything the model itself admitted it could not read.
  out.unreadable = (data.unreadable || []).length;
  if (out.unreadable) out.failures.push("unreadable");

  let model;
  try { model = buildModel(data, { strictBom: true }); }
  catch (e) { out.failures.push("engine-threw"); out.error = e.message; return out; }
  if (model.error) { out.failures.push("engine-error"); out.error = model.error; return out; }

  out.welds = model.totals?.welds ?? 0;
  out.spools = model.spoolIds?.length ?? 0;

  // The cross-checks, by label rather than by position: the engine may add
  // or reorder them, and a report keyed on index would quietly go wrong.
  out.checks = {};
  for (const c of model.checks || []) {
    out.checks[c.label] = c.status;
    if (c.status === "warn") out.failures.push(c.label);
  }
  return out;
}

/** Aggregate over a set of drawings. */
export function summarise(rows) {
  const n = rows.length;
  const byFailure = {};
  for (const r of rows) {
    for (const f of new Set(r.failures)) byFailure[f] = (byFailure[f] || 0) + 1;
  }
  const clean = rows.filter((r) => r.failures.length === 0).length;
  return {
    drawings: n,
    clean,
    // The headline: the share of sheets that came out of extraction with
    // nothing for an engineer to reconcile.
    cleanRate: n ? clean / n : null,
    byFailure,
  };
}

/* ── the command ──────────────────────────────────────────────────────────
   Guarded so the scoring functions above can be imported and tested: without
   this, importing the module runs the CLI, which exits for want of an
   argument and takes the test suite with it. */
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: npm run extraction:report -- <folder of extraction JSONs>");
    process.exit(2);
  }
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) { console.error(`no .json files in ${dir}`); process.exit(2); }

  const rows = [];
  for (const f of files) {
    const raw = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    // Accept either a bare extraction payload or a saved golden case.
    rows.push(scoreOne(raw.input || raw));
  }

  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log("\nدقت استخراج — در برابر اعداد چاپ‌شدهٔ خود نقشه\n");
  console.log(pad("نقشه", 34), pad("گره", 5), pad("یال", 5), pad("جوش", 5), "مشکل");
  console.log("─".repeat(78));
  for (const r of rows) {
    console.log(pad(r.drawing, 34), pad(r.nodes, 5), pad(r.edges, 5), pad(r.welds ?? "-", 5),
      r.failures.length ? r.failures.join("، ") : "—");
  }

  const s = summarise(rows);
  console.log("\n" + "─".repeat(78));
  console.log(`${s.drawings} نقشه · ${s.clean} بدون ایراد · ` +
    `${s.cleanRate == null ? "—" : Math.round(s.cleanRate * 100) + "%"}`);
  if (Object.keys(s.byFailure).length) {
    console.log("\nتفکیک ایرادها (چند نقشه هر کدام):");
    for (const [k, v] of Object.entries(s.byFailure).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(3)} × ${k}`);
    }
  }
  console.log(
    "\nاین عدد «سازگاری» را می‌سنجد نه «درستی» را — کفِ نرخ خطا، نه سقف آن.\n" +
    "محل جوش (Field/Shop) فقط با رجیستر پیمانکار سنجیده می‌شود.\n");
}
