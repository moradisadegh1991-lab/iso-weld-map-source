/**
 * The P&ID connectivity graph (pure). Nodes are the draft's items; edges are ONLY what a reader/person stated with evidence:
 * process lines, instrument signals, control and mechanical relationships, off-page continuations. Proximity of two symbols and similarity of
 * two printed numbers never make an edge. An off-page connector is resolved only when exactly one compatible reference exists; otherwise it
 * stays `unresolved` (nothing to point at) or `ambiguous` (several), for a person.
 */
import { EDGE_TYPES } from "./draft.mjs";

const text = (v) => String(v ?? "").trim();
const normDoc = (s) => text(s).toUpperCase().replace(/[\s_]+/g, "");

/**
 * @param {object} draft
 * @param {{ directory?: Array<{docNo: string}>, peers?: Object<string, object> }} ctx
 *    directory  the project's known drawings (so "21-10-15" can be a drawing that exists)
 *    peers      other drafts of the same project by docNo (to check the far end points back)
 * @returns {{ nodes, edges, offpage, adjacency: Map<string, string[]>, invalid: object[] }}
 */
export function buildGraph(draft, { directory = [], peers = {} } = {}) {
  const items = Array.isArray(draft?.items) ? draft.items : [];
  const byUid = new Map(items.map((i) => [i.uid, i]));
  const edges = [], invalid = [];
  for (const e of Array.isArray(draft?.edges) ? draft.edges : []) {
    const why = !EDGE_TYPES.includes(e.type) ? "unknown edge type" : !byUid.has(e.from) ? "start is not an item" : e.to != null && !byUid.has(e.to) ? "end is not an item"
      : !(Array.isArray(e.evidence) && e.evidence.length) ? "no evidence" : null;
    if (why) { invalid.push({ uid: e.uid, why }); continue; }
    edges.push({ ...e });
  }
  const offpage = resolveOffpage(draft, { directory, peers });
  const adjacency = new Map(items.map((i) => [i.uid, []]));
  for (const e of edges) { if (e.to) { adjacency.get(e.from)?.push(e.to); adjacency.get(e.to)?.push(e.from); } }
  for (const o of offpage) if (o.status === "resolved" && o.toUid) { adjacency.get(o.from)?.push(o.toUid); }
  return { nodes: items.map((i) => ({ uid: i.uid, cls: i.cls, tag: i.tag })), edges, offpage, adjacency, invalid };
}

/** Each off-page connector of the draft: resolved | unconfirmed | unresolved | ambiguous, with why. */
export function resolveOffpage(draft, { directory = [], peers = {} } = {}) {
  const here = normDoc(draft?.meta?.drawingNo);
  const known = directory.map((d) => normDoc(d.docNo)).filter(Boolean);
  const out = [];
  for (const c of (draft?.items || []).filter((i) => i.cls === "connector")) {
    const target = normDoc(c.attrs?.targetSheet);
    const base = { uid: `off:${c.uid}`, from: c.uid, type: "offpage", ref: text(c.attrs?.targetSheet) || null, evidence: c.evidence };
    if (!target) { out.push({ ...base, status: "unresolved", why: "the connector prints no target sheet" }); continue; }
    const hits = known.filter((k) => k === target);
    if (hits.length === 0) { out.push({ ...base, status: "unresolved", why: "no drawing of this project has that number" }); continue; }
    if (hits.length > 1) { out.push({ ...base, status: "ambiguous", why: "several drawings carry that number" }); continue; }
    const peer = peers[directory.find((d) => normDoc(d.docNo) === target)?.docNo] || null;
    if (!peer) { out.push({ ...base, status: "resolved", toRef: { docNo: target }, toUid: null, why: "the target drawing exists (its content was not read here)" }); continue; }
    // the far end must point back at this drawing; where both connectors name a line, it must be the same line
    let back = (peer.items || []).filter((i) => i.cls === "connector" && normDoc(i.attrs?.targetSheet) === here);
    const myLine = text(c.attrs?.lineRef);
    if (myLine) { const same = back.filter((b) => text(b.attrs?.lineRef) === myLine); if (same.length) back = same; }
    if (back.length === 1) out.push({ ...base, status: "resolved", toRef: { docNo: target, uid: back[0].uid }, toUid: null, why: "one connector on the target points back" });
    else if (back.length === 0) out.push({ ...base, status: "unconfirmed", toRef: { docNo: target }, toUid: null, why: "the target drawing does not point back at this one" });
    else out.push({ ...base, status: "ambiguous", toRef: { docNo: target }, toUid: null, candidates: back.map((b) => b.uid), why: `${back.length} connectors on the target point back` });
  }
  return out;
}

/** The entities directly connected to one item (by stated edges), for highlighting. */
export function connectedTo(graph, uid) {
  return [...new Set(graph.adjacency.get(uid) || [])];
}
