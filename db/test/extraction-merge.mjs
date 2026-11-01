#!/usr/bin/env node
/**
 * The merge of the two extraction passes (lib/extraction/merge.mjs; the
 * architecture review of 2026-11-01): nothing either pass returned is
 * dropped — above all the CUT PIPE LENGTH table the meta pass reads, which
 * the engine's cut list checks against (lib/register/cut-list.mjs) and which
 * the merge used to leave out.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { mergePasses } from "../../lib/extraction/merge.mjs";
import { buildModel } from "../../lib/engine.js";
import { cutList } from "../../lib/register/cut-list.mjs";

const meta = { data: {
  meta: { drawingNo: "ISO-01", pipingClass: "A1", nps: 6 }, bom: [{ pt: 1, diam: 6 }],
  lineData: { lineClass: "A1" }, cutLengths: [{ piece: 1, lengthMm: 3000, nps: 6 }],
  customMetaEvidence: { source: "title-block" }, notes: ["meta note"], unreadable: ["u1"] } };
const nodes = { data: {
  nps: 6,
  nodes: [{ id: "N1", type: "tie-in", E: 0, N: 0, EL: 0 }, { id: "N2", type: "tie-in", E: 3000, N: 0, EL: 0 }],
  edges: [{ from: "N1", to: "N2", nps: 6 }],
  customGeometryEvidence: { confidence: 0.9 }, notes: ["geometry note"], unreadable: ["u2"] } };

test("every field of both passes survives: cutLengths, lineData, notes, unreadable and extension fields", () => {
  const m = mergePasses(meta, nodes);
  equal(m.cutLengths, [{ piece: 1, lengthMm: 3000, nps: 6 }]);
  equal(m.lineData, { lineClass: "A1" });
  equal(m.customMetaEvidence, { source: "title-block" });
  equal(m.customGeometryEvidence, { confidence: 0.9 });
  equal(m.notes, ["meta note", "geometry note"]);
  equal(m.unreadable, ["u1", "u2"]);
  equal([m.meta.drawingNo, m.meta.pipingClass, m.meta.nps], ["ISO-01", "A1", 6]);
  equal(m.nodes.length, 2);
  equal(m.edges, [{ from: "N1", to: "N2", nps: 6 }]);
  equal(m.bom, [{ pt: 1, diam: 6 }]);
});

test("a branch keeps its own size, and the merge never touches an edge", () => {
  const m = mergePasses(meta, { data: { nps: 12, nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
    edges: [{ from: "A", to: "B", nps: 12 }, { from: "B", to: "C", nps: 8 }] } });
  equal(m.edges.map((e) => e.nps), [12, 8]);
  equal(m.meta.nps, 12, "the nodes pass's line size");
});

test("neither input is changed", () => {
  const a = structuredClone(meta), b = structuredClone(nodes);
  mergePasses(a, b);
  equal(a, meta);
  equal(b, nodes);
});

test("either pass failing, or both: a partial answer, never a throw, and no geometry made up", () => {
  const g = mergePasses(null, nodes);
  equal([g.nodes.length, g.bom, g.cutLengths, "lineData" in g], [2, [], [], false]);
  const a = mergePasses(meta, null);
  equal([a.nodes, a.edges, a.meta.drawingNo, a.cutLengths.length, a.bom.length], [[], [], "ISO-01", 1, 1]);
  const none = mergePasses(null, null);
  equal([none.nodes, none.edges, none.bom, none.cutLengths, none.notes, none.unreadable], [[], [], [], [], [], []]);
  equal(mergePasses({ data: "bad" }, { data: [1] }).nodes, []);
});

test("a nodes pass that returned null for a field does not blank the meta pass's", () => {
  const m = mergePasses(meta, { data: { ...nodes.data, meta: { drawingNo: null }, lineData: null, cutLengths: [] } });
  equal(m.lineData, { lineClass: "A1" });
  equal(m.cutLengths.length, 1);
});

test("the printed cut table reaches the engine's cut list on a merged model run", () => {
  const m = mergePasses(meta, nodes);
  const model = buildModel(m, {});
  assert(!model.error, model.error);
  const cl = cutList(model, m);
  assert(cl.rows.some((r) => r.printed), "the printed piece <1> is matched to a computed piece");
  // with the table dropped (what the old merge did), nothing is printed to check against
  const dropped = cutList(model, { ...m, cutLengths: [] });
  assert(!dropped.rows.some((r) => r.printed));
});

await run();
