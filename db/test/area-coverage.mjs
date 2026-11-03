#!/usr/bin/env node
/**
 * Every write route of the API is classified (audit 2026-11-03): an area (lib/platform/areas.mjs API_AREAS), judged
 * per operation (PER_OPERATION_ROUTES), common with a written reason (COMMON_ROUTES) or reviewed on purpose with a reason
 * (REVIEWED_ROUTES). A route in none of them is open to every area by accident, so this test fails on it — the next
 * route someone adds cannot slip through as `null`.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { areaForPath, areaForNdtJoint, PER_OPERATION_ROUTES, COMMON_ROUTES, REVIEWED_ROUTES, AREAS } from "../../lib/platform/areas.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../app/api");
function routes(dir = ROOT, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) routes(p, out);
    else if (f === "route.js") out.push(p);
  }
  return out;
}
const WRITE = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/;
const writeRoutes = routes().filter((f) => WRITE.test(readFileSync(f, "utf8")))
  .map((f) => "/api" + path.dirname(f).slice(ROOT.length).split(path.sep).join("/")).sort();

const classify = (r) => areaForPath(r) ? "area" : r in PER_OPERATION_ROUTES ? "per-operation" : r in COMMON_ROUTES ? "common" : r in REVIEWED_ROUTES ? "reviewed" : null;

test("the walk finds the API's write routes", () => {
  assert(writeRoutes.length > 60, `found ${writeRoutes.length}`);
  for (const r of ["/api/runs", "/api/bom-allocations", "/api/iso-equipment", "/api/ndt-joints", "/api/field"]) assert(writeRoutes.includes(r), `${r} not found`);
});

test("every write route is classified: an area, per operation, common with a reason, or reviewed on purpose with a reason", () => {
  const loose = writeRoutes.filter((r) => !classify(r));
  equal(loose, [], `unclassified write routes — add each to API_AREAS, or to PER_OPERATION_ROUTES / COMMON_ROUTES / REVIEWED_ROUTES in lib/platform/areas.mjs: ${loose.join(", ")}`);
});

test("the registries hold no stale or double entries, and every common route has a reason", () => {
  for (const [name, reg] of [["PER_OPERATION_ROUTES", PER_OPERATION_ROUTES], ["COMMON_ROUTES", COMMON_ROUTES], ["REVIEWED_ROUTES", REVIEWED_ROUTES]]) {
    for (const [r, why] of Object.entries(reg)) {
      assert(writeRoutes.includes(r), `${name}: ${r} is not a write route of the API (stale entry)`);
      assert(String(why).trim().length > 2, `${name}: ${r} has no reason`);
      assert(!areaForPath(r), `${name}: ${r} also has an area — remove it from the registry`);
    }
  }
  const all = [...Object.keys(PER_OPERATION_ROUTES), ...Object.keys(COMMON_ROUTES), ...Object.keys(REVIEWED_ROUTES)];
  equal(all.filter((r, i) => all.indexOf(r) !== i), [], "a route is in two registries");
});

test("the isometric workspace's routes work in piping", () => {
  equal(["/api/bom-allocations", "/api/iso-equipment", "/api/read-local", "/api/registry-check", "/api/drawing-styles"].map(areaForPath), Array(5).fill("piping"));
});

test("an ndt-joints operation is judged by its own area: the matrix, register and welding are piping's, the examination and its draws quality's", () => {
  equal(["rule", "rule-remove", "joint", "weld"].map(areaForNdtJoint), Array(4).fill("piping"));
  equal(["ndt", "sample", "progressive"].map(areaForNdtJoint), Array(3).fill("quality"));
  equal(areaForNdtJoint("nonsense"), null, "an unknown kind is refused by the route before this");
  for (const a of ["piping", "quality"]) assert(a in AREAS);
});

await run();
