#!/usr/bin/env node
/**
 * The cut list (lib/register/cut-list.mjs): every piece the shop saws, from
 * the engine's model, paired with the drawing's own CUT PIPE LENGTH table
 * by the engine's tolerance — on the eval cases whose numbers were checked
 * against the drawing (R22 matches, R23 does not).
 */
import { test, run, assert, equal } from "./harness.mjs";
import { readFile } from "node:fs/promises";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { cutList } from "../../lib/register/cut-list.mjs";

const load = async (f) => JSON.parse(await readFile(new URL(`../../eval/cases/rules/${f}.json`, import.meta.url), "utf8"));

test("every pipe and pup of the model, in spool order, with the welds at its two ends", async () => {
  const m = buildModel(DEMO);
  const c = cutList(m, DEMO);
  const pieces = m.elements.filter((e) => e.kind === "pipe" || e.kind === "pup");
  equal(c.rows.length, pieces.length);
  equal(c.total, c.rows.reduce((s, r) => s + r.lengthMm, 0));
  assert(Math.abs(c.total - (m.totals.pipeLen + m.totals.pupLen)) <= c.rows.length, "the pieces add up to the model's pipe and pups (rounded to the mm)");
  const nos = new Set(m.register.map((w) => w.no));
  for (const r of c.rows) assert(nos.has(r.endA) && nos.has(r.endB) && r.endA !== r.endB, `piece ${r.no}: ends ${r.endA} / ${r.endB}`);
  const spools = c.rows.map((r) => r.spool);
  equal(spools, [...spools].sort(), "grouped by spool");
  equal(c.bySpool.reduce((s, g) => s + g.lengthMm, 0), c.total);
  equal(c.printedCount, 0, "no printed table on this drawing: nothing paired, nothing claimed");
  assert(c.rows.every((r) => r.printed === null));
});

test("a printed cut length within tolerance is paired with its piece (R22)", async () => {
  const k = await load("R22-cut-length-check");
  const c = cutList(buildModel(k.input, k.options), k.input);
  equal(c.unmatchedPrinted, []);
  const paired = c.rows.filter((r) => r.printed);
  equal(paired.length, k.input.cutLengths.length);
  for (const r of paired) assert(Math.abs(r.lengthMm - r.printed.len) <= Math.max(5, r.printed.len * 0.005), `${r.lengthMm} ~ ${r.printed.len}`);
});

test("a printed cut length no piece matches is listed as such, not forced onto one (R23)", async () => {
  const k = await load("R23-cut-length-mismatch");
  const c = cutList(buildModel(k.input, k.options), k.input);
  equal(c.unmatchedPrinted.map((x) => x.len), k.input.cutLengths.map((x) => x.lengthMm));
  assert(c.rows.every((r) => r.printed === null), "the computed piece stays unpaired");
});

test("the line's schedule is given only to pieces of the line's size", async () => {
  const data = { ...DEMO, meta: { ...DEMO.meta, nps: 99 } };
  const c = cutList(buildModel(DEMO), data);
  assert(c.rows.length && c.rows.every((r) => r.schedule === ""), "another size: its schedule was not read, so none is shown");
  assert(cutList(buildModel(DEMO), DEMO).rows.every((r) => r.schedule === DEMO.meta.schedule));
});

test("no model, no list", async () => {
  equal(cutList({ error: "x" }, {}).rows, []);
  equal(cutList(null, {}).total, 0);
});

await run();
