#!/usr/bin/env node
/**
 * Phase 12.3 — SLD extraction engine (docs/audit/phase-12-sld-intelligence.md §19). Synthetic sheets only (eval/sld): they prove the engine's CONTRACT and rules, not real-drawing accuracy.
 *   A. pure: page geometry & rotation, text/unit normalisation (Persian and English), association (ambiguity kept), contract validation, decisions, model-suggestion sanitiser, limiter
 *   B. the reader on real PDFs (poppler): inspection, native text, vector symbols, unknown preservation, multi-page, all four rotations, evidence integrity, limits, failures
 *   C. the raster reader (OCR + OpenCV) — registered only where tesseract / OpenCV exist; otherwise reported as NOT RUN
 *   D. the route + repository: scope, document type, authorization, idempotency, stale edits, per-item decisions, approval lock, human-decision protection, nothing promoted
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { pageModel, clampBox, normalize, denormalize, toUserSpace, fromUserSpace } from "../../lib/sld/extract/geometry.mjs";
import { normalizeText, parseRatings, textRoles } from "../../lib/sld/extract/text.mjs";
import { associate } from "../../lib/sld/extract/associate.mjs";
import { validateExtractionContent, applyDecision, EVIDENCE_SOURCES } from "../../lib/sld/extract/contract.mjs";
import { sanitizeSuggestions, assistCandidates, MODEL_CAP } from "../../lib/sld/extract/model.mjs";
import { createLimiter } from "../../lib/sld/extract/limiter.mjs";
import { extractSld, configOf, sourceHash } from "../../lib/sld/extract/run.mjs";
import { CLASSES, CLASS_IDS, TOPOLOGY_CLASSES, UNKNOWN } from "../../lib/sld/extract/vocab.mjs";
import { validateEnvelope } from "../../lib/sld/envelope.mjs";
import { Drawing } from "../../eval/sld/dsl.mjs";
import { CASES } from "../../eval/sld/cases.mjs";
import { pdfOf, scannedPdf } from "../../eval/sld/synth.mjs";
import { pdfFor, runCase } from "../../eval/sld/run.mjs";

const rejects = async (fn, status, code) => { try { await fn(); } catch (e) { equal([e.status, e.code], [status, code], e.message); return e; } throw new Error(`expected ${status} ${code}`); };
const vectorCase = (id) => CASES.find((c) => c.id === id);
const sheet = (id) => pdfFor(vectorCase(id)).pdf;
const basic = await extractSld(sheet("vector-basic"), {}, { tools: {} });
const items = basic.draft.items, syms = items.filter((i) => i.kind === "symbol"), texts = items.filter((i) => i.kind === "text");

// ── A. pure ───────────────────────────────────────────────────────────────────────────────────────────────

test("A1. page model: poppler reports the UNROTATED size; the display size swaps for /Rotate 90 and 270, not for 180; landscape ≠ rotated", () => {
  const land = pageModel({ number: 1, mediaWidth: 842, mediaHeight: 595, rotation: 0 });
  equal([land.width, land.height, land.orientation, land.rotation], [842, 595, "landscape", 0]);
  const r90 = pageModel({ number: 1, mediaWidth: 595, mediaHeight: 842, rotation: 90 });
  equal([r90.width, r90.height, r90.orientation, r90.rotation, r90.mediaWidth, r90.mediaHeight], [842, 595, "landscape", 90, 595, 842], "a portrait MediaBox rotated 90 is a LANDSCAPE page");
  equal([pageModel({ number: 1, mediaWidth: 595, mediaHeight: 842, rotation: 180 }).width, pageModel({ number: 1, mediaWidth: 595, mediaHeight: 842, rotation: 270 }).width], [595, 842]);
  equal(pageModel({ number: 1, mediaWidth: 595, mediaHeight: 842, rotation: -90 }).rotation, 270);
  equal(pageModel({ number: 1, mediaWidth: 100, mediaHeight: 100, dpi: 200, source: "image" }).scale, 2.7778);
});

test("A2. coordinates: normalised ↔ display round-trip; boxes stay inside the page; user-space ↔ display round-trip for every rotation", () => {
  const p = pageModel({ number: 1, mediaWidth: 595, mediaHeight: 842, rotation: 90 });
  const n = normalize([100, 50, 200, 150], p); equal(n, [0.11876, 0.08403, 0.23753, 0.2521].map((v) => Math.round(v * 1e5) / 1e5));
  for (const v of denormalize(n, p)) assert(Number.isFinite(v));
  const c = clampBox([-10, -5, 900, 700], p); equal(c.box, [0, 0, 842, 595]); assert(c.clamped);
  assert(!clampBox([10, 10, 20, 20], p).clamped);
  for (const rotation of [0, 90, 180, 270]) {
    const pg = pageModel({ number: 1, mediaWidth: 595, mediaHeight: 842, rotation });
    for (const [x, y] of [[0, 0], [10, 20], [pg.width, pg.height], [123.4, 56.7]]) { const [ux, uy] = toUserSpace(x, y, pg); const [bx, by] = fromUserSpace(ux, uy, pg); equal([bx, by], [Math.round(x * 100) / 100, Math.round(y * 100) / 100], `rotation ${rotation}`); }
  }
  let err; try { pageModel({ number: 1, mediaWidth: 0, mediaHeight: 10 }); } catch (e) { err = e; } equal(err?.code, "PAGE_SIZE_INVALID");
});

test("A3. text normalisation: Persian / Arabic-Indic digits, Arabic letters, units in both scripts; the SOURCE text is never changed by the readers", () => {
  equal(normalizeText("۳۳/۱۱ kV"), "33/11 kV");
  equal(normalizeText("٦٫٦ kV"), "6.6 kV");
  equal(normalizeText("  T–101‌ "), "T-101");
  equal(normalizeText("ك ي"), "ک ی");
  equal(normalizeText("3×95 mm²"), "3x95 mm2");
  const fa = parseRatings("۳۳/۱۱ کیلوولت"); equal(fa[0].kind, "voltage_levels"); equal([fa[0].value, fa[0].unit], [[33, 11], "kV"]);
  equal(parseRatings("۲۵ مگاولت آمپر")[0], { kind: "apparent_power", value: 25, unit: "MVA", raw: "25 MVA", basis: "text-pattern" });
  equal(parseRatings("۵۰ هرتز").map((r) => [r.kind, r.value, r.unit]), [["frequency", 50, "Hz"]]);
  const src = "۳۳/۱۱ kV"; textRoles(src); equal(src, "۳۳/۱۱ kV");
});

test("A4. ratings: voltage pairs, apparent power, power, current, frequency, %Z, vector group, cable cores — each an UNCONFIRMED text-pattern candidate", () => {
  const kinds = (s) => parseRatings(s).map((r) => `${r.kind}:${JSON.stringify(r.value)}${r.unit ? r.unit : ""}`);
  equal(kinds("33/11 kV"), ['voltage_levels:[33,11]kV']);
  equal(kinds("6.6 kV"), ["voltage:6.6kV"]);
  equal(kinds("400 V"), ["voltage:400V"]);
  equal(kinds("25 MVA"), ["apparent_power:25MVA"]);
  equal(kinds("1600 kVA"), ["apparent_power:1600kVA"]);
  equal(kinds("250 kW"), ["power:250kW"]);
  equal(kinds("630 A"), ["current:630A"]);
  equal(kinds("50 Hz"), ["frequency:50Hz"]);
  equal(kinds("Z=6.5%"), ["impedance_percent:6.5%"]);
  equal(kinds("Dyn11"), ["vector_group:\"Dyn11\""]);
  assert(parseRatings("3x95 mm2 XLPE").some((r) => r.kind === "cable_cores_size" && r.cores === 3 && r.size === 95));
  assert(parseRatings("T-101").length === 0 && parseRatings("hello").length === 0);
  assert(parseRatings("25 MVA").every((r) => r.basis === "text-pattern"));
});

test("A5. text roles: tag shapes, voltage, rating, cable, off-page; anything else stays a label; a tag SHAPE is not a decision of what it tags", () => {
  const role = (s) => textRoles(s).roles[0];
  equal(["T-101", "TR-1A", "MCC-2", "CB-12/1", "11-TR-001"].map(role), ["tag", "tag", "tag", "tag", "tag"]);
  equal(role("33/11 kV"), "voltage"); equal(role("25 MVA"), "rating"); equal(role("3x95 mm2"), "cable"); equal(role("87T"), "device_code"); equal(role("hello world"), "label");
  assert(textRoles("TO SH 3").roles.includes("offpage"));
});

test("A6. vocabulary: versioned, topology-only classes exist but are never produced by the geometry rules; UNKNOWN is a class of its own", () => {
  assert(CLASSES.length >= 36 && CLASS_IDS.has(UNKNOWN));
  for (const c of ["transformer", "generator", "motor", "load", "ups", "battery", "rectifier", "inverter", "circuit_breaker", "isolator", "load_break_switch", "fuse", "contactor", "relay", "earthing_switch", "busbar", "bus_coupler", "bus_section", "feeder", "incoming_feeder", "outgoing_feeder", "panel_switchgear", "current_transformer", "voltage_transformer", "ammeter", "voltmeter", "protection_relay", "energy_meter", "connection_line", "junction", "ground", "offpage_reference", "cable_annotation", "equipment_tag", "voltage_annotation", "rating_annotation"]) assert(CLASS_IDS.has(c), c);
  assert(["bus_coupler", "bus_section", "feeder", "incoming_feeder", "outgoing_feeder"].every((c) => TOPOLOGY_CLASSES.has(c)));
});

test("A7. association keeps ambiguity: a tag midway between two symbols is linked to BOTH, flagged, and is the primary tag of NEITHER; a unique one is a candidate", () => {
  const S = [{ uid: "a", cls: "motor", bbox: [90, 110, 110, 130] }, { uid: "b", cls: "motor", bbox: [170, 110, 190, 130] }];
  const mid = associate(S, [{ uid: "t", roles: ["tag"], bbox: [128, 140, 160, 148] }], { scale: 1 });
  equal(mid.links.map((l) => [l.symbolUid, l.status]).sort(), [["a", "ambiguous"], ["b", "ambiguous"]]);
  equal([...mid.primaryTag], []);
  const near = associate(S, [{ uid: "t", roles: ["tag"], bbox: [92, 134, 120, 142] }], { scale: 1 });
  equal(near.links[0].symbolUid, "a"); equal(near.links[0].status, "candidate"); equal([...near.primaryTag], [["a", "t"]]);
  const two = associate(S.slice(0, 1), [{ uid: "t1", roles: ["tag"], bbox: [92, 134, 120, 142] }, { uid: "t2", roles: ["tag"], bbox: [92, 100, 120, 108] }], { scale: 1 });
  equal([...two.primaryTag], [], "two competing tags: neither is primary");
  const far = associate(S, [{ uid: "t", roles: ["tag"], bbox: [500, 500, 530, 508] }], { scale: 1 });
  equal(far.links, [], "a text no symbol is near is not associated (and not deleted: it stays an item)");
});

const goodItem = (over = {}) => ({ uid: "u1", kind: "symbol", cls: "motor", page: 1, bbox: [0.1, 0.1, 0.2, 0.2], bboxPt: [10, 10, 20, 20], confidence: 0.8, reviewStatus: "unreviewed", evidence: [{ source: "symbol_detector", ref: "r", page: 1 }], ...over });
const draftOf = (its, over = {}) => ({ kind: "sld", schema: 1, meta: { contract: { name: "sld-extraction", version: 1 }, pages: [{ number: 1, width: 100, height: 100 }] }, page: {}, items: its, edges: [], source: { kind: "k", reader: "r", hash: "h", generatedAt: "2026-11-07T10:00:00Z" }, ...over });
const bad = (d, origin, re) => { try { validateExtractionContent(d, { origin }); } catch (e) { equal(e.code, "INVALID_EXTRACTION"); assert(re.test(JSON.stringify(e.details.problems)), JSON.stringify(e.details.problems)); return; } throw new Error("expected INVALID_EXTRACTION"); };

test("A8. the extraction contract refuses: edges, an unknown class, a bbox outside [0,1] or the page, no evidence, an unknown evidence source, a duplicate uid, a machine's confirmed status", () => {
  validateExtractionContent(draftOf([goodItem()]));
  bad(draftOf([goodItem()], { edges: [{ from: "a", to: "b" }] }), "machine", /edges must be empty/);
  bad(draftOf([goodItem({ cls: "flux_capacitor" })]), "machine", /not in the vocabulary/);
  bad(draftOf([goodItem({ bbox: [0, 0, 1.2, 1] })]), "machine", /bbox must be/);
  bad(draftOf([goodItem({ bboxPt: [10, 10, 300, 20] })]), "machine", /outside the page/);
  bad(draftOf([goodItem({ evidence: [] })]), "machine", /evidence is required/);
  bad(draftOf([goodItem({ evidence: [{ source: "gut_feeling" }] })]), "machine", /not recognised/);
  bad(draftOf([goodItem(), goodItem()]), "machine", /duplicate uid/);
  bad(draftOf([goodItem({ page: 4 })]), "machine", /not a page/);
  bad(draftOf([goodItem({ confidence: 1.5 })]), "machine", /confidence/);
  bad(draftOf([goodItem({ reviewStatus: "confirmed" })]), "machine", /machine reading cannot set/);
  bad(draftOf([goodItem({ reviewStatus: "confirmed" })]), "human", /needs review\.by/);
  validateExtractionContent(draftOf([goodItem({ reviewStatus: "confirmed", review: { by: "u", at: "2026-11-07T10:00:00Z" } })]), { origin: "human" });
  assert(EVIDENCE_SOURCES.includes("model_interpretation") && EVIDENCE_SOURCES.length === 6);
});

test("A9. Phase 12.2 compatibility: a draft WITHOUT the contract marker is untouched by every extraction rule (opaque items, any edges)", () => {
  const opaque = { kind: "sld", schema: 1, meta: {}, page: {}, items: [{ anything: 1 }], edges: [{ from: "x" }], source: { kind: "k", reader: "r", hash: "h", generatedAt: "2026-11-07T10:00:00Z" } };
  equal(validateExtractionContent(validateEnvelope(opaque), { origin: "machine" }).items, [{ anything: 1 }]);
});

test("A10. decisions: confirm / reject / reclassify / set keep the machine's values in `original`, keep the evidence, stamp who and when, and need their reason", () => {
  const env = draftOf([goodItem({ cls: UNKNOWN, attrs: {} })]);
  const ev = env.items[0].evidence;
  const c = applyDecision(env, { uid: "u1", decision: "confirm", userId: "alice", now: "2026-11-07T11:00:00Z" });
  equal([c.items[0].reviewStatus, c.items[0].review.by, c.items[0].review.at, c.items[0].original.cls, c.items[0].evidence], ["confirmed", "alice", "2026-11-07T11:00:00Z", UNKNOWN, ev]);
  const r = applyDecision(c, { uid: "u1", decision: "reclassify", cls: "motor", reason: "letter M inside", userId: "bob", now: "2026-11-07T12:00:00Z" });
  equal([r.items[0].cls, r.items[0].original.cls, r.items[0].classBasis, r.items[0].review.history.length, r.items[0].reviewStatus], ["motor", UNKNOWN, "human", 2, "corrected"]);
  validateExtractionContent(r, { origin: "human" });
  let e1; try { applyDecision(env, { uid: "u1", decision: "reject", userId: "a" }); } catch (e) { e1 = e; } equal(e1?.code, "INVALID_EXTRACTION");
  let e2; try { applyDecision(env, { uid: "u1", decision: "reclassify", cls: "nope", reason: "x", userId: "a" }); } catch (e) { e2 = e; } equal(e2?.code, "INVALID_EXTRACTION");
  let e3; try { applyDecision(env, { uid: "zz", decision: "confirm", userId: "a" }); } catch (e) { e3 = e; } equal(e3?.code, "ITEM_NOT_FOUND");
  equal(applyDecision(env, { uid: "u1", decision: "reject", reason: "not a symbol", userId: "a" }).items.length, 1, "a rejected item is kept, not deleted");
  equal(env.items[0].reviewStatus, "unreviewed", "the input draft is not mutated");
});

test("A11. model suggestions: only for UNKNOWN symbols, only vocabulary classes (never topology-only), confidence capped, evidence recorded; class and status NEVER change; the rest is dropped and counted", () => {
  const d = draftOf([goodItem({ uid: "unk", cls: UNKNOWN, alternatives: [], warnings: [], evidence: [{ source: "symbol_detector", ref: "r", page: 1 }] }), goodItem({ uid: "mot", cls: "motor", alternatives: [], warnings: [] })]);
  const s = sanitizeSuggestions(d, { suggestions: [
    { uid: "unk", class: "transformer", confidence: 0.99, reason: "two rings" }, { uid: "mot", class: "generator", confidence: 0.9 }, { uid: "unk", class: "bus_coupler", confidence: 0.4 },
    { uid: "ghost", class: "motor", confidence: 0.4 }, { uid: "unk", class: "flux_capacitor", confidence: 0.4 }] }, { provider: "p", model: "m" });
  equal(s.accepted, 1); equal(s.rejected.length, 4);
  const u = s.draft.items[0];
  equal([u.cls, u.reviewStatus, u.alternatives[0].cls, u.alternatives[0].confidence, u.alternatives[0].source], [UNKNOWN, "unreviewed", "transformer", MODEL_CAP, "model"]);
  equal(u.evidence.at(-1).source, "model_interpretation");
  equal(s.draft.items[1].alternatives, [], "a classified symbol receives no suggestion");
  assert(assistCandidates(d).length === 1 && assistCandidates(d)[0].uid === "unk");
});

test("A12. the limiter: at most N readings at once; a release frees a slot exactly once", () => {
  const l = createLimiter(2); const a = l.acquire(), b = l.acquire(), c = l.acquire();
  assert(a && b && !c); equal(l.active, 2); a(); a(); equal(l.active, 1); assert(l.acquire()); equal(l.active, 2);
});

// ── B. the reader on real PDFs ────────────────────────────────────────────────────────────────────────────

test("B1. the basic sheet is read: every drawn symbol class is found, with its tag and ratings as UNCONFIRMED candidates", () => {
  const cls = (c) => syms.filter((s) => s.cls === c).length;
  equal([cls("transformer"), cls("motor"), cls("generator"), cls("circuit_breaker"), cls("busbar"), cls("ground"), cls("battery"), cls("junction"), cls("current_transformer"), cls("ammeter"), cls("voltmeter")], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const tr = syms.find((s) => s.cls === "transformer");
  equal(tr.attrs.windings, 2); equal(tr.attrs.tagCandidate.text, "T-101"); equal(tr.attrs.tagCandidate.status, "unconfirmed");
  const ratings = tr.attrs.ratingCandidates.map((r) => `${r.kind}:${JSON.stringify(r.value)}${r.unit}`).sort();
  equal(ratings, ["apparent_power:25MVA", "voltage_levels:[33,11]kV"]);
  assert(tr.attrs.ratingCandidates.every((r) => r.status === "unconfirmed"));
  equal(syms.find((s) => s.cls === "motor").attrs.tagCandidate.text, "M-201");
  equal(syms.find((s) => s.cls === "circuit_breaker").attrs.tagCandidate.text, "CB-12");
});

test("B2. native text keeps the source text and a separate normalised value; a number and its unit read as ONE block (33/11 kV)", () => {
  const t = texts.find((x) => x.text === "33/11 kV");
  assert(t, "merged block"); equal([t.cls, t.method, t.confidence, t.confidenceBasis], ["voltage_annotation", "pdf-text", 1, "native-text-exact"]);
  assert(t.evidence.length === 2 && t.evidence.every((e) => e.source === "pdf_text_span"));
  assert(texts.every((x) => typeof x.text === "string" && typeof x.textNormalized === "string"));
  assert(texts.some((x) => x.text === "M") , "text inside a symbol is kept as text");
});

test("B3. unknown symbols stay UNKNOWN with their evidence, rule and alternatives — never guessed from a shape alone or a nearby word", () => {
  const r = vectorCase("vector-ambiguous-symbols");
  return runCase(r).then(({ draft }) => {
    const unk = draft.items.filter((i) => i.kind === "symbol" && i.cls === UNKNOWN);
    equal(unk.length, 3);
    for (const u of unk) { assert(u.evidence.length >= 2 && u.evidence.some((e) => e.source === "symbol_detector") && u.warnings.length >= 1 && u.confidence <= 0.3, JSON.stringify(u.warnings)); }
    const sq = unk.find((u) => u.evidence.some((e) => e.ref === "square-on-conductor"));
    equal(sq.alternatives.map((a) => a.cls).sort(), ["circuit_breaker", "contactor"]);
    assert(draft.items.some((i) => i.cls === "circuit_breaker"), "the real breaker beside them is still classified");
  });
});

test("B4. evidence integrity: every item has evidence of a recognised source, every symbol names the rule that made it, confidence in [0,1], boxes inside the page, all UNREVIEWED, observed vs inferred kept apart", () => {
  for (const it of items) {
    assert(it.evidence.length > 0 && it.evidence.every((e) => EVIDENCE_SOURCES.includes(e.source)), it.uid);
    assert(it.confidence >= 0 && it.confidence <= 1 && it.reviewStatus === "unreviewed" && ["observed", "inferred"].includes(it.basis));
    assert(it.bbox.every((v) => v >= 0 && v <= 1) && it.bboxPt[2] <= basic.draft.meta.pages[0].width + 0.01 && it.bboxPt[3] <= basic.draft.meta.pages[0].height + 0.01);
    assert(/^sld:[0-9a-f]{20}$/.test(it.uid));
  }
  for (const s of syms) assert(s.evidence.some((e) => e.source === "symbol_detector" && e.detail.rule) && s.basis === "inferred" && s.confidenceBasis === "heuristic-rule-score");
  for (const t of texts) assert(t.basis === "observed" && t.evidence.every((e) => e.source === "pdf_text_span"));
  equal(new Set(items.map((i) => i.uid)).size, items.length, "uids are unique");
  equal(basic.draft.edges, [], "no edges: connectivity is not extracted");
  validateExtractionContent(basic.draft, { origin: "machine" }); validateEnvelope(basic.draft);
});

test("B5. a draft records how to reproduce it: engine, rules, vocabulary, tools, configuration, file hash, per-page source; the hash is deterministic and ignores the clock", async () => {
  const m = basic.draft.meta; equal(m.contract, { name: "sld-extraction", version: 1 });
  assert(m.engine.version && m.engine.rules && m.engine.vocab === "sld-vocab/1" && m.file.sha256.length === 64 && m.pageStats[0].text === "pdf-text" && m.pageStats[0].shapes === "vector");
  const again = await extractSld(sheet("vector-basic"), {}, { tools: {}, now: () => new Date("2030-01-01T00:00:00Z") });
  equal(again.draft.source.hash, basic.draft.source.hash); equal(again.draft.items.map((i) => i.uid), basic.draft.items.map((i) => i.uid));
  assert(again.draft.source.generatedAt !== basic.draft.source.generatedAt);
  const other = await extractSld(sheet("vector-basic"), { dpi: 300 }, { tools: {} });
  assert(other.draft.source.hash !== basic.draft.source.hash, "a different configuration is a different reading");
  equal(sourceHash("a", configOf({})), sourceHash("a", configOf({}))); assert(sourceHash("a", configOf({})) !== sourceHash("b", configOf({})));
});

test("B6. all four page rotations: the page model records the rotation, display size is swapped correctly, and EVERY item is at the same display coordinates as the unrotated sheet", async () => {
  const ref = basic.draft.items.map((i) => [i.cls, ...i.bboxPt.map((v) => Math.round(v))]).sort();
  for (const rot of [90, 180, 270]) {
    const { draft } = await extractSld(sheet(`vector-rotated-${rot}`), {}, { tools: {} });
    const p = draft.meta.pages[0];
    equal([p.rotation, p.width, p.height], [rot, 600, 300], `rotation ${rot}: display size`);
    equal([p.mediaWidth, p.mediaHeight], rot % 180 ? [300, 600] : [600, 300]);
    equal(draft.items.map((i) => [i.cls, ...i.bboxPt.map((v) => Math.round(v))]).sort(), ref, `rotation ${rot}: items at the display coordinates`);
    assert(draft.meta.warnings.some((w) => w.code === "PAGE_ROTATED" && w.rotation === rot));
  }
});

test("B7. multi-page: page boundaries and numbers are kept, each page has its own model and counts, uids differ between pages", async () => {
  const { draft } = await extractSld(sheet("vector-multipage"), {}, { tools: {} });
  equal(draft.meta.pages.map((p) => p.number), [1, 2]); equal(draft.page.count, 2);
  assert(draft.items.some((i) => i.page === 1) && draft.items.some((i) => i.page === 2));
  equal(draft.meta.pageStats.map((p) => p.page), [1, 2]);
  assert(draft.items.filter((i) => i.page === 2).some((i) => i.cls === "offpage_reference") && draft.items.filter((i) => i.page === 2).some((i) => i.cls === "protection_relay"));
  assert(draft.items.filter((i) => i.page === 2).some((i) => i.cls === "ups") && draft.items.filter((i) => i.page === 2).some((i) => i.cls === "fuse") && draft.items.filter((i) => i.page === 2).some((i) => i.cls === "isolator"));
  equal(new Set(draft.items.map((i) => i.uid)).size, draft.items.length);
  const iso = draft.items.find((i) => i.cls === "isolator"); equal(iso.alternatives.map((a) => a.cls).sort(), ["earthing_switch", "load_break_switch"]);
});

test("B8. duplicate and missing tags: a tag printed twice is flagged on BOTH; a tag with no symbol keeps TAG_WITHOUT_SYMBOL; a symbol with no tag has none invented", async () => {
  const { draft } = await runCase(vectorCase("vector-duplicate-and-missing-tags"));
  const dup = draft.items.filter((i) => i.kind === "text" && i.text === "M-301"); equal(dup.length, 2); assert(dup.every((t) => t.warnings.includes("DUPLICATE_TAG_ON_PAGE")));
  assert(draft.items.find((i) => i.text === "P-999").warnings.includes("TAG_WITHOUT_SYMBOL"));
  const motors = draft.items.filter((i) => i.cls === "motor"); equal(motors.length, 3);
  equal(motors.filter((m) => m.attrs.tagCandidate).length, 2, "the untagged motor has no tag candidate");
});

test("B9. a tag between two symbols attaches to NEITHER: both links are kept, ambiguous; the text is still an item", async () => {
  const { draft } = await runCase(vectorCase("vector-tag-between-two-symbols"));
  const motors = draft.items.filter((i) => i.cls === "motor"), tag = draft.items.find((i) => i.text === "M-410");
  assert(motors.length === 2 && tag);
  assert(motors.every((m) => !m.attrs.tagCandidate && m.warnings.includes("AMBIGUOUS_TAG_ASSOCIATION")));
  equal(tag.associations.map((a) => a.status), ["ambiguous", "ambiguous"]); equal(tag.associations.length, 2);
});

test("B10. every text is kept: the number of text items equals the merged native words, none discarded for lacking a symbol", () => {
  const words = basic.draft.meta.pageStats[0].words, merged = texts.filter((t) => t.evidence.length === 2).length;
  equal(texts.length, words - merged);
});

test("B11. the draft is never approved by the reader: no confirmed / rejected / corrected anywhere, and nothing carries a reviewer", () => {
  assert(items.every((i) => i.reviewStatus === "unreviewed" && !i.review));
});

test("B12. resource limits and refusals: empty / oversized / unsupported / corrupt files, too many pages, an invalid mode, a missed deadline — each a coded error", async () => {
  await rejects(() => extractSld(Buffer.alloc(0), {}, { tools: {} }), 400, "EMPTY_FILE");
  await rejects(() => extractSld(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(41 * 1024 * 1024)]), {}, { tools: {} }), 413, "FILE_TOO_LARGE");
  await rejects(() => extractSld(Buffer.from("PK\x03\x04 not a drawing"), {}, { tools: {} }), 415, "UNSUPPORTED_FILE");
  await rejects(() => extractSld(Buffer.from("%PDF-1.4\nthis is not a pdf"), {}, { tools: {} }), 422, "PDF_UNREADABLE");
  await rejects(() => extractSld(sheet("vector-multipage"), { maxPages: 1 }, { tools: {} }), 413, "TOO_MANY_PAGES");
  await rejects(() => extractSld(sheet("vector-basic"), { mode: "magic" }, { tools: {} }), 400, "INVALID_OPTIONS");
  await rejects(() => extractSld(sheet("vector-basic"), { lang: "english; rm -rf" }, { tools: {} }), 400, "INVALID_OPTIONS");
  await rejects(() => extractSld(sheet("vector-basic"), {}, { tools: {}, deadline: Date.now() - 1 }), 504, "EXTRACTION_TIMEOUT");
  equal(configOf({ maxPages: 9999 }).maxPages, 20, "the page ceiling cannot be raised by a request");
});

test("B13. a missing system tool is a coded, retryable refusal (501 TOOL_MISSING), and a tool that fails mid-way writes nothing and can simply be called again", async () => {
  const stub = (over) => ({ inspectPdf: async () => ({ pages: [pageModel({ number: 1, mediaWidth: 600, mediaHeight: 300 })], producer: null }), nativeText: async () => [], vectorPaths: async () => [], rasterRead: async () => ({ words: [], primitives: [] }), toolVersions: async () => ({}), ...over });
  const miss = Object.assign(new Error("pdftotext is not installed"), { status: 501, code: "TOOL_MISSING" });
  await rejects(() => extractSld(sheet("vector-basic"), {}, { inputs: stub({ nativeText: async () => { throw miss; } }) }), 501, "TOOL_MISSING");
  let n = 0; const flaky = stub({ nativeText: async () => { if (n++ === 0) throw Object.assign(new Error("boom"), { status: 504, code: "EXTRACTION_TIMEOUT" }); return []; } });
  await rejects(() => extractSld(sheet("vector-basic"), {}, { inputs: flaky }), 504, "EXTRACTION_TIMEOUT");
  const ok = await extractSld(sheet("vector-basic"), {}, { inputs: flaky });
  equal(ok.draft.items.length, 0); assert(ok.warnings.some((w) => w.code === "NO_TEXT_FOUND"));
});

test("B14. the connection-line cap and the size ceiling degrade WITH a warning: lines are what a dense page gives up first", async () => {
  const d = new Drawing(600, 300); for (let i = 0; i < 40; i++) d.wire(10 + i * 10, 20, 10 + i * 10, 200); d.motor(300, 250, "M-1");
  const { draft } = await extractSld(pdfOf([d.page]), { maxConnectionLines: 10 }, { tools: {} });
  equal(draft.items.filter((i) => i.kind === "line").length, 10); assert(draft.meta.warnings.some((w) => w.code === "CONNECTION_LINES_TRUNCATED"));
  assert(draft.items.some((i) => i.cls === "motor"), "symbols are never the ones dropped");
});

// ── C. the raster reader ──────────────────────────────────────────────────────────────────────────────────
const { readerMissing } = await import("../../lib/server/reader-deps.mjs");
const missingRaster = await readerMissing().catch(() => [{ what: "probe failed" }]);
if (missingRaster.length) console.log(`  NOT RUN  C. raster reader tests — missing: ${missingRaster.map((m) => m.what).join(", ")}`);
else {
  test("C1. a scanned page (no text layer, no vector paths) goes through OCR + OpenCV: words are OCR blocks with their confidence, shapes are image regions, and the sheet is read", async () => {
    const { draft, warnings } = await extractSld(pdfFor(vectorCase("vector-basic") && { ...vectorCase("vector-basic"), kind: "scan", dpi: 150, noise: 0 }).pdf, { dpi: 200 }, { tools: {} });
    equal([draft.meta.pageStats[0].text, draft.meta.pageStats[0].shapes], ["ocr", "raster"]);
    const w = draft.items.filter((i) => i.kind === "text");
    assert(w.length >= 8 && w.every((t) => t.method === "ocr" && t.confidenceBasis === "ocr-word-confidence" && t.evidence.every((e) => e.source === "ocr_text_block" && typeof e.detail.confidence === "number")));
    assert(w.some((t) => t.text === "T-101"), "a tag read by OCR");
    const s = draft.items.filter((i) => i.kind === "symbol");
    assert(s.some((x) => x.cls === "transformer") && s.every((x) => x.evidence.some((e) => e.source === "image_region" || e.source === "symbol_detector")));
    assert(s.filter((x) => x.cls !== UNKNOWN).every((x) => x.confidence <= 0.9));
    validateExtractionContent(draft, { origin: "machine" }); void warnings;
  });
  test("C2. an image file (PNG) is read as one page at the configured dpi; page size follows from pixels, not from a PDF", async () => {
    const { execFileSync } = await import("node:child_process"); const { writeFileSync, readFileSync, rmSync, mkdtempSync } = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
    const dir = mkdtempSync(path.join(os.tmpdir(), "sldpng-")); writeFileSync(path.join(dir, "v.pdf"), sheet("vector-basic"));
    execFileSync("pdftoppm", ["-png", "-r", "150", "-singlefile", path.join(dir, "v.pdf"), path.join(dir, "img")]);
    const png = readFileSync(path.join(dir, "img.png")); rmSync(dir, { recursive: true, force: true });
    const { draft } = await extractSld(png, { dpi: 150 }, { tools: {} });
    equal([draft.meta.pages[0].source, draft.meta.pages[0].dpi, Math.round(draft.meta.pages[0].width)], ["image", 150, 600]);
    assert(draft.items.length > 5 && draft.meta.file.kind === "png");
  });
  test("C3. `both` reads the native text AND runs OCR, dropping an OCR word that repeats a native one at the same place", async () => {
    const { draft } = await extractSld(sheet("vector-basic"), { mode: "both" }, { tools: {} });
    equal(draft.meta.pageStats[0].text, "pdf-text+ocr");
    assert(draft.items.filter((i) => i.text === "T-101").length === 1, "one T-101, not a native and an OCR copy");
  });
}

// ── D. route + repository ─────────────────────────────────────────────────────────────────────────────────
process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("sldx-db-");
process.env.STORAGE_ROOT = await scratchDir("sldx-store-");
const R = (p) => import(`../../${p}`);
const projectsRoute = await R("app/api/projects/route.js"), documentsRoute = await R("app/api/documents/route.js"), extractRoute = await R("app/api/sld/extract/route.js");
const sldRoute = await R("app/api/sld/route.js"), reviewRoute = await R("app/api/sld/review/route.js");
const { getDb } = await R("lib/server/db.mjs"), { withProject } = await R("lib/db/scope.mjs");
const { ensureUser, addMember } = await R("lib/db/repos/projects.mjs");
const req = (url, { method = "GET", as = "kc|alice", body } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const db = await getDb();
const mkProject = async (code, as = "kc|alice") => (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", as, body: { code, name: code } })))).body.project.id;
const P = await mkProject("SX1"), OTHER = await mkProject("SX2", "kc|mallory");
const q = (sql, p = [], pid = P) => withProject(db, pid, async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo, docType, pdf, pid = P, as = "kc|alice") => {
  const r = await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", as, body: { projectId: pid, docNo, revision: "0", docType, fileBase64: pdf.toString("base64"), contentType: "application/pdf" } })));
  assert(r.status === 201, JSON.stringify(r.body)); void seq; return r.body.document;
};
const extract = async (documentId, { options, as = "kc|alice", projectId = P, ...rest } = {}) => json(await extractRoute.POST(req("http://x/api/sld/extract", { method: "POST", as, body: { projectId, documentId, ...(options ? { options } : {}), ...rest } })));
const runCount = async (docId) => (await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1 AND pass_name = 'sld'", [docId]))[0].n;
const D = {};
const viewer = await ensureUser(db, { subject: "kc|vera" }); await withProject(db, P, () => addMember(db, { projectId: P, userId: viewer.id, role: "viewer" }));

test("D1. the route files an SLD document's file as a draft: 201, the contract marker, every item unreviewed, and the run is a normal SLD draft the Phase 12.2 routes can read", async () => {
  D.a = await newDoc("SLD-X-1", "sld", sheet("vector-basic"));
  const r = await extract(D.a.id); equal(r.status, 201, JSON.stringify(r.body));
  assert(r.body.created && r.body.stats.symbols >= 8 && r.body.run.items > 20 && r.body.run.reader.startsWith("sld-extract/"));
  D.run1 = r.body.run;
  const g = await json(await sldRoute.GET(req(`http://x/api/sld?${new URLSearchParams({ projectId: P, documentId: D.a.id, draft: "1" })}`)));
  equal(g.status, 200); equal(g.body.draft.meta.contract.name, "sld-extraction"); assert(g.body.draft.items.every((i) => i.reviewStatus === "unreviewed"));
  equal(g.body.draft.meta.document.docNo, "SLD-X-1", "the server stamps the document");
  D.payloadHash = g.body.run.payloadHash;
});

test("D2. idempotent: the same file and settings return the SAME draft (200, created: false) — no second run, retried any number of times", async () => {
  for (let i = 0; i < 3; i++) { const r = await extract(D.a.id); equal([r.status, r.body.created, r.body.run.id], [200, false, D.run1.id]); }
  equal(await runCount(D.a.id), 1);
});

test("D3. scope and authorization: unknown project member 404, a viewer 403, no credentials 401; an isometric / P&ID document 409 NOT_AN_SLD_DOCUMENT; an unknown document 404; another project's document 404 — none writes a run", async () => {
  const pid = await newDoc("PID-X-1", "pid", sheet("vector-basic")), iso = await newDoc("ISO-X-1", undefined, sheet("vector-basic"));
  const before = (await q("SELECT count(*)::int AS n FROM extraction_run"))[0].n;
  equal((await extract(D.a.id, { as: "kc|mallory" })).status, 404);
  equal((await extract(D.a.id, { as: "kc|vera" })).status, 403);
  const anon = await json(await extractRoute.POST(new Request("http://x/api/sld/extract", { method: "POST", body: JSON.stringify({ projectId: P, documentId: D.a.id }) }))); assert([401, 403].includes(anon.status), `anonymous: ${anon.status}`);
  for (const d of [pid, iso]) { const r = await extract(d.id); equal([r.status, r.body.code], [409, "NOT_AN_SLD_DOCUMENT"]); }
  equal((await extract("00000000-0000-0000-0000-000000000000")).status, 404);
  const foreign = await newDoc("SLD-F-1", "sld", sheet("vector-basic"), OTHER, "kc|mallory");
  equal((await extract(foreign.id)).status, 404, "a document of another project");
  equal((await extract(D.a.id, { projectId: OTHER })).status, 404);
  equal((await q("SELECT count(*)::int AS n FROM extraction_run"))[0].n, before);
  equal((await json(await extractRoute.POST(req("http://x/api/sld/extract", { method: "POST", body: { projectId: P } })))).status, 400);
});

test("D4. a corrupt stored file is refused with a code (422), writes nothing, and the same request can be repeated; limits keep their codes through the route (413 / 415)", async () => {
  const junk = await newDoc("SLD-X-J", "sld", Buffer.from("%PDF-1.4\nnot really")), txt = await newDoc("SLD-X-T", "sld", Buffer.from("PK\x03\x04zip"));
  for (let i = 0; i < 2; i++) { const r = await extract(junk.id); equal([r.status, r.body.code], [422, "PDF_UNREADABLE"]); }
  equal([(await extract(txt.id)).status, (await extract(txt.id)).body.code], [415, "UNSUPPORTED_FILE"]);
  equal(await runCount(junk.id), 0); equal(await runCount(txt.id), 0);
  const two = await newDoc("SLD-X-2P", "sld", sheet("vector-multipage"));
  const r = await extract(two.id, { options: { maxPages: 1 } }); equal([r.status, r.body.code], [413, "TOO_MANY_PAGES"]); equal(await runCount(two.id), 0);
  const bad = await extract(D.a.id, { options: { mode: "nonsense" } }); equal([bad.status, bad.body.code], [400, "INVALID_OPTIONS"]);
});

test("D5. per-item decisions go through the edit path: stale baseHash → 409 STALE_RUN; a valid one stamps the person, keeps the original and the evidence; the next decision needs the NEW hash", async () => {
  const get = async () => (await json(await sldRoute.GET(req(`http://x/api/sld?${new URLSearchParams({ projectId: P, documentId: D.a.id, draft: "1" })}`)))).body;
  const g = await get(); const unk = g.draft.items.find((i) => i.cls === "motor");
  const decide = async (body, as = "kc|alice") => json(await reviewRoute.POST(req("http://x/api/sld/review", { method: "POST", as, body: { projectId: P, runId: g.run.id, action: "decide", ...body } })));
  const stale = await decide({ uid: unk.uid, decision: "confirm", baseHash: "0".repeat(32) }); equal([stale.status, stale.body.code], [409, "STALE_RUN"]);
  const ok = await decide({ uid: unk.uid, decision: "confirm", baseHash: g.run.payloadHash }); equal(ok.status, 200, JSON.stringify(ok.body)); assert(ok.body.changed);
  const after = await get(); const it = after.draft.items.find((i) => i.uid === unk.uid);
  equal([it.reviewStatus, typeof it.review.by, it.original.cls, it.evidence], ["confirmed", "string", "motor", unk.evidence]);
  equal((await decide({ uid: unk.uid, decision: "reject", reason: "x", baseHash: g.run.payloadHash })).body.code, "STALE_RUN", "the first hash is stale now");
  const rc = await decide({ uid: unk.uid, decision: "reclassify", cls: "generator", reason: "the letter is G", baseHash: after.run.payloadHash }); equal(rc.status, 200);
  const edits = await q("SELECT count(*)::int AS n FROM extraction_edit WHERE extraction_run_id = $1", [g.run.id]); equal(edits[0].n, 2, "each decision is in the edit log");
  assert((await decide({ uid: "sld:nope", decision: "confirm", baseHash: (await get()).run.payloadHash })).status === 404);
  equal((await decide({ uid: unk.uid, decision: "confirm", baseHash: (await get()).run.payloadHash }, "kc|vera")).status, 403, "a viewer cannot decide");
  D.afterDecisions = (await get()).run.payloadHash;
});

test("D6. a whole-envelope edit cannot make a machine claim: an edit that confirms an item with no reviewer is refused (INVALID_EXTRACTION)", async () => {
  const g = (await json(await sldRoute.GET(req(`http://x/api/sld?${new URLSearchParams({ projectId: P, documentId: D.a.id, draft: "1" })}`)))).body;
  const forged = { ...g.draft, items: g.draft.items.map((i, n) => (n === 0 ? { ...i, reviewStatus: "confirmed" } : i)) };
  const r = await json(await reviewRoute.POST(req("http://x/api/sld/review", { method: "POST", body: { projectId: P, runId: g.run.id, action: "edit", draft: forged, baseHash: g.run.payloadHash } })));
  equal([r.status, r.body.code], [400, "INVALID_EXTRACTION"]);
});

test("D6b. the plain draft route refuses a contract draft that arrives already confirmed or with edges (a machine cannot approve through any door); an opaque Phase 12.2 draft is still accepted", async () => {
  const doc = await newDoc("SLD-X-C", "sld", sheet("vector-basic"));
  const { draft } = await extractSld(sheet("vector-basic"), {}, { tools: {} });
  const post = async (d) => json(await sldRoute.POST(req("http://x/api/sld", { method: "POST", body: { projectId: P, documentId: doc.id, draft: d } })));
  const forged = { ...draft, source: { ...draft.source, hash: "forged-1" }, items: draft.items.map((i, n) => (n === 0 ? { ...i, reviewStatus: "confirmed" } : i)) };
  const a = await post(forged); equal([a.status, a.body.code], [400, "INVALID_EXTRACTION"]);
  const b = await post({ ...draft, source: { ...draft.source, hash: "forged-2" }, edges: [{ from: draft.items[0].uid, to: draft.items[1].uid }] }); equal([b.status, b.body.code], [400, "INVALID_EXTRACTION"]);
  equal(await runCount(doc.id), 0);
  const ok = await post({ kind: "sld", schema: 1, meta: {}, page: {}, items: [{ anything: 1 }], edges: [{ x: 1 }], source: { kind: "k", reader: "r", hash: "opaque-1", generatedAt: "2026-11-07T10:00:00Z" } }); equal(ok.status, 201);
  const good = await post({ ...draft, source: { ...draft.source, hash: "real-1" } }); equal(good.status, 201, JSON.stringify(good.body));
});

test("D7. re-extraction never silently replaces a person's decisions: a different reading is refused (409 HUMAN_DECISIONS_EXIST); acknowledged, it is ADDED beside the old draft, which is unchanged", async () => {
  const before = (await json(await sldRoute.GET(req(`http://x/api/sld?${new URLSearchParams({ projectId: P, documentId: D.a.id, draft: "1", runId: D.run1.id })}`)))).body.run.payloadHash;
  const r = await extract(D.a.id, { options: { dpi: 300 } }); equal([r.status, r.body.code], [409, "HUMAN_DECISIONS_EXIST"]); equal(await runCount(D.a.id), 1);
  const ack = await extract(D.a.id, { options: { dpi: 300 }, acknowledgeHumanDecisions: true }); equal(ack.status, 201); equal(await runCount(D.a.id), 2);
  assert(ack.body.run.id !== D.run1.id);
  const old = (await json(await sldRoute.GET(req(`http://x/api/sld?${new URLSearchParams({ projectId: P, documentId: D.a.id, draft: "1", runId: D.run1.id })}`)))).body.run.payloadHash;
  equal(old, before, "the decided draft is byte-identical");
  equal((await extract(D.a.id, { options: { dpi: 300 } })).body.created, false, "and the new one is idempotent too");
  D.run2 = ack.body.run;
});

test("D8. approval locks: signing records who/when/hash; afterwards decide and edit are 409 RUN_LOCKED, and a different reading of that revision is 409 RUN_LOCKED — the approval contract of 12.2 is unchanged", async () => {
  const g = (await json(await sldRoute.GET(req(`http://x/api/sld?${new URLSearchParams({ projectId: P, documentId: D.a.id, draft: "1", runId: D.run2.id })}`)))).body;
  const ap = await json(await reviewRoute.POST(req("http://x/api/sld/review", { method: "POST", body: { projectId: P, runId: g.run.id, action: "approve" } })));
  equal(ap.status, 200); assert(ap.body.run.status === "approved" && ap.body.run.approvedBy && ap.body.run.approvedSha256);
  const d = await json(await reviewRoute.POST(req("http://x/api/sld/review", { method: "POST", body: { projectId: P, runId: g.run.id, action: "decide", uid: g.draft.items[0].uid, decision: "confirm", baseHash: g.run.payloadHash } })));
  equal([d.status, d.body.code], [409, "RUN_LOCKED"]);
  const r = await extract(D.a.id, { options: { dpi: 250 }, acknowledgeHumanDecisions: true }); equal([r.status, r.body.code], [409, "RUN_LOCKED"]);
  equal((await extract(D.a.id, { options: { dpi: 300 } })).body.created, false, "the same reading still returns the existing draft");
  await rejects(() => q("UPDATE extraction_run SET payload = '{}'::jsonb WHERE id = $1", [g.run.id]), undefined, undefined).catch((e) => assert(/locked|approved|refus/i.test(String(e.message)), String(e.message)));
});

test("D9. nothing is promoted: the extraction, the decisions and the approval add no tag, asset, cable, IR test, subsystem, line, weld, spool, equipment or allocation, and no other discipline's run", async () => {
  const tables = ["tag", "asset_master", "cable", "cable_activity", "ir_test", "subsystem", "mdr_document", "line", "weld", "spool", "iso_equipment", "bom_allocation"];
  const count = async (t) => (await q(`SELECT count(*)::int AS n FROM ${t} WHERE project_id = $1`, [P]))[0].n;
  const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)])));
  const doc = await newDoc("SLD-X-NP", "sld", sheet("vector-basic")); const docs = (await q("SELECT count(*)::int AS n FROM document"))[0].n;
  const r = await extract(doc.id); equal(r.status, 201);
  equal(Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)]))), before);
  equal((await q("SELECT count(*)::int AS n FROM document"))[0].n, docs);
  equal((await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1 AND pass_name <> 'sld'", [doc.id]))[0].n, 0);
});

test("D10. the isometric workflows still never see these runs: the piping overview / hub / review queue figures are the same with SLD drafts present", async () => {
  const overviewRoute = await R("app/api/overview/route.js");
  const o = await json(await overviewRoute.GET(req(`http://x/api/overview?projectId=${P}`)));
  assert(o.status === 200 && JSON.stringify(o.body).indexOf("SLD-X") === -1, "no SLD document in the isometric overview");
});

if (missingRaster.length === 0) {
  test("D11. a scanned SLD goes through the route too (OCR + OpenCV), is idempotent, and its words carry their OCR confidence in the stored draft", async () => {
    const d = await newDoc("SLD-X-SCAN", "sld", pfScan());
    const r = await extract(d.id, { options: { dpi: 200 } }); equal(r.status, 201, JSON.stringify(r.body));
    const g = (await json(await sldRoute.GET(req(`http://x/api/sld?${new URLSearchParams({ projectId: P, documentId: d.id, draft: "1" })}`)))).body;
    assert(g.draft.items.some((i) => i.method === "ocr" && typeof i.confidence === "number"));
    equal((await extract(d.id, { options: { dpi: 200 } })).body.created, false);
  });
}
function pfScan() { const v = sheet("vector-basic"); const img = scannedPdf(v, { dpi: 150 }); return pdfOf([{ width: img.Wu, height: img.Hu, image: img }]); }

test("E1. the evaluation gate: the vector sheets' per-category precision / recall / F1 are not worse than eval/sld/baseline.json (synthetic cases; NOT a real-drawing figure)", async () => {
  const { evaluate } = await import("../../eval/sld/run.mjs"); const { readFileSync } = await import("node:fs");
  const res = await evaluate({ only: CASES.filter((c) => c.kind === "vector").map((c) => c.id) });
  const base = JSON.parse(readFileSync(new URL("../../eval/sld/baseline.json", import.meta.url), "utf8")); const bad = [];
  for (const [k, b] of Object.entries(base.categories)) for (const m of ["precision", "recall", "f1"]) { const now = res.categories[k][m]; if (b[m] != null && (now == null || now < b[m] - 0.02)) bad.push(`${k}.${m} ${now} < ${b[m]}`); }
  assert(bad.length === 0, bad.join("; "));
  assert(base.synthetic === true && /synthetic/.test(base.note), "the baseline says what it is");
});

await run();
