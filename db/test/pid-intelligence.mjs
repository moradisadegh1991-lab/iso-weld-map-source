#!/usr/bin/env node
/**
 * Phase 11 — P&ID intelligence (docs/audit/phase-11-pid-intelligence.md). A reader PROPOSES; the deterministic engine normalizes, validates
 * and resolves; a person approves. Nothing is inferred (symbol from a tag, a size from a neighbour, a connection from proximity, an
 * off-page target from a similar number), nothing is approved by extraction, and no revision's identities are copied into another.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { isUid, newUid } from "../../lib/sheet/mark-identity.mjs";
import { sanitizeProposal, sanitizeItem, draftFromOcr, normBox, emptyDraft } from "../../lib/pid/draft.mjs";
import { buildGraph, resolveOffpage } from "../../lib/pid/graph.mjs";
import { applyReview, undecided, summary } from "../../lib/pid/review.mjs";
import { registers } from "../../lib/pid/registers.mjs";
import { comparePid, confirmMapping } from "../../lib/pid/compare.mjs";
import { validatePid } from "../../lib/engineering/validation.mjs";

const PAGE = { number: 1, width: 1000, height: 800 };
const box = (x, y, w = 60, h = 20) => [x, y, x + w, y + h];
const ocr = (t, b, c = 0.9) => ({ t, b, c });
const draftOf = (items, edges = [], meta = {}) => sanitizeProposal({ items, edges, meta }, { page: PAGE, meta: { drawingNo: "K110-30-PID-0021-10-01", revision: "1", ...meta }, source: { kind: "vision", reader: "test" } });
const byTag = (d, tag) => d.items.find((i) => i.tag === tag);
const codes = (r) => r.findings.map((f) => f.code);

// ── metadata / intake ─────────────────────────────────────────────────────

test("A1. metadata pass: the drawing's own fields are kept, the page's original size is kept, boxes are normalized", () => {
  const { draft } = draftOf([], [], { drawingNo: "K110-30-PID-0021-10-14", title: "FEED GAS", unit: "K110", area: "10", system: "FEED", sheet: "14", relatedDrawings: ["K110-30-PID-0021-10-15"], notes: ["NOTE 5"] });
  equal([draft.meta.drawingNo, draft.meta.title, draft.meta.sheet, draft.meta.relatedDrawings, draft.page], ["K110-30-PID-0021-10-14", "FEED GAS", "14", ["K110-30-PID-0021-10-15"], PAGE]);
  equal(normBox([100, 80, 300, 160], 1000, 800), { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.2 });
  equal(normBox([5, 5, 5, 9], 1000, 800), null, "a degenerate box is not a box");
});

// ── passes B–E: items from a reader's proposal ────────────────────────────

test("B1. equipment: tag, symbol and box from the proposal; a tag's letters NEVER give the symbol; an unnamed symbol stays UNKNOWN", () => {
  const { draft } = draftOf([
    { id: "a", cls: "equipment", symbol: "pump", tag: "30-P-1201A", bbox: box(100, 100), confidence: 0.92, evidence: [{ kind: "vision", text: "30 P 1201 A" }] },
    { id: "b", cls: "equipment", tag: "30-P-1202", bbox: box(300, 100), confidence: 0.8, evidence: [{ kind: "ocr", text: "30 P 1202" }] },
    { id: "c", cls: "equipment", symbol: "spaceship", tag: "30-E-1101", bbox: box(500, 100), evidence: [{ kind: "ocr", text: "30 E 1101" }] },
  ]);
  equal([byTag(draft, "30-P-1201A").symbol, byTag(draft, "30-P-1202").symbol, byTag(draft, "30-E-1101").symbol], ["pump", "UNKNOWN", "UNKNOWN"]);
  const p = byTag(draft, "30-P-1201A");
  assert(isUid(p.uid) && p.page === 1 && p.center.x > 0 && p.bbox.x1 > p.bbox.x0 && p.confidence === 0.92 && p.review.status === "extracted");
});

test("B2. a reader cannot approve: whatever review/status fields it sends, items are `extracted`; unknown classes are rejected with a reason", () => {
  const { draft, rejected } = draftOf([{ cls: "equipment", tag: "30-P-1", review: { status: "approved", by: "x" }, status: "approved", evidence: [{ text: "x" }] }, { cls: "nonsense", tag: "T" }]);
  equal(draft.items.map((i) => i.review), [{ status: "extracted" }]);
  equal(rejected.map((r) => r.why.includes("unknown class")), [true]);
});

test("C1. instruments: ISA letters from the tag, loop number kept; an invalid function is a finding, no tag is invented", () => {
  const { draft } = draftOf([
    { cls: "instrument", symbol: "bubble", tag: "PT-110101", bbox: box(100, 300), evidence: [{ text: "PT 110101" }], attrs: { letters: "PT", loop: "P-110101" } },
    { cls: "instrument", symbol: "bubble", tag: "ZZ-1", bbox: box(200, 300), evidence: [{ text: "ZZ 1" }] },
    { cls: "instrument", symbol: "bubble", tag: null, bbox: box(300, 300), evidence: [{ text: "??" }] },
  ]);
  const r = validatePid({ draft });
  assert(codes(r).includes("P_INSTR_INVALID_FUNCTION") && codes(r).includes("P_INSTR_NO_TAG"));
  equal(draft.items.filter((i) => i.tag === null).length, 1, "the missing tag stays missing");
  assert(!r.findings.some((f) => f.code === "P_INSTR_INVALID_FUNCTION" && f.entityNumber === "PT-110101"));
});

test("D1. lines: size/class/fluid kept as printed; nothing is inferred from a neighbouring line; missing spec is `missing`, a bad one an `error`", () => {
  const { draft } = draftOf([
    { cls: "line", symbol: "process-line", tag: "MP140001A", bbox: box(100, 400), evidence: [{ text: '4" MP140001A-EA01-H' }], attrs: { lineNo: "MP140001A", size: 4, pipingClass: "EA01", fluid: "MP" } },
    { cls: "line", symbol: "process-line", tag: "MP140002A", bbox: box(100, 450), evidence: [{ text: "MP140002A" }], attrs: { lineNo: "MP140002A" } },
    { cls: "line", symbol: "process-line", tag: "MP140003A", bbox: box(100, 500), evidence: [{ text: "x" }], attrs: { lineNo: "MP140003A", size: 0, pipingClass: "bad class" } },
  ]);
  const r = validatePid({ draft });
  const f = (c, t) => r.findings.find((x) => x.code === c && x.entityNumber === t);
  assert(f("P_LINE_SPEC_MISSING", "MP140002A") && f("P_LINE_SPEC_MISSING", "MP140002A").detail.nature === "missing" && f("P_LINE_SPEC_MISSING", "MP140002A").severity === "info");
  assert(f("P_LINE_SPEC_INVALID", "MP140003A") && f("P_LINE_SPEC_INVALID", "MP140003A").detail.nature === "error" && f("P_LINE_SPEC_INVALID", "MP140003A").severity === "error");
  equal(byTag(draft, "MP140002A").attrs.size, undefined, "the size of the line above was not lent to it");
});

test("D2. the same line number with a different size/class on one sheet is a contradiction; the same spec printed twice is not", () => {
  const L = (size, cls, y) => ({ cls: "line", symbol: "process-line", tag: "MP140001A", bbox: box(100, y), evidence: [{ text: "l" }], attrs: { lineNo: "MP140001A", size, pipingClass: cls } });
  assert(codes(validatePid({ draft: draftOf([L(4, "EA01", 400), L(6, "EA01", 450)]).draft })).includes("P_LINE_DUP_NUMBER"));
  assert(!codes(validatePid({ draft: draftOf([L(4, "EA01", 400), L(4, "EA01", 450)]).draft })).includes("P_LINE_DUP_NUMBER"));
});

test("E1. valves/inline components: type from the symbol only; UNKNOWN stays UNKNOWN and is reported as missing information", () => {
  const { draft } = draftOf([
    { cls: "valve", symbol: "gate-valve", tag: "HV-1001", bbox: box(100, 600), evidence: [{ text: "HV 1001" }], attrs: { size: 4, lineUid: null } },
    { cls: "valve", symbol: "mystery", tag: null, bbox: box(200, 600), evidence: [{ text: "?" }] },
    { cls: "inline", symbol: "orifice", tag: "FE-1", bbox: box(300, 600), evidence: [{ text: "FE" }] },
  ]);
  equal(draft.items.map((i) => i.symbol), ["gate-valve", "UNKNOWN", "orifice"]);
  const u = validatePid({ draft }).findings.filter((f) => f.code === "P_SYMBOL_UNKNOWN");
  equal([u.length, u[0].severity, u[0].detail.nature], [1, "info", "missing"]);
});

// ── pass F: connectivity ──────────────────────────────────────────────────

test("F1. an edge needs evidence and known endpoints; two symbols standing close together make NO edge", () => {
  const { draft, rejected } = draftOf([
    { id: "p", cls: "equipment", symbol: "pump", tag: "30-P-1201A", bbox: box(100, 100), evidence: [{ text: "p" }] },
    { id: "l", cls: "line", symbol: "process-line", tag: "MP140001A", bbox: box(100, 125), evidence: [{ text: "l" }], attrs: { lineNo: "MP140001A" } },    // right beside the pump
    { id: "v", cls: "valve", symbol: "gate-valve", tag: "HV-1", bbox: box(100, 150), evidence: [{ text: "v" }] },
  ], [
    { type: "process", from: "p", to: "l", evidence: [{ kind: "vision", text: "line leaves the pump discharge nozzle" }] },
    { type: "process", from: "l", to: "v" },                                         // no evidence
    { type: "process", from: "p", to: "ghost", evidence: [{ text: "x" }] },          // unknown endpoint
    { type: "wormhole", from: "p", to: "l", evidence: [{ text: "x" }] },
  ]);
  equal(draft.edges.length, 1); equal(rejected.map((r) => r.why).sort(), ["end is not an item of this proposal", "no evidence", "unknown edge type «wormhole»"]);
  const g = buildGraph(draft);
  equal(g.edges.length, 1);
  assert(!g.adjacency.get(byTag(draft, "HV-1").uid).length, "the valve beside the line is not connected to it");
  const e = draft.edges[0]; assert(e.evidence[0].text && e.status === "explicit" && e.review.status === "extracted");
});

test("F2. off-page connectors: resolved only on a UNIQUE known drawing; unknown → unresolved; a similar number is not a match; the far end must point back", () => {
  const conn = (ref, line) => ({ cls: "connector", symbol: "offpage", tag: null, bbox: box(800, 100), evidence: [{ text: ref }], attrs: { targetSheet: ref, lineRef: line } });
  const { draft } = draftOf([conn("K110-30-PID-0021-10-15", "MP140001A"), conn("K110-30-PID-0021-10-99"), conn("K110-30-PID-0021-10-16")]);
  const directory = [{ docNo: "K110-30-PID-0021-10-15" }, { docNo: "K110-30-PID-0021-10-16" }, { docNo: "K110-30-PID-0021-10-16" }];
  const peerBack = (n) => ({ meta: { drawingNo: "K110-30-PID-0021-10-15" }, items: Array.from({ length: n }, () => ({ uid: newUid(), cls: "connector", attrs: { targetSheet: "K110-30-PID-0021-10-01", lineRef: "MP140001A" } })) });
  const st = (peers) => Object.fromEntries(resolveOffpage(draft, { directory, peers }).map((o) => [o.ref, o.status]));
  equal(st({}), { "K110-30-PID-0021-10-15": "resolved", "K110-30-PID-0021-10-99": "unresolved", "K110-30-PID-0021-10-16": "ambiguous" }, "10-99 is not 10-15; two drawings with one number are ambiguous");
  equal(st({ "K110-30-PID-0021-10-15": peerBack(0) })["K110-30-PID-0021-10-15"], "unconfirmed");
  equal(st({ "K110-30-PID-0021-10-15": peerBack(1) })["K110-30-PID-0021-10-15"], "resolved");
  equal(st({ "K110-30-PID-0021-10-15": peerBack(2) })["K110-30-PID-0021-10-15"], "ambiguous", "two connectors point back and the line does not tell them apart");
  const r = validatePid({ draft, directory });
  assert(codes(r).includes("P_OFFPAGE_UNRESOLVED") && codes(r).includes("P_CONN_AMBIGUOUS"));
});

test("F3. duplicate tags and ambiguous / unresolved edges are findings; equipment with no connection is only judged when connectivity was read", () => {
  const items = [
    { id: "a", cls: "equipment", symbol: "pump", tag: "30-P-1201A", bbox: box(100, 100), evidence: [{ text: "a" }] },
    { id: "b", cls: "equipment", symbol: "pump", tag: "30-P-1201A", bbox: box(300, 100), evidence: [{ text: "b" }] },
    { id: "c", cls: "equipment", symbol: "vessel", tag: "30-D-1101", bbox: box(500, 100), evidence: [{ text: "c" }] },
  ];
  const none = validatePid({ draft: draftOf(items).draft });
  assert(codes(none).includes("P_EQ_DUP_TAG") && !codes(none).includes("P_EQ_NO_CONNECTION"), "no connectivity read → no 'unconnected' judgement");
  const withEdge = draftOf(items, [{ type: "process", from: "a", to: null, evidence: [{ text: "line leaves a" }] }]).draft;
  const r = validatePid({ draft: withEdge });
  assert(codes(r).includes("P_EQ_NO_CONNECTION") && codes(r).includes("P_CONN_AMBIGUOUS"));
  const nc = r.findings.find((f) => f.code === "P_EQ_NO_CONNECTION"); equal([nc.severity, nc.detail.nature], ["info", "missing"]);
});

// ── validation: evidence, revision, finding shape ─────────────────────────

test("V1. missing evidence and records of another revision/page are findings; every finding has code, entity, document, revision, page, severity, evidence, explanation, action", () => {
  const { draft } = draftOf([
    { cls: "equipment", symbol: "pump", tag: "30-P-1", bbox: box(100, 100), evidence: [] },
    { cls: "equipment", symbol: "pump", tag: "30-P-2", bbox: box(200, 100), evidence: [{ text: "x" }], confidence: 0.4 },
  ]);
  draft.items[1].source = { kind: "vision", ref: "r", revision: "0" };
  draft.items[1].page = 7;
  const r = validatePid({ draft, revision: { documentId: "d1", docNo: "K110-30-PID-0021-10-01", rev: "1" } });
  assert(codes(r).includes("P_NO_EVIDENCE") && codes(r).includes("P_WRONG_REVISION") && codes(r).includes("P_LOW_CONFIDENCE"));
  for (const f of r.findings) assert(f.code && f.id && f.entityUid && f.revision.documentId === "d1" && f.revision.rev === "1" && "page" in f && f.severity && f.message && f.suggestedAction && "evidence" in f, JSON.stringify(f));
  equal(new Set(r.findings.map((f) => f.id)).size, r.findings.length);
});

test("V2. rejected items are not judged", () => {
  const { draft } = draftOf([{ cls: "equipment", symbol: "pump", tag: null, bbox: box(1, 1), evidence: [] }]);
  const rej = applyReview(draft, { uid: draft.items[0].uid, action: "reject", reason: "noise", by: "alice" }).draft;
  equal(validatePid({ draft: rej }).findings, []);
});

// ── review workflow ───────────────────────────────────────────────────────

const one = () => draftOf([{ cls: "equipment", symbol: "pump", tag: "30-P-1201A", bbox: box(100, 100), evidence: [{ text: "30 P 1201 A" }] }]).draft;

test("R1. correction keeps the ORIGINAL beside the corrected value (the first one, never overwritten) and yields audit edits", () => {
  let d = one(); const uid = d.items[0].uid;
  const a = applyReview(d, { uid, action: "correct", value: { tag: "30-P-1201B" }, by: "alice", at: "t1", reason: "misread" });
  equal([a.draft.items[0].tag, a.draft.items[0].review.status, a.draft.items[0].review.original, a.edits.map((e) => [e.field, e.before, e.after])], ["30-P-1201B", "corrected", { tag: "30-P-1201A" }, [["tag", "30-P-1201A", "30-P-1201B"]]]);
  const b = applyReview(a.draft, { uid, action: "correct", value: { tag: "30-P-1201C" }, by: "alice", at: "t2" });
  equal(b.draft.items[0].review.original, { tag: "30-P-1201A" }, "the extracted value is still the first one");
  equal(b.draft.items[0].review.corrected, { tag: "30-P-1201C" });
  equal(d.items[0].tag, "30-P-1201A", "the input draft is not mutated");
});

test("R2. approval is explicit, records who and when; an approved item cannot be corrected (new revision instead); reject needs a reason", () => {
  const d = one(), uid = d.items[0].uid;
  equal(d.items[0].review.status, "extracted");
  const ap = applyReview(d, { uid, action: "approve", by: "bob", at: "2026-11-07T10:00:00Z" }).draft;
  equal([ap.items[0].review.status, ap.items[0].review.by, ap.items[0].review.at], ["approved", "bob", "2026-11-07T10:00:00Z"]);
  let err; try { applyReview(ap, { uid, action: "correct", value: { tag: "X" }, by: "bob" }); } catch (e) { err = e; }
  equal([err.status, err.code], [409, "APPROVED_LOCKED"]);
  try { applyReview(d, { uid, action: "reject", by: "bob" }); } catch (e) { err = e; }
  equal(err.code, "REASON_REQUIRED");
  const rej = applyReview(d, { uid, action: "reject", reason: "not equipment", by: "bob" }).draft;
  equal(rej.items[0].review.status, "rejected");
  equal(applyReview(rej, { uid, action: "reopen", by: "bob" }).draft.items[0].review.status, "needs_review");
});

test("R3. an ambiguous / unresolved edge cannot be approved until resolved; a whole draft is signed off only when every record has been decided", () => {
  const d = draftOf([{ id: "a", cls: "equipment", symbol: "pump", tag: "30-P-1", bbox: box(1, 1), evidence: [{ text: "a" }] }], [{ type: "process", from: "a", to: null, evidence: [{ text: "x" }] }]).draft;
  let err; try { applyReview(d, { uid: d.edges[0].uid, action: "approve", by: "a" }); } catch (e) { err = e; }
  equal(err.code, "NEEDS_RESOLUTION");
  equal(undecided(d).length, 2);
  let x = applyReview(d, { uid: d.items[0].uid, action: "approve", by: "a" }).draft;
  x = applyReview(x, { uid: x.edges[0].uid, action: "reject", reason: "no second end", by: "a" }).draft;
  equal(undecided(x), []);
  equal(summary(x), { approved: 1, rejected: 1 });
});

// ── registers (views) ─────────────────────────────────────────────────────

test("G1. the six registers are derived views; every record carries uid, project, document, revision, page, tag, evidence, status and findings; asset links are proposed, never made", () => {
  const d = draftOf([
    { id: "p", cls: "equipment", symbol: "pump", tag: "30-P-1201A", bbox: box(100, 100), evidence: [{ text: "p" }] },
    { id: "i", cls: "instrument", symbol: "bubble", tag: "PT-110101", bbox: box(200, 100), evidence: [{ text: "i" }], attrs: { letters: "PT", loop: "P-110101" } },
    { id: "l", cls: "line", symbol: "process-line", tag: "MP140001A", bbox: box(300, 100), evidence: [{ text: "l" }], attrs: { lineNo: "MP140001A", size: 4, pipingClass: "EA01" } },
    { id: "v", cls: "valve", symbol: "gate-valve", tag: "HV-1", bbox: box(400, 100), evidence: [{ text: "v" }] },
    { id: "c", cls: "connector", symbol: "offpage", bbox: box(500, 100), evidence: [{ text: "x" }], attrs: { targetSheet: "K110-30-PID-0021-10-02" } },
  ], [{ type: "process", from: "p", to: "l", evidence: [{ text: "e" }] }]).draft;
  const draft = d;
  const v = validatePid({ draft });
  const R = registers(d, { projectId: "P", documentId: "D", revision: "1", findings: v.findings, links: { [d.items[0].uid]: { state: "unique", candidates: ["tag-1"] } } });
  equal([R.equipment.length, R.instruments.length, R.lines.length, R.valves.length, R.connectivity.length, R.offpage.length], [1, 1, 1, 1, 1, 1]);
  const e = R.equipment[0];
  assert(isUid(e.uid) && e.projectId === "P" && e.documentId === "D" && e.revision === "1" && e.page === 1 && e.tag === "30-P-1201A" && e.evidence.length && e.status === "extracted" && Array.isArray(e.findings));
  equal([e.link.state, e.connections.length, e.connections[0].otherTag], ["unique", 1, "MP140001A"]);
  equal(R.valves[0].valveType, "gate-valve"); equal(R.offpage[0].status, "unresolved");
});

// ── OCR adapter (the existing deterministic reader, with boxes kept) ──────

test("O1. the OCR adapter keeps the box of every label as evidence, reads tags (does not guess symbols), and does not drop the page size", () => {
  const items = [ocr("30-P-1201A", box(100, 100)), ocr('4" MP140001A-EA01-H', box(100, 200)), ocr("K110-30-PID-0021-10-15/1", box(800, 50)), ocr("noise", box(1, 1), 0.2)];
  const d = draftFromOcr({ page: 3, w: 1000, h: 800, items }, null, { meta: { drawingNo: "K110-30-PID-0021-10-03" } });
  assert(d.items.some((i) => i.cls === "equipment" && i.tag === "30-P-1201A" && i.symbol === "UNKNOWN" && i.bbox && i.evidence[0].kind === "ocr" && i.page === 3));
  const ln = d.items.find((i) => i.cls === "line");
  equal([ln.attrs.lineNo, ln.attrs.size, ln.attrs.pipingClass], ["MP140001A", 4, "EA01"]);
  assert(d.items.some((i) => i.cls === "connector" && i.attrs.targetSheet === "K110-30-PID-0021-10-15"));
  assert(!d.items.some((i) => i.ocrText === "noise"), "a low-confidence string is not read");
  equal(d.page, { number: 3, width: 1000, height: 800 });
  const again = draftFromOcr({ page: 3, w: 1000, h: 800, items }, null);
  equal(again.source.hash, d.source.hash, "the same reading hashes the same (retry-safe ingest)");
});

// ── revision comparison ───────────────────────────────────────────────────

const rev = (items, edges = []) => draftOf(items, edges).draft;
const EQ = (tag, x, extra = {}) => ({ cls: "equipment", symbol: "pump", tag, bbox: box(x, 100), evidence: [{ text: tag }], ...extra });
const LN = (no, size, cls, x) => ({ cls: "line", symbol: "process-line", tag: no, bbox: box(x, 300), evidence: [{ text: no }], attrs: { lineNo: no, size, pipingClass: cls } });

test("X1. revision comparison: added / removed / renumbered (explicit mapping) / changed line spec; a unique same tag is only a CANDIDATE; geometry and similar tags never pair", () => {
  const A = rev([EQ("30-P-1201A", 100), EQ("30-P-1202", 200), LN("MP140001A", 4, "EA01", 300), EQ("30-K-1", 600)]);
  const B = rev([EQ("30-P-1201A", 100), EQ("30-P-1203", 200), LN("MP140001A", 6, "EA01", 300), EQ("30-K-2", 600)]);
  const r = comparePid({ from: A, to: B });
  const kinds = r.changes.map((c) => `${c.kind}:${c.tag}`).sort();
  assert(kinds.includes("candidate:30-P-1201A") && kinds.includes("candidate:MP140001A"), kinds.join());
  assert(kinds.includes("removed:30-P-1202") && kinds.includes("added:30-P-1203") && kinds.includes("removed:30-K-1") && kinds.includes("added:30-K-2"), "same position/similar tag is not a match");
  equal(r.unresolved.length, 2);
  // explicit mappings (confirmed by a person) turn candidates / renumbering into identity
  let T = B;
  T = confirmMapping(T, A, { fromUid: byTag(A, "30-P-1202").uid, toUid: byTag(B, "30-P-1203").uid, by: "alice" });
  T = confirmMapping(T, A, { fromUid: byTag(A, "MP140001A").uid, toUid: byTag(B, "MP140001A").uid, by: "alice" });
  const m = comparePid({ from: A, to: T });
  const ren = m.changes.find((c) => c.kind === "renumbered"); equal([ren.fromUid, ren.toUid], [byTag(A, "30-P-1202").uid, byTag(B, "30-P-1203").uid]);
  const sp = m.changes.find((c) => c.kind === "changed" && c.tag === "MP140001A"); equal(sp.fields, [{ field: "size", from: 4, to: 6 }]);
  assert(!JSON.stringify(T.items).includes(byTag(A, "30-P-1202").uid), "no source uid in the target's items");
});

test("X2. mappings are one-to-one and class-checked; a target draft is never overwritten (pure); connectivity changes of mapped items are reported through the mapping", () => {
  const A = rev([{ id: "p", ...EQ("30-P-1", 100) }, { id: "l", ...LN("MP1", 4, "EA01", 300) }], [{ type: "process", from: "p", to: "l", evidence: [{ text: "e" }] }]);
  const B = rev([{ id: "p", ...EQ("30-P-1", 100) }, { id: "l", ...LN("MP1", 4, "EA01", 300) }, { id: "m", ...LN("MP2", 4, "EA01", 400) }], [{ type: "process", from: "p", to: "m", evidence: [{ text: "e" }] }]);
  const fa = (t) => byTag(A, t).uid, tb = (t) => byTag(B, t).uid;
  let T = confirmMapping(B, A, { fromUid: fa("30-P-1"), toUid: tb("30-P-1"), by: "a" });
  T = confirmMapping(T, A, { fromUid: fa("MP1"), toUid: tb("MP1"), by: "a" });
  let err; try { confirmMapping(T, A, { fromUid: fa("MP1"), toUid: tb("MP2"), by: "a" }); } catch (e) { err = e; }
  equal(err.code, "INVALID_MAPPING");
  try { confirmMapping(B, A, { fromUid: fa("30-P-1"), toUid: tb("MP1"), by: "a" }); } catch (e) { err = e; }
  equal(err.code, "INVALID_MAPPING", "equipment cannot be mapped to a line");
  equal(B.mappings, [], "the target was not modified");
  const c = comparePid({ from: A, to: T }).changes.filter((x) => x.kind === "connectivity");
  assert(c.length >= 1 && c.some((x) => x.lost.length || x.gained.length));
});

await run();
