/**
 * The P&ID connectivity graph (pure). Nodes are the draft's items; edges are ONLY what a reader/person stated with evidence:
 * process lines, instrument signals, control and mechanical relationships, off-page continuations. Proximity of two symbols and similarity of
 * two printed numbers never make an edge. An off-page connector is `resolved` ONLY when the target drawing's own draft is available and holds
 * exactly one compatible reciprocal connector (same line reference when the source names one). A drawing that merely exists in the
 * directory proves nothing: with no peer draft the connector is `unconfirmed`. Otherwise `unresolved` (no such drawing), `ambiguous`
 * (several compatible connectors) or `unconfirmed` (no compatible reciprocal), for a person.
 */
import { EDGE_TYPES } from "./vocab.mjs";

const text = (v) => String(v ?? "").trim();
const normDoc = (s) => text(s).toUpperCase().replace(/[\s_]+/g, "");
/** A line reference compared as printed, with whitespace and case ignored — and nothing else: two different line numbers are never "the same line". */
const normLine = (s) => text(s).toUpperCase().replace(/\s+/g, "");

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
  // Off-page results add NO adjacency: the far end is an item of another drawing's draft, not a node here, and an unconfirmed
  // continuation must never read as engineering connectivity. They are reported in `offpage` only.
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
    if (!peer) { out.push({ ...base, status: "unconfirmed", toRef: { docNo: target }, toUid: null, why: "the target drawing exists but its draft has not been read: the far end is unconfirmed" }); continue; }
    // the far end must point back at this drawing; when this connector names a line, the far connector must name the SAME line (no fallback)
    const backAll = (peer.items || []).filter((i) => i.cls === "connector" && normDoc(i.attrs?.targetSheet) === here);
    const myLine = normLine(c.attrs?.lineRef);
    const back = myLine ? backAll.filter((b) => normLine(b.attrs?.lineRef) === myLine) : backAll;
    if (back.length === 1) out.push({ ...base, status: "resolved", toRef: { docNo: target, uid: back[0].uid }, toUid: null, why: myLine ? "one connector on the target points back with the same line reference" : "one connector on the target points back" });
    else if (back.length === 0) out.push({ ...base, status: "unconfirmed", toRef: { docNo: target }, toUid: null, why: myLine && backAll.length ? `the target has ${backAll.length} connector(s) pointing back, none with the line reference «${text(c.attrs?.lineRef)}»` : "the target drawing does not point back at this one" });
    else out.push({ ...base, status: "ambiguous", toRef: { docNo: target }, toUid: null, candidates: back.map((b) => b.uid), why: `${back.length} connectors on the target point back${myLine ? " with the same line reference" : ""}` });
  }
  return out;
}

/** The entities directly connected to one item (by stated edges), for highlighting. */
export function connectedTo(graph, uid) {
  return [...new Set(graph.adjacency.get(uid) || [])];
}
