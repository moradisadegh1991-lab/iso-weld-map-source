#!/usr/bin/env node
/**
 * The welds a sheet's BOM implies (lib/register/bom-welds.mjs) against the
 * contractor's register, on the golden sheets — the BOM as the no-model
 * reader read it off each sheet (its quantities: the golden MTO carries
 * none), from the reader's cache that `npm run eval:reader` writes.
 *
 *   node --import ./tools/register.mjs eval/bom-welds-report.mjs [--cache eval/results/reader]
 *
 * A sheet is counted only when its BOM was read whole: every PT number from
 * 1 to the last, every quantity, every row's ends said by its description.
 * The others are listed with what is missing. On a counted sheet: the BOM's
 * welded ends against the register's welds (threaded joints apart), and
 * size by size where they differ.
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { compareBomWelds } from "../lib/register/bom-welds.mjs";

const argv = process.argv.slice(2);
const value = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const CACHE = value("cache", "eval/results/reader");
const G = "eval/cases/golden";

let read = 0, whole = 0, same = 0, within3 = 0;
const lines = [], partial = [], kinds = {};
for (const f of (await readdir(G)).filter((f) => f.endsWith(".json")).sort()) {
  const c = JSON.parse(await readFile(path.join(G, f), "utf8"));
  const reg = c.expect?.register;
  if (!reg?.length || !c.drawing) continue;
  const cache = path.join(CACHE, path.basename(c.drawing).replace(/\.pdf$/i, ".json"));
  if (!existsSync(cache)) continue;
  const r = JSON.parse(await readFile(cache, "utf8"));
  if (!r.bom?.length) continue;
  read++;
  const cmp = compareBomWelds(r.bom, reg);
  const name = f.replace(/^HDPE-|\.json$/g, "");
  if (!cmp.complete) {
    partial.push(`${name}: ${[cmp.missingPts.length && `PT ${cmp.missingPts.join(",")} not read`, cmp.noQty.length && `quantity of PT ${cmp.noQty.map((x) => x.pt).join(",")} not read`,
      cmp.unclassified.length && `${cmp.unclassified.length} row(s) whose ends are not said`].filter(Boolean).join("; ")}`);
    continue;
  }
  whole++;
  const d = cmp.total - cmp.weldCount;
  if (d === 0) same++;
  if (Math.abs(d) <= 3) within3++;
  const thd = reg.filter((w) => String(w.kind).toUpperCase() === "THD").length;
  const off = cmp.rows.filter((x) => x.bomEnds !== x.welds && x.kind !== "THD").map((x) => `${x.size ?? "?"}" ${x.kind} ${x.bomEnds}/${x.welds}`);
  lines.push(`${d === 0 ? "=" : " "} ${name.padEnd(16)} welded ends ${String(cmp.total).padStart(3)}  register welds ${String(cmp.weldCount).padStart(3)}  threaded ${cmp.threaded}/${thd}${off.length ? "   " + off.join(" · ") : ""}`);
  for (const x of cmp.rows) { kinds[x.kind] ??= [0, 0]; kinds[x.kind][0] += x.bomEnds; kinds[x.kind][1] += x.welds; }
}
for (const l of lines) console.log(l);
console.log(`\nBOM read whole on ${whole} of ${read} sheets (the others below). On those: the BOM's welded ends equal the register's welds on ${same}, within 3 on ${within3}.`);
console.log(`By kind, ends / register: ${Object.entries(kinds).map(([k, [e, w]]) => `${k} ${e}/${w}`).join(" · ")}`);
console.log("(more ends than welds: two fittings welded to each other share one; more welds than ends: pipe welded to pipe, a joint to the next sheet, or a socket the BOM does not hold)");
console.log("\nNot counted:");
for (const p of partial) console.log(`  ${p}`);
