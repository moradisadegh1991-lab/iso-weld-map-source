#!/usr/bin/env node
/**
 * Phase 9 — spool & cut list engineering traceability (docs/audit/phase-9-spool-cutlist.md).
 * A cut piece, its two end welds and its spool are named by UID; printed numbers are labels. A legacy printed reference becomes a uid
 * only when exactly one entity of the revision has that number; otherwise it is reported, never guessed. No migration is involved.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { newUid, isUid } from "../../lib/sheet/mark-identity.mjs";
import { settleCuts, settleWeldSpools, spoolView, spoolDependents, weldDependents, assignWeldSpool, duplicateCut, editCut } from "../../lib/register/cut-identity.mjs";
import { cutIssues, cutChecks } from "../../lib/register/cut-model.mjs";
import { cutBomReport, cutVsBom } from "../../lib/register/cut-bom.mjs";
import { duplicateMark } from "../../lib/sheet/markup.mjs";
import { validate } from "../../lib/engineering/validation.mjs";
import { diffRevisions, applyCarry, CARRY_FIELDS } from "../../lib/revision/revision-diff.mjs";

const [w1, w2, w3, s1, s2] = Array.from({ length: 5 }, newUid);
const weld = (uid, no, spool, spoolUid, kind = "weld-shop", extra = {}) => ({ id: `m${no}`, uid, kind, no, x: 0.2, y: 0.2, src: "hand", attrs: { ...(spool ? { spool } : {}), ...(spoolUid ? { spoolUid } : {}) }, ...extra });
const spool = (uid, no) => ({ id: `s${no}`, uid, kind: "spool", no, x: 0.5, y: 0.5, src: "hand", attrs: {} });
const sheet = (items, cutLengths = []) => ({ sheetMarkup: { items }, cutLengths });
const base = () => [weld(w1, "W-1", "SP-1", s1), weld(w2, "W-2", "SP-1", s1), weld(w3, "W-3", "SP-2", s2, "weld-field"), spool(s1, "SP-1"), spool(s2, "SP-2")];
const codes = (list) => list.map((i) => i.code);

// ── identity ─────────────────────────────────────────────────────────────

test("I1. a piece gets one uid; a copy that repeats a uid gets a NEW one; unknown attributes survive", () => {
  const u = newUid();
  const { payload, report } = settleCuts(sheet(base(), [{ piece: 1, lengthMm: 900, legacyX: "keep" }, { piece: 2, lengthMm: 500, uid: u }, { piece: 3, lengthMm: 500, uid: u }]));
  const c = payload.cutLengths;
  assert(c.every((x) => isUid(x.uid)) && new Set(c.map((x) => x.uid)).size === 3);
  equal(c[1].uid, u, "the first holder keeps it"); assert(c[2].uid !== u);
  equal(c[0].legacyX, "keep");
  equal(report.assigned.length, 2); assert(report.assigned.some((a) => a.copied));
});

test("I2. settling twice changes nothing (identity survives save/reload)", () => {
  const once = settleCuts(sheet(base(), [{ piece: 1, lengthMm: 900, from: "W-1", to: "W-2", spool: "SP-1" }])).payload;
  const twice = settleCuts(once).payload;
  equal(JSON.stringify(twice), JSON.stringify(once));
});

test("I3. legacy printed references become uids ONLY when exactly one entity has that number", () => {
  const { payload, report } = settleCuts(sheet(base(), [{ piece: 1, lengthMm: 900, from: "W-1", to: "W-2", spool: "SP-1" }]));
  const c = payload.cutLengths[0];
  equal([c.fromUid, c.toUid, c.spoolUid], [w1, w2, s1]);
  equal(report.resolved.length, 3);
});

test("I4. legacy AMBIGUOUS references never guess: duplicate printed weld numbers leave the uid unset and say who the candidates are", () => {
  const dupWeld = weld(newUid(), "W-1", "SP-2", s2);
  const { payload, report } = settleCuts(sheet([...base(), dupWeld], [{ piece: 1, lengthMm: 900, from: "W-1", to: "W-2" }]));
  const c = payload.cutLengths[0];
  assert(!c.fromUid && c.toUid === w2, "the unique end is provable, the duplicated one is not");
  equal(report.ambiguous.length, 1); equal(report.ambiguous[0].candidates.length, 2); equal(report.ambiguous[0].field, "from");
  const issues = cutIssues(payload.cutLengths, base().concat(dupWeld));
  assert(codes(issues).includes("CUT_REF_AMBIGUOUS"));
});

test("I5. renumbering a weld keeps the piece's endpoint (same uid), only the label follows", () => {
  const settled = settleCuts(sheet(base(), [{ piece: 1, lengthMm: 900, from: "W-1", to: "W-2" }])).payload;
  const renum = { ...settled, sheetMarkup: { items: settled.sheetMarkup.items.map((m) => (m.uid === w1 ? { ...m, no: "W-10" } : m)) } };
  const after = settleCuts(renum);
  equal([after.payload.cutLengths[0].fromUid, after.payload.cutLengths[0].from], [w1, "W-10"]);
  equal(after.report.relabelled[0].to, "W-10");
  equal(cutIssues(after.payload.cutLengths, after.payload.sheetMarkup.items).filter((i) => i.level !== "info").length, 0);
});

test("I6. a duplicate printed number created AFTER the link cannot redirect it: the uid still names the original weld", () => {
  const settled = settleCuts(sheet(base(), [{ piece: 1, lengthMm: 900, from: "W-1", to: "W-2" }])).payload;
  const withDup = { ...settled, sheetMarkup: { items: [...settled.sheetMarkup.items, weld(newUid(), "W-1", "SP-2", s2)] } };
  const c = settleCuts(withDup).payload.cutLengths[0];
  equal([c.fromUid, c.from], [w1, "W-1"]);
});

test("I7. moving a weld (its place changes) changes nothing about the relationship", () => {
  const settled = settleCuts(sheet(base(), [{ piece: 1, lengthMm: 900, from: "W-1", to: "W-2" }])).payload;
  const moved = { ...settled, sheetMarkup: { items: settled.sheetMarkup.items.map((m) => (m.uid === w1 ? { ...m, x: 0.9, y: 0.9 } : m)) } };
  equal(JSON.stringify(settleCuts(moved).payload.cutLengths), JSON.stringify(settled.cutLengths));
});

test("I8. duplicate of a piece: new uid, next piece number, no operational state, engineering description copied; the original is untouched", () => {
  const u = newUid(), cuts = [{ uid: u, piece: 1, lengthMm: 900, ns: "4", fromUid: w1, toUid: w2, spoolUid: s1, status: "cut", orig: { lengthMm: 800 }, src: "extract", note: "n" }];
  const d = duplicateCut(cuts, u, 2);
  assert(isUid(d.uid) && d.uid !== u); equal([d.piece, d.lengthMm, d.fromUid, d.note, d.src], [2, 900, w1, "n", "hand"]);
  assert(!("status" in d) && !("orig" in d)); equal(cuts[0].status, "cut");
});

test("I9. edit keeps identity and unknown attributes; an extracted value that a person changes is kept in `orig` once, never overwritten", () => {
  const prev = { uid: newUid(), piece: 1, lengthMm: 900, ns: "4", legacy: 1 };
  const e1 = editCut(prev, { ...prev, lengthMm: 905 }), e2 = editCut(e1, { ...e1, lengthMm: 910 });
  equal([e2.uid, e2.legacy, e2.lengthMm, e2.orig], [prev.uid, 1, 910, { lengthMm: 900 }]);
  const hand = editCut({ ...prev, src: "hand" }, { ...prev, src: "hand", lengthMm: 1 });
  assert(!hand.orig, "a hand-made piece has no extracted value to keep");
});

// ── relationships ────────────────────────────────────────────────────────

test("R1. start/end resolution, a missing end, the same weld twice, a dangling uid (revision boundary), an unresolved number", () => {
  const items = base(), foreign = newUid();
  const r = cutIssues([
    { uid: newUid(), piece: 1, lengthMm: 900, fromUid: w1, toUid: w2, spoolUid: s1 },
    { uid: newUid(), piece: 2, lengthMm: 900, fromUid: w1 },
    { uid: newUid(), piece: 3, lengthMm: 900, fromUid: w1, toUid: w1 },
    { uid: newUid(), piece: 4, lengthMm: 900, fromUid: w1, toUid: foreign },
    { uid: newUid(), piece: 5, lengthMm: 900, from: "W-99", to: "W-2" },
  ], items);
  const by = (p) => codes(r.filter((i) => i.piece === String(p)));
  equal(by(1), []); assert(by(2).includes("CUT_END_MISSING")); assert(by(3).includes("CUT_SAME_END"));
  assert(by(4).includes("CUT_END_DANGLING")); assert(by(5).includes("CUT_END_UNRESOLVED"));
  equal(r.find((i) => i.code === "CUT_END_DANGLING").level, "error");
});

test("R2. a weld of another spool is said; a field weld with no spool is not a mismatch; either end's spool is accepted", () => {
  const items = base();
  const c = (o) => cutIssues([{ uid: newUid(), piece: 1, lengthMm: 1, ...o }], items);
  assert(codes(c({ fromUid: w1, toUid: w2, spoolUid: s2 })).includes("CUT_SPOOL_MISMATCH"));
  equal(codes(c({ fromUid: w1, toUid: w3, spoolUid: s2 })).filter((x) => x === "CUT_SPOOL_MISMATCH"), [], "spans two spools: either is accepted");
  const noSpool = [...items.filter((m) => m.uid !== w3), weld(w3, "W-3", "", null, "weld-field"), ];
  equal(codes(cutIssues([{ uid: newUid(), piece: 1, lengthMm: 1, fromUid: w3, toUid: w3 === w3 ? w2 : w1, spoolUid: s1 }], noSpool)).filter((x) => x === "CUT_SPOOL_MISMATCH"), []);
});

test("R3. an obsolete spool (uid that names no spool of this revision) is an error; an ambiguous printed spool is not guessed", () => {
  const items = base();
  assert(codes(cutIssues([{ uid: newUid(), piece: 1, lengthMm: 1, spoolUid: newUid(), spool: "SP-9" }], items)).includes("CUT_SPOOL_DANGLING"));
  const dup = [...items, spool(newUid(), "SP-1")];
  const { payload, report } = settleCuts(sheet(dup, [{ piece: 1, lengthMm: 1, spool: "SP-1" }]));
  assert(!payload.cutLengths[0].spoolUid && report.ambiguous.some((a) => a.field === "spool"));
});

test("R4. spool renumbering: welds and pieces stay members (uid), their printed spool label follows", () => {
  let p = sheet(base(), [{ piece: 1, lengthMm: 900, from: "W-1", to: "W-2", spool: "SP-1" }]);
  p = settleCuts(p).payload;
  p = { ...p, sheetMarkup: { items: p.sheetMarkup.items.map((m) => (m.uid === s1 ? { ...m, no: "SP-A" } : m)) } };
  p = settleCuts(settleWeldSpools(p).payload).payload;
  const v = spoolView(p, s1);
  equal([v.welds.map((w) => w.no).sort(), v.cuts.length, v.shop, v.field], [["W-1", "W-2"], 1, 2, 0]);
  equal(p.cutLengths[0].spool, "SP-A"); equal(v.welds[0].attrs.spool, "SP-A");
});

test("R5. spool-to-weld membership is a view of the welds' spoolUid: a weld names ONE spool; moving it keeps its uid and updates both label and uid", () => {
  const w = weld(w1, "W-1", "SP-1", s1);
  const moved = assignWeldSpool(w.attrs, spool(s2, "SP-2"));
  equal([moved.spoolUid, moved.spool], [s2, "SP-2"]);
  const p = sheet([{ ...w, attrs: moved }, weld(w2, "W-2", "SP-1", s1), spool(s1, "SP-1"), spool(s2, "SP-2")]);
  equal([spoolView(p, s1).welds.map((x) => x.uid), spoolView(p, s2).welds.map((x) => x.uid)], [[w2], [w1]]);
  equal(assignWeldSpool(moved, null).spoolUid, undefined, "no spool is allowed (a field weld need not be in one)");
});

test("R6. a legacy weld label becomes spoolUid only if unique; a renumbered spool refreshes the label; ambiguity and dangling are reported", () => {
  const items = [weld(w1, "W-1", "SP-1", null), weld(w2, "W-2", "SP-7", null), weld(w3, "W-3", "OLD", s1), spool(s1, "SP-1"), spool(s2, "SP-1")];
  const { payload, report } = settleWeldSpools(sheet(items));
  const by = (u) => payload.sheetMarkup.items.find((m) => m.uid === u).attrs;
  assert(!by(w1).spoolUid, "SP-1 is on two spools: not guessed"); equal(report.ambiguous.length, 1);
  assert(!by(w2).spoolUid, "SP-7 is on no spool");
  equal([by(w3).spoolUid, by(w3).spool], [s1, "SP-1"], "uid wins; label refreshed");
});

test("R7. deleting a spool shows what rests on it: welds and cut pieces", () => {
  const p = sheet(base(), [{ uid: newUid(), piece: 1, lengthMm: 900, spoolUid: s1 }]);
  const d = spoolDependents(p, s1);
  equal([d.welds.length, d.cuts.length, d.count], [2, 1, 3]);
  equal(weldDependents({ cutLengths: [{ fromUid: w1 }, { toUid: w1 }, { fromUid: w2 }] }, w1).count, 2);
});

test("R8. duplicating a SPOOL mark gives a new uid and owns nothing; duplicating a weld mark gets a new uid", () => {
  const items = base().map((m, i) => ({ ...m, id: `m${i}` }));
  const r = duplicateMark(items, items.find((m) => m.kind === "spool").id);
  const copy = r.items.find((m) => m.id === r.id);
  assert(copy.uid && copy.uid !== s1);
  equal(spoolView({ sheetMarkup: { items: r.items }, cutLengths: [] }, copy.uid).count, 0);
  const rw = duplicateMark(items, items.find((m) => m.uid === w1).id);
  assert(rw.items.find((m) => m.id === rw.id).uid !== w1);
});

// ── BOM ──────────────────────────────────────────────────────────────────

const PIPE = (pt, desc, diam, qty, qtyUnit = "m") => ({ pt, group: "PIPE", description: desc, diam, qty, qtyUnit });
const C = (piece, lengthMm, ns, o = {}) => ({ piece, lengthMm, ns, ...o });

test("B1. compatible pipe aggregates; pieces, total, BOM and the theoretical remainder are reported", () => {
  const bom = [PIPE(1, "PIPE SMLS A106-B SCH 40", "4", 3), PIPE(2, "PIPE SMLS A106-B SCH 40", "4", 2)];
  const r = cutBomReport([C(1, 1000, "4"), C(2, 2500, "4")], bom);
  const s = r.sizes[0];
  equal([s.pieces, s.cutM, s.bomM, s.remainingM, s.status], [2, 3.5, 5, 1.5, "ok"]);
});

test("B2. a material / schedule / size mismatch is said and the cut is NOT set against incompatible pipe", () => {
  const bom = [PIPE(1, "PIPE SMLS A106-B SCH 40", "4", 10)];
  equal(cutBomReport([C(1, 1000, "4", { material: "A312-TP304" })], bom).sizes[0].status, "mismatch");
  assert(codes(cutBomReport([C(1, 1000, "4", { material: "A312-TP304" })], bom).issues).includes("CUT_MATERIAL_MISMATCH"));
  const sch = cutBomReport([C(1, 1000, "4", { schedule: "SCH 80" })], bom);
  equal(sch.sizes[0].status, "mismatch"); assert(codes(sch.issues).includes("CUT_SCHEDULE_MISMATCH"));
  equal(cutBomReport([C(1, 1000, "6")], bom).sizes[0].status, "noBom", "another size is not the same pipe");
  equal(cutBomReport([C(1, 1000, "4", { material: "A106-B", schedule: "SCH 40" })], bom).sizes[0].status, "ok", "same grade and schedule written differently is the same");
});

test("B3. units: BOM in mm is converted; a row in pieces is not a length; a fitting is not pipe", () => {
  equal(cutBomReport([C(1, 1500, "4")], [PIPE(1, "PIPE", "4", 2000, "mm")]).sizes[0].bomM, 2);
  equal(cutBomReport([C(1, 1500, "4")], [PIPE(1, "PIPE", "4", 6, "pcs")]).sizes[0].status, "noBom");
  equal(cutBomReport([C(1, 1500, "4")], [{ pt: 1, group: "FITTINGS", description: "ELBOW", diam: "4", qty: 5, qtyUnit: "m" }]).sizes[0].status, "noBom");
});

test("B4. tolerance: the sheets' own 0.05 m rounding is accepted, more is over", () => {
  const bom = [PIPE(1, "PIPE", "4", 1)];
  equal(cutBomReport([C(1, 1050, "4")], bom).sizes[0].status, "ok");
  equal(cutBomReport([C(1, 1051, "4")], bom).sizes[0].status, "over");
});

test("B5. no double counting: the same uid twice, or the same piece twice, counts once; and groups sharing one BOM row cannot both spend it", () => {
  const u = newUid(), bom = [PIPE(1, "PIPE", "4", 1)];
  equal(cutBomReport([C(1, 800, "4", { uid: u }), C(1, 800, "4", { uid: u })], bom).sizes[0].pieces, 1);
  equal(cutBomReport([C(1, 800, "4", { from: "1", to: "2" }), C(1, 800, "4", { from: "1", to: "2" })], bom).sizes[0].pieces, 1);
  const r = cutBomReport([C(1, 700, "4", { material: "A106-B" }), C(2, 700, "4")], bom);
  assert(codes(r.issues).includes("CUT_BOM_OVER") && r.issues.some((i) => i.scope === "size"), "each group fits alone, together they exceed the one row");
  equal(cutVsBom([C(1, 700, "4")], bom).sizes[0].status, "ok", "the old entry point keeps its shape");
});

// ── validation centre ────────────────────────────────────────────────────

test("V1. the Validation Center carries the new findings with stable ids, entity uid, revision and suggested action; none is blocking", () => {
  const cu = newUid();
  const payload = { ...sheet([...base(), weld(newUid(), "W-9", "", null, "weld-shop", {})], [{ uid: cu, piece: 1, lengthMm: 900, fromUid: w1, toUid: w1, spoolUid: newUid(), ns: "4", material: "A312" }]),
    bom: [PIPE(1, "PIPE A106-B SCH 40", "4", 5)] };
  const r = validate({ payload, revision: { documentId: "d1", docNo: "D", rev: "1" }, source: "saved", saved: { equipment: [], ledger: { rows: [], lines: [] }, warnings: [] } });
  const f = (c) => r.findings.filter((x) => x.code === c);
  for (const c of ["CUT_SAME_END", "CUT_SPOOL_DANGLING", "CUT_MATERIAL_MISMATCH"]) assert(f(c).length, c);
  const same = f("CUT_SAME_END")[0];
  assert(same.entityUid === cu && same.suggestedAction === "cut-form" && same.revision.documentId === "d1" && same.id.startsWith("CUT_SAME_END:"));
  assert(r.findings.filter((x) => x.code.startsWith("CUT_")).every((x) => x.blocking === false));
  equal(new Set(r.findings.map((x) => x.id)).size, r.findings.length, "ids are unique");
  const draft = validate({ payload, revision: {}, source: "draft" });
  assert(draft.findings.find((x) => x.code === "CUT_MATERIAL_MISMATCH").detail.preview === true, "a draft calculation is labelled a preview");
});

test("V2. cutChecks keeps its old contract (text, warnings and worse only)", () => {
  const t = cutChecks([{ piece: 1, from: "W-1", to: "W-1" }], base());
  equal(t.length, 1); assert(/یک سرجوش است/.test(t[0]));
});


// ── revisions (pure) ─────────────────────────────────────────────────────

const [a1, a2, as1, b1, b2, bs1, ca1, ca2, ca3, cb1, cb2] = Array.from({ length: 11 }, newUid);
const revA = () => ({ payload: { ...sheet([weld(a1, "W-1", "SP-1", as1), weld(a2, "W-2", "SP-1", as1), spool(as1, "SP-1")], [
  { uid: ca1, piece: 1, lengthMm: 900, ns: "4", material: "A106-B", schedule: "SCH 40", angle: "45", note: "n", from: "W-1", to: "W-2", fromUid: a1, toUid: a2, spool: "SP-1", spoolUid: as1 },
  { uid: ca2, piece: 2, lengthMm: 500, ns: "4" }, { uid: ca3, piece: 3, lengthMm: 700, ns: "4" }]), bom: [] } });
const revB = (cuts, items) => ({ payload: { ...sheet(items || [weld(b1, "W-1", "SP-9", bs1), weld(b2, "W-2", "SP-9", bs1), spool(bs1, "SP-9")], cuts), bom: [] } });
const cutChange = (r, pred) => r.changes.find((c) => c.cls === "cut" && pred(c));

test("T1. cut pieces: added, removed, and NOTHING paired by length, position or size — only a unique printed piece number is a CANDIDATE", () => {
  const r = diffRevisions({ from: revA(), to: revB([{ uid: cb1, piece: 7, lengthMm: 900, ns: "4" }]), mappings: [], cutPairs: [] });
  const k = r.changes.filter((c) => c.cls === "cut").map((c) => c.kind).sort();
  equal(k, ["added", "removed", "removed", "removed"], "same length and size is not identity");
  const cand = diffRevisions({ from: revA(), to: revB([{ uid: cb1, piece: 1, lengthMm: 905, ns: "4" }]) });
  const c = cutChange(cand, (x) => x.kind === "candidate");
  assert(c && c.requiresReview && c.action === "confirm" && c.fromUid === ca1 && c.toUid === cb1);
});

test("T2. duplicated printed piece numbers are AMBIGUOUS and nothing is offered as ready", () => {
  const f = revA(); f.payload.cutLengths.push({ uid: newUid(), piece: 1, lengthMm: 10, ns: "2" });
  const r = diffRevisions({ from: f, to: revB([{ uid: cb1, piece: 1, lengthMm: 900, ns: "4" }]) });
  const amb = r.changes.filter((c) => c.cls === "cut" && c.kind === "ambiguous");
  equal(amb.length, 1); assert(amb[0].candidates.from.length === 2 && amb[0].candidates.to.length === 1 && amb[0].requiresReview);
  assert(!r.changes.some((c) => c.cls === "cut" && (c.kind === "candidate" || c.kind === "modified")));
});

test("T3. an explicit pair compares length / size / material / schedule / angle; endpoint and spool changes use the weld and spool MAPPINGS (uids), not numbers", () => {
  const maps = [{ cls: "weld", fromUid: a1, toUid: b1 }, { cls: "weld", fromUid: a2, toUid: b2 }, { cls: "spool", fromUid: as1, toUid: bs1 }];
  // same relationships, everything renumbered: no endpoint / spool change is reported
  const same = diffRevisions({ from: revA(), to: revB([{ uid: cb1, piece: 11, lengthMm: 900, ns: "4", material: "A106-B", schedule: "SCH 40", angle: "45", note: "n", fromUid: b1, toUid: b2, spoolUid: bs1, from: "W-1", to: "W-2", spool: "SP-9" }]), mappings: maps, cutPairs: [{ fromUid: ca1, toUid: cb1 }] });
  const c0 = cutChange(same, (x) => x.fromUid === ca1);
  equal(c0.fields.map((f) => f.field), ["piece"], "only the printed piece number differs: identity held by the pair");
  // endpoints swapped to the other weld + a new spool + other length / material
  const diff = diffRevisions({ from: revA(), to: revB([{ uid: cb1, piece: 1, lengthMm: 950, ns: "6", material: "A312", schedule: "SCH 80", angle: "30", note: "n", fromUid: b2, toUid: b1, spoolUid: newUid() }]), mappings: maps, cutPairs: [{ fromUid: ca1, toUid: cb1 }] });
  const c = cutChange(diff, (x) => x.fromUid === ca1);
  for (const f of ["lengthMm", "ns", "material", "schedule", "angle", "from", "to", "spool"]) assert(c.fields.some((x) => x.field === f), `${f} in ${c.fields.map((x) => x.field)}`);
});

test("T4. a mapped weld whose spool relationship changed (by uid) is its own finding", () => {
  const f = revA(), t = revB([], [weld(b1, "W-1", "SP-9", newUid()), spool(newUid(), "SP-9")]);
  t.payload.sheetMarkup.items.push(spool(bs1, "SP-1"));
  const r = diffRevisions({ from: f, to: t, mappings: [{ cls: "weld", fromUid: a1, toUid: b1 }, { cls: "spool", fromUid: as1, toUid: bs1 }] });
  assert(r.changes.some((c) => c.id === `rel:spool:${a1}` && c.category === "spool"));
});

test("T5. carry plan: descriptive fields only into EMPTY target fields; the target's own length / piece / uid are never carried; refs only through mappings", () => {
  const maps = [{ cls: "weld", fromUid: a1, toUid: b1 }, { cls: "spool", fromUid: as1, toUid: bs1 }];
  const t = revB([{ uid: cb1, piece: 1, lengthMm: 999, ns: "4", note: "mine" }]);
  const r = diffRevisions({ from: revA(), to: t, mappings: maps, cutPairs: [{ fromUid: ca1, toUid: cb1 }] });
  const c = cutChange(r, (x) => x.fromUid === ca1);
  equal(c.carry.ready.map((x) => x.field).sort(), ["angle", "from", "material", "schedule", "spool"].sort());
  assert(c.carry.blocked.some((x) => x.field === "note" && x.reason === "TARGET_HAS_VALUE"));
  assert(c.carry.blocked.some((x) => x.field === "to" && x.reason === "NO_MAPPED_WELD"), "W-2 has no mapping: not carried");
  assert(!CARRY_FIELDS.cut.includes("lengthMm") && !CARRY_FIELDS.cut.includes("piece") && !CARRY_FIELDS.cut.includes("uid"));
  assert(c.carry.ready.find((x) => x.field === "from").value === b1 && c.carry.ready.find((x) => x.field === "spool").value === bs1);
});

test("T6. applyCarry for a piece: fills only the named fields, sets the TARGET's uid and refreshes the printed label; the rest is untouched", () => {
  const t = revB([{ uid: cb1, piece: 1, lengthMm: 999, ns: "4", legacy: "x" }]).payload;
  const out = applyCarry(t, [{ klass: "cut", toUid: cb1, values: { material: "A106-B", from: b1, spool: bs1 } }]);
  const c = out.cutLengths[0];
  equal([c.material, c.fromUid, c.from, c.spoolUid, c.spool, c.lengthMm, c.piece, c.legacy, c.uid], ["A106-B", b1, "W-1", bs1, "SP-9", 999, 1, "x", cb1]);
  equal(t.cutLengths[0].material, undefined, "the input is not mutated");
});

test("T7. a carried pair of pieces that would make both ends the same weld is not offered", () => {
  const f = revA(); f.payload.cutLengths[0].toUid = a1;
  const r = diffRevisions({ from: f, to: revB([{ uid: cb1, piece: 1, lengthMm: 900, ns: "4" }]), mappings: [{ cls: "weld", fromUid: a1, toUid: b1 }], cutPairs: [{ fromUid: ca1, toUid: cb1 }] });
  const c = cutChange(r, (x) => x.fromUid === ca1);
  assert(c.carry.blocked.some((x) => x.reason === "SAME_END") && !c.carry.ready.some((x) => x.field === "from" || x.field === "to"));
});

// ── the server: save / reload / renumber / revision boundary ─────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("p9-db-");
process.env.STORAGE_ROOT = await scratchDir("p9-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const runRoute = await import("../../app/api/runs/[id]/route.js");
const validationRoute = await import("../../app/api/validation/route.js");
const revRoute = await import("../../app/api/revisions/route.js");
const carryRoute = await import("../../app/api/revisions/carry/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const db = await getDb();
const projectId = (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "P9", name: "P9" } })))).body.project.id;
const q = (sql, p = []) => withProject(db, projectId, async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo, revision = "0") => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", body: { projectId, docNo, revision, fileBase64: Buffer.from(`scan ${docNo} ${revision} ${++seq}`).toString("base64") } })))).body.document.id;
const R = (no, o = {}) => ({ no, spool: "SP-1", loc: "Shop", kind: "BW", nps: "4", ...o });
const mk = (rows, items, cutLengths, bom = [PIPE(1, "PIPE SMLS A106-B SCH 40", "4", 10)]) => ({ meta: { drawingNo: "P9-1", sheet: "1/1", lineNo: "P9-L1", nps: 4 }, weldList: rows, bom, sheetMarkup: { page: 1, items }, cutLengths });
const post = async (documentId, payload) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "P9-L1", payload } })));
const latest = async (doc) => (await q("SELECT payload, id FROM extraction_run WHERE document_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [doc]))[0];
const validationOf = async (doc) => json(await validationRoute.GET(req(`http://x/api/validation?projectId=${projectId}&documentId=${doc}`)));
const D = { a: null, b: null }, U = { w1: newUid(), w2: newUid(), s1: newUid(), cut: newUid() };

test("S1. save: legacy printed refs are settled on the server; the piece, its two welds and its spool carry uids; unknown attributes survive", async () => {
  D.a = await newDoc("P9-X");
  const r = await post(D.a, mk([R("W-1", { uid: U.w1 }), R("W-2", { uid: U.w2 })], [spool(U.s1, "SP-1")], [{ piece: 1, lengthMm: 900, ns: "4", from: "W-1", to: "W-2", spool: "SP-1", legacyX: "keep" }]));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const p = (await latest(D.a)).payload, c = p.cutLengths[0];
  assert(isUid(c.uid)); equal([c.fromUid, c.toUid, c.spoolUid, c.legacyX], [U.w1, U.w2, U.s1, "keep"]);
  U.cut = c.uid;
  const w = p.weldList.find((x) => x.no === "W-1");
  equal(w.spoolUid, U.s1, "the typed weld row is tied to its spool by uid too");
});

test("S2. reload and save again: the piece keeps its uid (save/reload), nothing is duplicated", async () => {
  const p = (await latest(D.a)).payload;
  equal((await post(D.a, p)).status, 201);
  const p2 = (await latest(D.a)).payload;
  equal([p2.cutLengths.length, p2.cutLengths[0].uid], [1, U.cut]);
});

test("S3. renumber a weld and the spool, then save: the relationships hold (same uids), labels follow", async () => {
  const p = (await latest(D.a)).payload;
  const next = { ...p, weldList: p.weldList.map((r) => (r.uid === U.w1 ? { ...r, no: "W-10" } : r)), sheetMarkup: { ...p.sheetMarkup, items: p.sheetMarkup.items.map((m) => (m.uid === U.s1 ? { ...m, no: "SP-A" } : m)) } };
  equal((await post(D.a, next)).status, 201);
  const q2 = (await latest(D.a)).payload, c = q2.cutLengths[0];
  equal([c.uid, c.fromUid, c.from, c.toUid, c.spoolUid, c.spool], [U.cut, U.w1, "W-10", U.w2, U.s1, "SP-A"]);
  assert(q2.weldList.every((r) => r.spoolUid === U.s1 && r.spool === "SP-A"), "membership intact, label refreshed on both welds");
  const v = await validationOf(D.a);
  equal(v.status, 200, JSON.stringify(v.body).slice(0, 200));
  assert(!v.body.findings.some((f) => /^CUT_(END|SPOOL|SAME|REF)/.test(f.code) && f.severity !== "info"), JSON.stringify(v.body.findings.filter((f) => f.code.startsWith("CUT_")).map((f) => f.code)));
});

test("S4. revision boundary: a piece that carries a weld uid of ANOTHER revision is dangling there, never silently re-pointed", async () => {
  D.b = await newDoc("P9-X", "1");
  const wb = newUid(), sb = newUid();
  const leaked = [{ uid: newUid(), piece: 1, lengthMm: 900, ns: "4", fromUid: U.w1, toUid: wb, spoolUid: sb, from: "W-10", to: "W-2" }];
  const r = await post(D.b, mk([R("W-2", { uid: wb })], [spool(sb, "SP-1")], leaked));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const c = (await latest(D.b)).payload.cutLengths[0];
  equal([c.fromUid, c.toUid], [U.w1, wb], "kept as written, not cleaned up, not re-resolved by number");
  const v = await validationOf(D.b);
  assert(v.body.findings.some((f) => f.code === "CUT_END_DANGLING" && f.severity === "error" && f.blocking === false));
});

test("S5. a legacy ambiguous reference is saved as it is (no uid) and stays a structured finding", async () => {
  const doc = await newDoc("P9-Y");
  const a = newUid(), b = newUid();
  const r = await post(doc, mk([R("W-1", { uid: a }), R("W-2", { uid: b })], [spool(newUid(), "SP-1"), spool(newUid(), "SP-1")], [{ piece: 1, lengthMm: 900, ns: "4", from: "W-1", to: "W-2", spool: "SP-1" }]));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const c = (await latest(doc)).payload.cutLengths[0];
  assert(isUid(c.fromUid) && isUid(c.toUid) && !c.spoolUid, "welds are unique, the two SP-1 are not guessed");
  const pw = (await latest(doc)).payload.weldList;
  assert(pw.every((x) => !x.spoolUid), "the weld rows' printed SP-1 is ambiguous too: not guessed");
  const v = await validationOf(doc);
  assert(v.body.findings.some((f) => f.code === "WELD_SPOOL_AMBIGUOUS"));
  assert(v.body.findings.some((f) => f.code === "CUT_REF_AMBIGUOUS" && f.detail.field === "spool" && f.detail.candidates.length === 2));
});

const compare = async (from, to) => json(await revRoute.GET(req(`http://x/api/revisions?projectId=${projectId}&documentId=${from}&compareTo=${to}`)));
const carry = async (body) => json(await carryRoute.POST(req("http://x/api/revisions/carry", { method: "POST", body: { projectId, ...body } })));
const X = { a: null, b: null, wa1: newUid(), wa2: newUid(), sa: newUid(), wb1: newUid(), wb2: newUid(), sb: newUid() };

test("S6. revisions: compare finds the piece as a CANDIDATE; confirming it + its welds + spool carries the descriptive fields and the target's own uids, once", async () => {
  X.a = await newDoc("P9-R");
  equal((await post(X.a, mk([R("W-1", { uid: X.wa1 }), R("W-2", { uid: X.wa2 })], [spool(X.sa, "SP-1")], [{ piece: 1, lengthMm: 900, ns: "4", material: "A106-B", schedule: "SCH 40", angle: "45", from: "W-1", to: "W-2", spool: "SP-1" }]))).status, 201);
  const cA = (await latest(X.a)).payload.cutLengths[0];
  const mkRevision = await json(await revRoute.POST(req("http://x/api/revisions", { method: "POST", body: { projectId, action: "create", sourceDocumentId: X.a, revision: "1", noFile: true } })));
  equal(mkRevision.status, 201, JSON.stringify(mkRevision.body)); X.b = mkRevision.body.document.id;
  equal((await post(X.b, mk([R("W-1", { uid: X.wb1 }), R("W-2", { uid: X.wb2 })], [spool(X.sb, "SP-1")], [{ piece: 1, lengthMm: 905, ns: "4" }]))).status, 201);
  const cB = (await latest(X.b)).payload.cutLengths[0];
  X.cA = cA.uid; X.cB = cB.uid;
  assert(isUid(cA.uid) && isUid(cB.uid) && cA.uid !== cB.uid, "each revision's piece has its own identity");
  const cmp = await compare(X.a, X.b);
  equal(cmp.status, 200, JSON.stringify(cmp.body).slice(0, 300));
  const c = cmp.body.changes.find((x) => x.cls === "cut");
  equal([c.kind, c.fromUid, c.toUid, c.requiresReview], ["candidate", cA.uid, cB.uid, true]);
  X.hashes = { fromHash: cmp.body.from.hash, toHash: cmp.body.to.hash };
  X.beforeA = JSON.stringify((await latest(X.a)).payload);
});

test("S7. carry: pair confirmed explicitly, endpoints go through the weld mappings, the target's length stays, the source revision is untouched", async () => {
  const wk = (u) => `weld:${u}`;
  const r = await carry({ fromDocumentId: X.a, toDocumentId: X.b, ...X.hashes, requestKey: "p9-carry-0001", decisions: [
    { key: wk(X.wa1), pair: { fromUid: X.wa1, toUid: X.wb1 } }, { key: wk(X.wa2), pair: { fromUid: X.wa2, toUid: X.wb2 } }, { key: `spool:${X.sa}`, pair: { fromUid: X.sa, toUid: X.sb } },
    { key: `cut:${X.cA}`, pair: { fromUid: X.cA, toUid: X.cB }, fields: ["material", "schedule", "angle", "from", "to", "spool"] }] });
  equal(r.status, 200, JSON.stringify(r.body).slice(0, 400));
  assert(r.body.mapped.some((m) => m.cls === "cut" && m.fromUid === X.cA && m.toUid === X.cB));
  const c = (await latest(X.b)).payload.cutLengths[0];
  equal([c.uid, c.lengthMm, c.material, c.schedule, c.angle, c.fromUid, c.toUid, c.spoolUid, c.from, c.to, c.spool], [X.cB, 905, "A106-B", "SCH 40", "45", X.wb1, X.wb2, X.sb, "W-1", "W-2", "SP-1"]);
  equal(JSON.stringify((await latest(X.a)).payload), X.beforeA, "the previous revision is never changed");
  const ops = await q("SELECT summary FROM revision_carry_op WHERE to_document_id = $1", [X.b]);
  equal(ops[0].summary.cutPairs.map((x) => [x.fromUid, x.toUid]), [[X.cA, X.cB]]);
  const maps = await q("SELECT cls FROM revision_carry_map WHERE to_document_id = $1 ORDER BY cls", [X.b]);
  equal(maps.map((m) => m.cls), ["spool", "weld", "weld"], "no 'cut' row: the table does not admit one (no migration in this phase)");
});

test("S8. the same request again records nothing new; the pair is now an identity: comparing shows a mapped, modified piece (length differs), not a candidate", async () => {
  const again = await carry({ fromDocumentId: X.a, toDocumentId: X.b, ...X.hashes, requestKey: "p9-carry-0001", decisions: [] });
  equal([again.status, again.body.repeated], [200, true]);
  const cmp = await compare(X.a, X.b);
  const c = cmp.body.changes.find((x) => x.cls === "cut");
  equal(c.kind, "modified"); assert(c.fields.some((f) => f.field === "lengthMm") && !c.fields.some((f) => ["from", "to", "spool"].includes(f.field)));
  const v = await validationOf(X.b);
  assert(!v.body.findings.some((f) => f.code === "REV_UNRESOLVED_MAP" && /قطعه/.test(f.message || "") ));
});

test("S9. a second confirmation of the same pair, or a stale hash, changes nothing", async () => {
  const cmp = await compare(X.a, X.b);
  const dupe = await carry({ fromDocumentId: X.a, toDocumentId: X.b, fromHash: cmp.body.from.hash, toHash: cmp.body.to.hash, requestKey: "p9-carry-0002", decisions: [{ key: `cut:${X.cA}`, pair: { fromUid: X.cA, toUid: X.cB } }] });
  equal(dupe.status, 409, JSON.stringify(dupe.body).slice(0, 200));
  const stale = await carry({ fromDocumentId: X.a, toDocumentId: X.b, fromHash: "stale", toHash: cmp.body.to.hash, requestKey: "p9-carry-0003", decisions: [{ key: `cut:${X.cA}`, fields: ["note"] }] });
  equal(stale.status, 409); equal(stale.body.code, "STALE_SOURCE");
});

await run();
