/**
 * Merge the two extraction passes into one payload.
 *
 * The passes run in parallel and either may fail on its own, so this has to
 * cope with half an answer: a partial extraction that the engineer can finish
 * by hand beats a dead end, which is why nothing here throws on a missing
 * half.
 *
 * Nothing a pass returned is dropped (architecture review, 2026-11-01). The
 * merge used to rebuild the payload from six named fields, so the CUT PIPE
 * LENGTH table the meta pass reads — the sharpest check the engine has
 * (lib/register/cut-list.mjs reads `data.cutLengths`) — never reached the
 * engine on a model run, and neither did the line data or any field a pass
 * grows later. Now:
 *
 *   meta          both passes' meta, the meta pass first; the line's size is the
 *                 nodes pass's when it gave one;
 *   bom           the meta pass's (the nodes pass is not asked for it; used if the
 *                 meta pass gave none);
 *   nodes, edges  the nodes pass's (the meta pass's if the nodes pass gave none);
 *   cutLengths,
 *   lineData      the meta pass's table (the pass asked to read it), else the nodes pass's;
 *   notes,
 *   unreadable    both passes', in order;
 *   anything else every other field of both passes, the nodes pass's value only
 *                 where it has one.
 *
 * Geometry is never inferred or repaired here: a missing list stays empty.
 */
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v : []);
const has = (v) => v !== undefined && v !== null;

export function mergePasses(metaPass, nodesPass) {
  const a = obj(metaPass?.data);
  const b = obj(nodesPass?.data);
  const out = { ...a };
  // every other field of the second pass, where it has a value
  for (const [k, v] of Object.entries(b)) if (has(v)) out[k] = v;

  out.meta = { ...obj(a.meta), ...obj(b.meta), nps: b.nps ?? b.meta?.nps ?? a.meta?.nps ?? a.nps };
  out.bom = list(a.bom).length ? a.bom : list(b.bom);
  out.nodes = list(b.nodes).length ? b.nodes : list(a.nodes);
  out.edges = list(b.edges).length ? b.edges : list(a.edges);
  out.notes = [...list(a.notes), ...list(b.notes)];
  out.unreadable = [...list(a.unreadable), ...list(b.unreadable)];
  const cuts = list(a.cutLengths).length ? a.cutLengths : list(b.cutLengths);
  out.cutLengths = cuts;
  const line = has(a.lineData) ? a.lineData : b.lineData;
  if (has(line)) out.lineData = line;
  else delete out.lineData;
  // the nodes pass's size sits in meta.nps now; the payload has always carried it there only
  delete out.nps;
  return out;
}
