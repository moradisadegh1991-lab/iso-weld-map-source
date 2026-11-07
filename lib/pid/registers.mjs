/**
 * The engineering registers of a P&ID draft, as VIEWS (pure): Equipment, Instrument Index, Line List, Valve List, Connectivity, Off-page.
 * They are derived on demand from the draft — never stored, never a second asset/tag/line/instrument registry (the asset spine stays the
 * only one). Every record carries its persistent uid, project, document and revision, page, printed reference, evidence, review status
 * and findings; asset links are PROPOSED here (link states from lib/db/repos/pid.mjs), never made.
 */
import { buildGraph } from "./graph.mjs";

const text = (v) => String(v ?? "").trim();

/**
 * @param {object} draft
 * @param {{ projectId?, documentId?, revisionId?, revision?, findings?: object[], links?: Object<string, object>, directory?, peers? }} ctx
 */
export function registers(draft, ctx = {}) {
  const items = draft?.items || [];
  const fin = new Map();
  for (const f of ctx.findings || []) if (f.entityUid) fin.set(f.entityUid, [...(fin.get(f.entityUid) || []), { code: f.code, severity: f.severity }]);
  const base = (i) => ({ uid: i.uid, projectId: ctx.projectId || null, documentId: ctx.documentId || null, revisionId: ctx.revisionId || ctx.documentId || null, revision: ctx.revision ?? draft?.meta?.revision ?? null,
    page: i.page, tag: i.tag, printed: i.printed, symbol: i.symbol, status: i.review?.status || "extracted", confidence: i.confidence, evidence: i.evidence || [], bbox: i.bbox, center: i.center,
    findings: fin.get(i.uid) || [], link: ctx.links?.[i.uid] || null });
  const g = buildGraph(draft, { directory: ctx.directory || [], peers: ctx.peers || {} });
  const nameOf = new Map(items.map((i) => [i.uid, i.tag || i.printed || `${i.cls}`]));
  const connections = (uid) => g.edges.filter((e) => e.from === uid || e.to === uid).map((e) => ({ edge: e.uid, type: e.type, other: e.from === uid ? e.to : e.from, otherTag: nameOf.get(e.from === uid ? e.to : e.from) || null }));
  const cls = (c) => items.filter((i) => i.cls === c);
  return {
    equipment: cls("equipment").map((i) => ({ ...base(i), equipmentType: i.symbol, legendType: i.attrs?.legendType || null, nozzles: i.attrs?.nozzles || [], connections: connections(i.uid) })),
    instruments: cls("instrument").map((i) => ({ ...base(i), letters: i.attrs?.letters ?? null, loop: i.attrs?.loop ?? null, category: i.attrs?.category ?? null, connections: connections(i.uid) })),
    lines: cls("line").map((i) => ({ ...base(i), lineNo: i.attrs?.lineNo ?? i.tag, size: i.attrs?.size ?? null, pipingClass: i.attrs?.pipingClass ?? null, fluid: i.attrs?.fluid ?? null, service: i.attrs?.service ?? null,
      insulation: i.attrs?.insulation ?? null, trace: i.attrs?.trace ?? null, design: i.attrs?.design ?? null, operating: i.attrs?.operating ?? null, flow: i.attrs?.flow ?? null, connections: connections(i.uid) })),
    valves: [...cls("valve"), ...cls("inline")].map((i) => ({ ...base(i), valveType: i.symbol, size: i.attrs?.size ?? null, lineUid: i.attrs?.lineUid ?? null, connections: connections(i.uid) })),
    connectivity: g.edges.map((e) => ({ uid: e.uid, projectId: ctx.projectId || null, documentId: ctx.documentId || null, revision: ctx.revision ?? draft?.meta?.revision ?? null, type: e.type, from: e.from, fromTag: nameOf.get(e.from) || null,
      to: e.to, toTag: e.to ? nameOf.get(e.to) || null : null, status: e.review?.status || "extracted", edgeStatus: e.status, evidence: e.evidence, findings: fin.get(e.uid) || [] })),
    offpage: g.offpage.map((o) => ({ uid: o.from, projectId: ctx.projectId || null, documentId: ctx.documentId || null, revision: ctx.revision ?? draft?.meta?.revision ?? null, page: items.find((i) => i.uid === o.from)?.page ?? null,
      ref: o.ref, status: o.status, why: o.why, candidates: o.candidates || [], toRef: o.toRef || null, evidence: o.evidence || [], reviewStatus: items.find((i) => i.uid === o.from)?.review?.status || "extracted", findings: fin.get(o.from) || [] })),
  };
}
