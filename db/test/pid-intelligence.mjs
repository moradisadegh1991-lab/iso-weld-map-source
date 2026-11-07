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
  equal(st({}), { "K110-30-PID-0021-10-15": "unconfirmed", "K110-30-PID-0021-10-99": "unresolved", "K110-30-PID-0021-10-16": "ambiguous" }, "10-99 is not 10-15; two drawings with one number are ambiguous; a drawing that merely exists (no peer draft) is UNCONFIRMED, never resolved");
  equal(st({ "K110-30-PID-0021-10-15": peerBack(0) })["K110-30-PID-0021-10-15"], "unconfirmed");
  equal(st({ "K110-30-PID-0021-10-15": peerBack(1) })["K110-30-PID-0021-10-15"], "resolved");
  equal(st({ "K110-30-PID-0021-10-15": peerBack(2) })["K110-30-PID-0021-10-15"], "ambiguous", "two connectors point back and the line does not tell them apart");
  const r = validatePid({ draft, directory });
  assert(codes(r).includes("P_OFFPAGE_UNRESOLVED") && codes(r).includes("P_CONN_AMBIGUOUS"));
});

// Phase 11.1 — an off-page connection is confirmed ONLY by the target drawing's own draft (docs/audit/phase-11-pid-intelligence.md §16)
const T = "K110-30-PID-0021-10-15", HERE = "K110-30-PID-0021-10-01";
const srcConn = (line) => ({ cls: "connector", symbol: "offpage", tag: null, bbox: box(800, 100), evidence: [{ text: T }], attrs: { targetSheet: T, ...(line !== undefined ? { lineRef: line } : {}) } });
const farConn = (line, back = HERE) => ({ uid: newUid(), cls: "connector", attrs: { targetSheet: back, ...(line !== undefined ? { lineRef: line } : {}) } });
const peerOf = (...conns) => ({ meta: { drawingNo: T }, items: conns });
const offOf = (line, peers, directory = [{ docNo: T }]) => {
  const { draft } = draftOf([srcConn(line)]);
  return { draft, directory, peers, o: resolveOffpage(draft, { directory, peers })[0], g: buildGraph(draft, { directory, peers }) };
};

test("F4. off-page 1: the target drawing does not exist in the project → unresolved (and no adjacency)", () => {
  const r = offOf("MP140001A", {}, [{ docNo: "K110-30-PID-0021-10-77" }]);
  equal([r.o.status, r.o.toRef ?? null], ["unresolved", null]);
});
test("F5. off-page 2: the target document exists but has no parsed draft → UNCONFIRMED, never resolved", () => {
  for (const line of ["MP140001A", undefined]) { const r = offOf(line, {}); equal(r.o.status, "unconfirmed"); assert(/not been read/.test(r.o.why), r.o.why); }
});
test("F6. off-page 3: exactly one reciprocal connector, no lineRef on the source → resolved (the far connector is named)", () => {
  const far = farConn(); const r = offOf(undefined, { [T]: peerOf(far) });
  equal([r.o.status, r.o.toRef.uid], ["resolved", far.uid]);
  const far2 = farConn("MP9"); equal(offOf(undefined, { [T]: peerOf(far2) }).o.status, "resolved", "a source that names no line accepts the one reciprocal connector");
});
test("F7. off-page 4: exactly one reciprocal connector with the SAME lineRef (whitespace and case ignored) → resolved", () => {
  const far = farConn(" mp140001 a "); const r = offOf("MP140001A", { [T]: peerOf(far) });
  equal([r.o.status, r.o.toRef.uid], ["resolved", far.uid]);
});
test("F8. off-page 5: the reciprocal connector carries a DIFFERENT lineRef → unconfirmed (no fallback to the unfiltered connector)", () => {
  const r = offOf("MP140001A", { [T]: peerOf(farConn("MP140002A")) });
  equal(r.o.status, "unconfirmed"); assert(/none with the line reference/.test(r.o.why), r.o.why);
  equal(offOf("MP140001A", { [T]: peerOf(farConn("MP140001")) }).o.status, "unconfirmed", "a prefix is not the same line");
});
test("F9. off-page 6: the source names a line but the target connector names none → unconfirmed", () => {
  equal(offOf("MP140001A", { [T]: peerOf(farConn()) }).o.status, "unconfirmed");
});
test("F10. off-page 7: several reciprocal connectors with the matching lineRef → ambiguous, with candidates", () => {
  const a = farConn("MP140001A"), b = farConn("mp140001a"); const r = offOf("MP140001A", { [T]: peerOf(a, b, farConn("MP140002A")) });
  equal([r.o.status, r.o.candidates.sort()], ["ambiguous", [a.uid, b.uid].sort()]);
});
test("F11. off-page 8: several connectors and no lineRef to tell them apart → ambiguous; none pointing back → unconfirmed", () => {
  equal(offOf(undefined, { [T]: peerOf(farConn("A"), farConn("B")) }).o.status, "ambiguous");
  equal(offOf(undefined, { [T]: peerOf(farConn("A", "K110-30-PID-0021-10-99")) }).o.status, "unconfirmed", "a connector to another drawing is not a reciprocal");
});
test("F12. off-page 9: only a stated edge makes adjacency — no off-page status (unconfirmed, ambiguous or even resolved: the far end is another drawing's item) adds any", () => {
  for (const peers of [{}, { [T]: peerOf(farConn()) }, { [T]: peerOf(farConn(), farConn()) }, { [T]: peerOf(farConn("X")) }, { [T]: peerOf(farConn("MP140001A")) }]) {
    const r = offOf("MP140001A", peers); const c = r.draft.items[0];
    equal(r.g.adjacency.get(c.uid), [], `adjacency of the connector with status ${r.o.status}`);
  }
  // a stated edge still connects
  const { draft } = draftOf([srcConn(), { id: "p", cls: "equipment", tag: "30-P-1201A", bbox: box(100, 100), evidence: [{ text: "p" }] }], []);
  const e = { uid: newUid(), type: "process", from: draft.items[1].uid, to: draft.items[0].uid, evidence: [{ text: "line to the connector" }], status: "explicit" };
  assert(buildGraph({ ...draft, edges: [e] }, {}).adjacency.get(draft.items[0].uid).includes(draft.items[1].uid));
});
test("F13. off-page 10: the register and the validation report the SAME status as the graph; an unconfirmed one is a finding, not a connection", () => {
  const far = farConn("MP140001A");
  for (const [peers, want] of [[{}, "unconfirmed"], [{ [T]: peerOf(far) }, "resolved"], [{ [T]: peerOf(farConn("Z")) }, "unconfirmed"], [{ [T]: peerOf(far, farConn("MP140001A")) }, "ambiguous"]]) {
    const r = offOf("MP140001A", peers), regs = registers(r.draft, { directory: r.directory, peers });
    equal(regs.offpage.map((x) => x.status), [r.g.offpage[0].status], "register = graph");
    equal(regs.offpage[0].status, want);
    equal(regs.connectivity.length, 0, "no off-page status is listed as a stated connection");
    const f = codes(validatePid({ draft: r.draft, directory: r.directory, peers }));
    equal([f.includes("P_OFFPAGE_UNRESOLVED"), f.includes("P_CONN_AMBIGUOUS")], [want === "unconfirmed", want === "ambiguous"], `findings for ${want}`);
  }
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

// ── the server: intake, idempotent ingest, review audit, approval, isolation ─

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("pid-db-");
process.env.STORAGE_ROOT = await scratchDir("pid-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const pidRoute = await import("../../app/api/pid/route.js");
const reviewRoute = await import("../../app/api/pid/review/route.js");
const reviewQueueRoute = await import("../../app/api/review-queue/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const { addMember, ensureUser } = await import("../../lib/db/repos/projects.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const db = await getDb();
const mkProject = async (code, as = "kc|alice") => (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", as, body: { code, name: code } })))).body.project.id;
const projectId = await mkProject("PID1"), otherProject = await mkProject("PID2", "kc|mallory");
const q = (sql, p = []) => withProject(db, projectId, async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo, revision = "0", pid = projectId, as = "kc|alice") => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", as, body: { projectId: pid, docNo, revision, docType: "pid", fileBase64: Buffer.from(`pid ${docNo} ${revision} ${++seq}`).toString("base64") } })))).body.document;
const ingest = async (documentId, body, as = "kc|alice", pid = projectId) => json(await pidRoute.POST(req("http://x/api/pid", { method: "POST", as, body: { projectId: pid, documentId, ...body } })));
const get = async (documentId, as = "kc|alice", pid = projectId, extra = "") => json(await pidRoute.GET(req(`http://x/api/pid?projectId=${pid}&documentId=${documentId}${extra}`, { as })));
const act = async (b, as = "kc|alice") => json(await reviewRoute.POST(req("http://x/api/pid/review", { method: "POST", as, body: { projectId, ...b } })));
const OCR = { page: 1, w: 1000, h: 800, items: [ocr("30-P-1201A", box(100, 100)), ocr("30-E-1129", box(300, 100)), ocr('4" MP140001A-EA01-H', box(100, 300)), ocr("K110-30-PID-0021-10-15/1", box(800, 50))] };
const D = {};

test("S1. intake: a P&ID is a document of its own revision; ingest files an `extracted` draft that stamps document + revision on every record; nothing is approved", async () => {
  D.a = await newDoc("K110-30-PID-0021-10-01");
  assert(D.a.doc_type === "pid", "the documents route files a drawing as a P&ID on request");
  const r = await ingest(D.a.id, { ocr: OCR, meta: { title: "FEED" } });
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  D.run = r.body.run.id;
  const g = await get(D.a.id);
  equal(g.status, 200);
  assert(g.body.draft.items.length >= 4 && g.body.draft.items.every((i) => i.review.status === "extracted" && i.source.revision === "0" && i.evidence.length));
  equal([g.body.draft.meta.document.documentId, g.body.draft.meta.document.revision, g.body.run.status], [D.a.id, "0", "extracted"]);
  assert(g.body.registers.equipment.length === 2 && g.body.registers.lines.length === 1 && g.body.registers.offpage.length === 1);
  assert(g.body.validation.findings.every((f) => f.revision.documentId === D.a.id));
});

test("S2. a retried extraction does not duplicate: the same reading returns the same draft; the isometric review queue never lists a P&ID draft", async () => {
  const again = await ingest(D.a.id, { ocr: OCR });
  equal([again.status, again.body.created, again.body.run.id], [200, false, D.run]);
  equal((await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1 AND pass_name = 'pid'", [D.a.id]))[0].n, 1);
  const queue = await json(await reviewQueueRoute.GET(req(`http://x/api/review-queue?projectId=${projectId}`)));
  assert(!JSON.stringify(queue.body).includes(D.run), "a P&ID draft is not in the weld-register review queue");
});

test("S3. a vision PROPOSAL is sanitized on the server: records are `extracted`, an approval claim is ignored, evidence-less edges are rejected", async () => {
  const d2 = await newDoc("K110-30-PID-0021-10-02");
  const r = await ingest(d2.id, { page: { number: 1, width: 1000, height: 800 }, reader: "vision-x", proposal: {
    items: [{ id: "p", cls: "equipment", symbol: "pump", tag: "30-P-1301", bbox: box(100, 100), evidence: [{ text: "30 P 1301" }], review: { status: "approved", by: "model" } }, { id: "l", cls: "line", symbol: "process-line", tag: "MP140009A", bbox: box(100, 200), evidence: [{ text: "l" }] }],
    edges: [{ type: "process", from: "p", to: "l" }, { type: "process", from: "p", to: "l", evidence: [{ text: "the line leaves the pump" }] }] } });
  equal([r.status, r.body.items, r.body.edges, r.body.rejected.length], [201, 2, 1, 1]);
  const g = await get(d2.id);
  assert(g.body.draft.items.every((i) => i.review.status === "extracted") && g.body.draft.edges.length === 1 && g.body.run.status === "extracted");
});

test("S4. authorization: a viewer cannot ingest or review; another project's member sees nothing; a missing document is 404; approving needs the approval right", async () => {
  const v = await ensureUser(db, { subject: "kc|viewer-pid" }); await addMember(db, { projectId, userId: v.id, role: "viewer" });
  equal((await ingest(D.a.id, { ocr: OCR }, "kc|viewer-pid")).status, 403);
  const uid = (await get(D.a.id)).body.draft.items[0].uid;
  equal((await act({ runId: D.run, uid, action: "flag" }, "kc|viewer-pid")).status, 403);
  equal((await get(D.a.id, "kc|viewer-pid")).status, 200, "reading is allowed");
  equal((await get(D.a.id, "kc|mallory")).status, 404, "another project's user");
  equal((await ingest(D.a.id, { ocr: OCR }, "kc|mallory", otherProject)).status, 404, "the document is not that project's");
  equal((await act({ runId: D.run, action: "approve_draft" }, "kc|viewer-pid")).status, 403);
});

test("S5. review is audited: the original value stays beside the correction, extraction_edit keeps before/after/who; a stale edit is refused; two edits on one base: one wins, one is refused", async () => {
  const g = await get(D.a.id), item = g.body.draft.items.find((i) => i.tag === "30-P-1201A");
  const h0 = g.body.run.payloadHash;
  const ok = await act({ runId: D.run, uid: item.uid, action: "correct", value: { tag: "30-P-1201B", symbol: "pump" }, reason: "misread suffix", baseHash: h0 });
  equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
  const after = (await get(D.a.id)).body.draft.items.find((i) => i.uid === item.uid);
  equal([after.tag, after.symbol, after.review.status, after.review.original, after.review.corrected.tag], ["30-P-1201B", "pump", "corrected", { tag: "30-P-1201A", symbol: "UNKNOWN" }, "30-P-1201B"]);
  assert(after.review.by && after.review.at);
  const edits = await q("SELECT field, before_value, after_value, reason, edited_by FROM extraction_edit WHERE extraction_run_id = $1 ORDER BY edited_at, field", [D.run]);
  assert(edits.some((e) => e.field === "tag" && e.before_value === "30-P-1201A" && e.after_value === "30-P-1201B" && e.reason === "misread suffix" && e.edited_by));
  const stale = await act({ runId: D.run, uid: item.uid, action: "flag", baseHash: h0 });
  equal([stale.status, stale.body.code], [409, "STALE_RUN"]);
  const h1 = (await get(D.a.id)).body.run.payloadHash, other = g.body.draft.items.find((i) => i.tag === "30-E-1129").uid;
  const race = await Promise.all([act({ runId: D.run, uid: other, action: "flag", baseHash: h1 }), act({ runId: D.run, uid: item.uid, action: "flag", baseHash: h1 })]);
  equal(race.map((r) => r.status).sort(), [200, 409]);
});

test("S6. an approved record cannot be changed; reject needs a reason; asset links are proposed (unique / multiple / none) and nothing is created", async () => {
  await db.query("SELECT 1");
  await withProject(db, projectId, async () => {
    await db.query("INSERT INTO tag (project_id, tag_no, discipline, kind) VALUES ($1,'30-E-1129','equipment','equipment'), ($1,'30E1129','equipment','equipment'), ($1,'30-P-1201B','equipment','pump')", [projectId]);
  });
  const g = await get(D.a.id);
  const by = (t) => g.body.draft.items.find((i) => i.tag === t);
  equal([g.body.links[by("30-E-1129").uid].state, g.body.links[by("30-P-1201B").uid].state], ["multiple", "unique"], "30-E-1129 and 30E1129 are two register rows for one normalized tag: a human resolves it");
  assert(!g.body.links[by("MP140001A").uid] || g.body.links[by("MP140001A").uid].state === "none");
  const before = (await q("SELECT count(*)::int AS n FROM tag WHERE project_id = $1", [projectId]))[0].n;
  const uid = by("30-P-1201B").uid;
  equal((await act({ runId: D.run, uid, action: "approve" })).status, 200);
  const locked = await act({ runId: D.run, uid, action: "correct", value: { tag: "X" } });
  equal([locked.status, locked.body.code], [409, "APPROVED_LOCKED"]);
  equal((await act({ runId: D.run, uid: by("30-E-1129").uid, action: "reject" })).body.code, "REASON_REQUIRED");
  equal((await q("SELECT count(*)::int AS n FROM tag WHERE project_id = $1", [projectId]))[0].n, before, "nothing was created from the reading");
});

test("S7. sign-off of the whole draft: refused while records are undecided or an engineering error is open; then signed with who/when/hash; afterwards locked (RUN_LOCKED)", async () => {
  const d3 = await newDoc("K110-30-PID-0021-10-03");
  equal((await ingest(d3.id, { page: { number: 1, width: 1000, height: 800 }, proposal: { items: [
    { cls: "equipment", symbol: "pump", tag: "30-P-1401", bbox: box(100, 100), evidence: [{ text: "p" }] },
    { cls: "instrument", symbol: "bubble", tag: "ZZ-1", bbox: box(200, 100), evidence: [{ text: "ZZ 1" }] }] } })).status, 201);
  const g = await get(d3.id), run = g.body.run.id;
  const un = await act({ runId: run, action: "approve_draft" });
  equal([un.status, un.body.code, un.body.details.undecided.length], [409, "UNDECIDED", 2]);
  for (const i of g.body.draft.items) equal((await act({ runId: run, uid: i.uid, action: "approve" })).status, 200);
  const err = await act({ runId: run, action: "approve_draft" });
  equal([err.status, err.body.code], [409, "ENGINEERING_ERRORS"], "an invalid ISA function is a real error: it blocks the sign-off");
  const bad = g.body.draft.items.find((i) => i.tag === "ZZ-1");
  equal((await json(await reviewRoute.POST(req("http://x/api/pid/review", { method: "POST", body: { projectId, runId: run, uid: bad.uid, action: "reject", reason: "not an instrument" } })))).status, 409, "an approved record is not rejected afterwards");
  // the person re-opens nothing: the instrument is rejected in a fresh draft instead
  const d4 = await newDoc("K110-30-PID-0021-10-04");
  equal((await ingest(d4.id, { page: { number: 1, width: 1000, height: 800 }, proposal: { items: [{ cls: "equipment", symbol: "pump", tag: "30-P-1501", bbox: box(100, 100), evidence: [{ text: "p" }] }, { cls: "instrument", symbol: "bubble", tag: "ZZ-1", bbox: box(200, 100), evidence: [{ text: "ZZ 1" }] }] } })).status, 201);
  const g4 = await get(d4.id), r4 = g4.body.run.id;
  equal((await act({ runId: r4, uid: g4.body.draft.items[0].uid, action: "approve" })).status, 200);
  equal((await act({ runId: r4, uid: g4.body.draft.items[1].uid, action: "reject", reason: "ZZ is not an ISA function" })).status, 200);
  const signed = await act({ runId: r4, action: "approve_draft" });
  equal(signed.status, 200, JSON.stringify(signed.body).slice(0, 300));
  const row = (await q("SELECT status, approved_by, approved_at, approved_sha256 FROM extraction_run WHERE id = $1", [r4]))[0];
  assert(row.status === "approved" && row.approved_by && row.approved_at && /^[0-9a-f]{64}$/.test(row.approved_sha256));
  const lock = await act({ runId: r4, uid: g4.body.draft.items[0].uid, action: "flag" });
  equal([lock.status, lock.body.code], [409, "RUN_LOCKED"]);
  const re = await ingest(d4.id, { page: { number: 1, width: 1000, height: 800 }, proposal: { items: [{ cls: "equipment", symbol: "pump", tag: "30-P-9999", bbox: box(100, 100), evidence: [{ text: "p" }] }] } });
  equal([re.status, re.body.code], [409, "RUN_LOCKED"], "a different reading of a signed-off revision is refused");
  equal((await act({ runId: r4, action: "approve_draft" })).body.repeated, true);
});

test("S8. revision isolation: revision B is its own document and draft; comparing finds candidates, never matches; a confirmed mapping is stored on the TARGET draft only; a signed-off target refuses mappings", async () => {
  const a = await newDoc("K110-30-PID-0021-20-01", "0"), b = await newDoc("K110-30-PID-0021-20-01", "1");
  assert(a.id !== b.id, "two revisions are two documents");
  const P = (tags) => ({ page: { number: 1, width: 1000, height: 800 }, proposal: { items: tags.map((t, i) => ({ cls: "equipment", symbol: "pump", tag: t, bbox: box(100 + i * 150, 100), evidence: [{ text: t }] })) } });
  equal((await ingest(a.id, P(["30-P-1", "30-P-2"]))).status, 201); equal((await ingest(b.id, P(["30-P-1", "30-P-3"]))).status, 201);
  const ga = await get(a.id), gb = await get(b.id);
  assert(ga.body.draft.items.every((i) => i.source.revision === "0") && gb.body.draft.items.every((i) => i.source.revision === "1"), "each record keeps ITS revision");
  const ids = new Set(ga.body.draft.items.map((i) => i.uid)); assert(gb.body.draft.items.every((i) => !ids.has(i.uid)), "no uid is shared across revisions");
  const cmp = await get(a.id, "kc|alice", projectId, `&compareTo=${b.id}`);
  equal(cmp.status, 200, JSON.stringify(cmp.body).slice(0, 200));
  assert(cmp.body.changes.some((c) => c.kind === "candidate" && c.tag === "30-P-1") && cmp.body.changes.some((c) => c.kind === "removed" && c.tag === "30-P-2") && cmp.body.changes.some((c) => c.kind === "added" && c.tag === "30-P-3"));
  const fromUid = ga.body.draft.items.find((i) => i.tag === "30-P-2").uid, toUid = gb.body.draft.items.find((i) => i.tag === "30-P-3").uid;
  const m = await act({ runId: gb.body.run.id, action: "confirm_mapping", sourceRunId: ga.body.run.id, fromUid, toUid, baseHash: gb.body.run.payloadHash });
  equal(m.status, 200, JSON.stringify(m.body).slice(0, 300));
  const after = await get(b.id);
  equal(after.body.draft.mappings.map((x) => [x.fromUid, x.toUid]), [[fromUid, toUid]]);
  equal((await get(a.id)).body.draft.mappings, [], "the source revision is not touched");
  const cmp2 = await get(a.id, "kc|alice", projectId, `&compareTo=${b.id}`);
  assert(cmp2.body.changes.some((c) => c.kind === "renumbered" && c.fromUid === fromUid && c.toUid === toUid));
  const dup = await act({ runId: gb.body.run.id, action: "confirm_mapping", sourceRunId: ga.body.run.id, fromUid, toUid });
  equal([dup.status, dup.body.code], [409, "INVALID_MAPPING"]);
  const other = await newDoc("K110-30-PID-0021-30-01", "0"); equal((await ingest(other.id, P(["30-P-1"]))).status, 201);
  const wrong = await act({ runId: gb.body.run.id, action: "confirm_mapping", sourceRunId: (await get(other.id)).body.run.id, fromUid: (await get(other.id)).body.draft.items[0].uid, toUid: gb.body.draft.items[0].uid });
  equal([wrong.status, wrong.body.code], [409, "INVALID_LINEAGE"], "drafts of two different drawings are not revisions of each other");
});

await run();
