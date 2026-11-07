#!/usr/bin/env node
/**
 * Phase 7 — the engineering validation engine (lib/engineering/validation.mjs), pure.
 * Every category and the rules the phase names: findings carry a persistent uid (never only the printed number), computed from the
 * existing rules, nothing repaired; stored warnings are the only resolvable ones.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { newUid } from "../../lib/sheet/mark-identity.mjs";
import { validate, summarize, CATALOG, CATEGORIES, SEVERITIES } from "../../lib/engineering/validation.mjs";

const R = (no, extra = {}) => ({ no, spool: "SP-1", loc: "Shop", kind: "BW", nps: "4", ...extra });
const BOM = [{ pt: 2, description: "FLANGE WN RF 300# A105", diam: "4", qty: 2, qtyUnit: "pcs" },
  { pt: 1, description: "PIPE SMLS A106 B", diam: "4", qty: 12, qtyUnit: "m" },
  { pt: 7, description: "VALVE GATE", diam: "4", qty: 1, qtyUnit: "pcs" }];
const codes = (r) => r.findings.map((f) => f.code);
const has = (r, code) => r.findings.filter((f) => f.code === code);
const mark = (kind, no, extra = {}) => ({ id: `m-${no}-${kind}`, uid: newUid(), kind, no, x: 0.2, y: 0.2, attrs: {}, ...extra });
const V = (payload, o = {}) => validate({ payload, revision: { documentId: "d1", docNo: "ISO-1", rev: "A", runId: "r1", ...(o.revision || {}) }, saved: o.saved === undefined ? { equipment: [], ledger: { rows: [], lines: [] }, warnings: [] } : o.saved, source: o.source || "saved" });

test("the catalog is well formed: every code has a known category, severity and an action", () => {
  for (const [code, [cat, sev, title, action]] of Object.entries(CATALOG)) {
    assert(CATEGORIES.includes(cat), `${code} category`); assert(SEVERITIES.includes(sev), `${code} severity`);
    assert(title && action, `${code} title/action`);
  }
  for (const c of CATEGORIES) assert(Object.values(CATALOG).some((v) => v[0] === c), `category ${c} has at least one rule`);
});

test("finding shape: id, code, category, severity, entity, uid, revision, source, resolved, blocking", () => {
  const u = newUid();
  const r = V({ weldList: [{ ...R("1", { c1: "99" }), uid: u }], bom: BOM });
  const f = has(r, "W_PT_MISSING")[0];
  assert(f, "missing PT found");
  for (const k of ["id", "code", "category", "severity", "entityType", "entityUid", "entityNumber", "title", "message", "suggestedAction", "source", "revision", "resolved", "blocking"]) assert(k in f, `has ${k}`);
  equal([f.entityUid, f.entityNumber, f.category, f.severity, f.revision.docNo], [u, "1", "weld", "error", "ISO-1"]);
  assert(/^saved:/.test(f.source));
});

test("identity: a typed weld without a valid uid, a duplicate uid", () => {
  const u = newUid();
  const r = V({ weldList: [R("1"), { ...R("2"), uid: u }, { ...R("3"), uid: u }], bom: BOM });
  assert(codes(r).includes("ID_NO_UID"), "no uid");
  const dup = has(r, "ID_DUP_UID");
  equal(dup.length, 1); equal(dup[0].entityUid, u); equal(dup[0].category, "identity");
});

test("weld: duplicate printed number, empty number, bad location, missing kind/nps, shop weld without spool — each names the row's uid", () => {
  const a = newUid(), b = newUid(), c = newUid();
  const r = V({ weldList: [{ ...R("5"), uid: a }, { ...R("5"), uid: b }, { ...R(""), uid: c, loc: "Mars", kind: "", nps: "", spool: "" }], bom: BOM });
  const d = has(r, "W_DUP_NUMBER"); assert(d.length >= 1, "dup number");
  assert(d.every((f) => f.blocking && f.severity === "error"));
  for (const code of ["W_NO_NUMBER", "W_BAD_LOC", "W_NO_KIND", "W_NO_NPS"]) assert(has(r, code).some((f) => f.entityUid === c), code);
});

test("weld: components — none is info, one is info, a PT not in the BOM is an error that names the PT", () => {
  const a = newUid(), b = newUid(), c = newUid();
  const r = V({ weldList: [{ ...R("1"), uid: a }, { ...R("2", { c1: "2" }), uid: b }, { ...R("3", { c1: "2", c2: "88" }), uid: c }], bom: BOM });
  assert(has(r, "W_NO_COMPONENT").some((f) => f.entityUid === a && f.severity === "info"));
  assert(has(r, "W_ONE_COMPONENT").some((f) => f.entityUid === b), "one component is not an error");
  const miss = has(r, "W_PT_MISSING"); equal(miss.length, 1); equal(miss[0].detail.pt, "88"); equal(miss[0].entityUid, c);
});

test("weld: a changed BOM row and a size mismatch are warnings", () => {
  const a = newUid();
  const r = V({ weldList: [{ ...R("1", { c1: "2", c1s: "OLD DESCRIPTION", nps: "10" }), uid: a }], bom: BOM });
  assert(has(r, "W_PT_CHANGED").length === 1, "snapshot differs");
  assert(has(r, "W_SIZE_MISMATCH").length === 1, "4\" part vs 10\" weld");
});

test("allocation: capacity exceeded in the live preview is blocking, labelled preview", () => {
  const rows = [1, 2, 3].map((n) => ({ ...R(String(n), { c1: "2" }), uid: newUid() }));        // PT 2 has 2 pcs → 2 weld ends? 3 welds want it
  const r = V({ weldList: rows, bom: [{ pt: 2, description: "FLANGE WN BW", diam: "4", qty: 1, qtyUnit: "pcs" }] });
  const over = has(r, "A_OVER_CAPACITY");
  assert(over.length === 1, JSON.stringify(codes(r)));
  assert(over[0].blocking && /پیش‌نمایش/.test(over[0].message) && /preview/.test(over[0].source));
});

test("BOM rows: duplicate PT, missing PT, missing description, invalid quantity, bad unit, missing size", () => {
  const r = V({ bom: [{ pt: 1, description: "A", qty: 1 }, { pt: 1, description: "B", qty: 1 }, { description: "C", qty: 1 }, { pt: 4, qty: 1 }, { pt: 5, description: "D", qty: -3 }, { pt: 6, description: "E", qty: 1, qtyUnit: "kg" },
    { pt: 9, description: "PIPE SMLS", qty: 5, qtyUnit: "m" }] });
  for (const code of ["B_DUP_PT", "B_NO_PT", "B_NO_DESC", "B_QTY_INVALID", "B_BAD_UNIT", "B_NO_SIZE"]) assert(codes(r).includes(code), code);
  equal(has(r, "B_DUP_PT").every((f) => f.entityType === "bom-row"), true);
});

test("equipment: no uid, no tag/type/PT, bad PT, no weld, dangling weld ref (blocking), ambiguous legacy number, accessories", () => {
  const w1 = { ...R("5"), uid: newUid() }, w2 = { ...R("5"), uid: newUid() }, gone = newUid();
  const noUid = mark("equipment", "E-1", { uid: undefined, attrs: {} }), bad = mark("equipment", "E-2", { attrs: { tag: "T", type: "valve", c1: "55", weldRefs: gone, acc: "88×1" } });
  const amb = mark("equipment", "E-3", { attrs: { tag: "T3", type: "valve", c1: "7", welds: "5" } });
  const r = V({ weldList: [w1, w2], bom: BOM, sheetMarkup: { items: [noUid, bad, amb] } });
  for (const code of ["E_NO_UID", "E_NO_TAG", "E_NO_TYPE", "E_NO_PT", "E_BAD_PT", "E_NO_WELD", "E_WELD_DANGLING", "E_WELD_AMBIGUOUS", "E_NO_ACC", "E_ACC_PT"]) assert(codes(r).includes(code), `${code} in ${codes(r)}`);
  const d = has(r, "E_WELD_DANGLING")[0]; assert(d.blocking && d.detail.weldUid === gone && d.entityUid === bad.uid);
  const a = has(r, "E_WELD_AMBIGUOUS")[0]; assert(a.entityUid === amb.uid && a.detail.weldNo === "5", "the ambiguous number is reported, no weld is linked");
});

test("equipment: accessories asking more than the BOM has are blocking", () => {
  const e1 = mark("equipment", "E-1", { attrs: { tag: "A", type: "valve", c1: "7", acc: "7×1" } }), e2 = mark("equipment", "E-2", { attrs: { tag: "B", type: "valve", c1: "7" } });
  const r = V({ bom: BOM, sheetMarkup: { items: [e1, e2] } });
  const f = has(r, "E_ACC_QTY"); assert(f.length === 1 && f[0].blocking, JSON.stringify(codes(r)));
});

test("spool/support come only from real marks: unnamed, duplicate, empty spool, support without type", () => {
  const r = V({ bom: BOM, sheetMarkup: { items: [mark("spool", "SP-1"), mark("spool", "SP-1"), mark("spool", ""), mark("support", "S-1"), mark("support", "S-1"), mark("support", "")] } });
  for (const code of ["SP_NO_NUMBER", "SP_DUP", "SP_EMPTY", "SUP_NO_NUMBER", "SUP_DUP", "SUP_NO_TYPE"]) assert(codes(r).includes(code), code);
  const none = V({ bom: BOM, sheetMarkup: { items: [] } });
  assert(!codes(none).some((c) => /^(SP|SUP)_/.test(c)), "nothing is invented when the sheet has no spools/supports");
});

test("geometry: an unplaced weld only when some welds are placed; an unplaced mark is info", () => {
  const a = { ...R("1"), uid: newUid() }, b = { ...R("2"), uid: newUid() };
  const none = V({ weldList: [a, b], bom: BOM });
  assert(!codes(none).includes("G_NOT_PLACED"), "no placement at all is not a finding");
  const some = V({ weldList: [a, b], bom: BOM, weldMarkup: { byUid: { [a.uid]: { x: 0.1, y: 0.1 } } } });
  const g = has(some, "G_NOT_PLACED"); equal(g.length, 1); equal(g[0].entityUid, b.uid); equal(g[0].severity, "info");
  assert(has(V({ bom: BOM, sheetMarkup: { items: [mark("spool", "SP-1", { x: null, y: null })] } }), "G_MARK_NOT_PLACED").length === 1);
});

test("an unlinked sheet weld mark is an explicit finding with its uid, number and attributes — never matched by number or position", () => {
  const u = newUid(), orphan = newUid();
  const sheetWeld = mark("weld-shop", "1", { uid: orphan, attrs: { c1: "2" } });
  const r = V({ weldList: [{ ...R("1", { c1: "2" }), uid: u }], bom: BOM, sheetMarkup: { items: [sheetWeld] } });
  const f = has(r, "W_UNLINKED"); equal(f.length, 1);
  equal([f[0].entityUid, f[0].entityNumber, f[0].entityType, f[0].suggestedAction], [orphan, "1", "sheet-weld-mark", "drawing"]);
  equal(f[0].detail.attrs.c1, "2"); assert(!has(r, "A_OVER_CAPACITY").length, "it holds nothing");
});

test("the same weld as typed row and sheet mark is not a duplicate uid, only an info note when the mark also carries components", () => {
  const u = newUid();
  const r = V({ weldList: [{ ...R("1", { c1: "2", c2: "2" }), uid: u }], bom: BOM, sheetMarkup: { items: [mark("weld-shop", "1", { uid: u, attrs: { c1: "2" } })] } });
  assert(!codes(r).includes("ID_DUP_UID"), "same weld, one identity");
  assert(!codes(r).includes("W_UNLINKED"));
});

test("saved state: ledger over capacity (reserved + installed), installed over capacity", () => {
  const saved = { equipment: [], warnings: [], ledger: { lines: [], rows: [{ pt: 2, weldEnds: 2, weldReserved: 2, weldInstalled: 3, qty: 2, reserved: 0, installed: 0 }, { pt: 7, qty: 1, reserved: 1, installed: 1, weldEnds: null }] } };
  const r = V({ bom: BOM }, { saved });
  assert(has(r, "A_SAVED_OVER").length >= 2, JSON.stringify(codes(r)));
  assert(has(r, "A_INSTALLED_OVER").length >= 1);
  assert(has(r, "A_ROW_HELD").length === 2, "rows with active allocations are noted");
});

test("saved state: a BOM row removed or shrunk below its held allocation, an installed line without an owner — blocking, no release", () => {
  const owner = newUid(), ghost = newUid();
  const lines = [{ id: "l1", pt: 99, ownerKind: "weld", ownerRef: owner, qty: 1, status: "reserved", ownerNo: "1" },
    { id: "l2", pt: 2, ownerKind: "weld", ownerRef: owner, qty: 3, status: "reserved", ownerNo: "1" },
    { id: "l3", pt: 7, ownerKind: "weld", ownerRef: ghost, qty: 1, status: "installed", ownerNo: "9" }];
  const r = V({ weldList: [{ ...R("1", { c1: "2" }), uid: owner }], bom: BOM }, { saved: { equipment: [], warnings: [], ledger: { lines, rows: [] } } });
  const gone = has(r, "A_ROW_GONE"); assert(gone.length === 1 && gone[0].blocking && gone[0].detail.pt === "99");
  assert(has(r, "A_ROW_SHRUNK").some((f) => f.blocking && f.detail.pt === "2"), "PT 2 holds 3 but has capacity for 2 ends");
  const inst = has(r, "A_INSTALLED_OWNER_GONE"); assert(inst.length === 1 && inst[0].entityUid === ghost && inst[0].blocking);
});

test("saved state: duplicate active allocation lines are a data-integrity finding", () => {
  const o = newUid();
  const lines = [{ id: "a", pt: 2, ownerKind: "weld", ownerRef: o, qty: 1, status: "reserved" }, { id: "b", pt: 2, ownerKind: "weld", ownerRef: o, qty: 1, status: "reserved" }];
  const r = V({ weldList: [{ ...R("1", { c1: "2" }), uid: o }], bom: BOM }, { saved: { equipment: [], warnings: [], ledger: { lines, rows: [] } } });
  const f = has(r, "A_DUP_LINE"); equal(f.length, 1); equal(f[0].category, "data-integrity");
});

test("preview vs saved ledger: a difference is named, and says which is the preview and which is the server's", () => {
  const o = newUid();
  const r = V({ weldList: [{ ...R("1", { c1: "2" }), uid: o }], bom: BOM }, { saved: { equipment: [], warnings: [], ledger: { rows: [], lines: [] } } });
  const f = has(r, "A_PREVIEW_DIFF"); assert(f.length >= 1, JSON.stringify(codes(r)));
  assert(/پیش‌نمایش/.test(f[0].message) && /سرور/.test(f[0].message) && f[0].detail.preview === 1 && f[0].detail.reserved === 0);
  const same = V({ weldList: [{ ...R("1", { c1: "2" }), uid: o }], bom: BOM }, { saved: { equipment: [], warnings: [], ledger: { rows: [], lines: [{ id: "a", pt: 2, ownerKind: "weld", ownerRef: o, qty: 1, status: "reserved", ownerNo: "1" }] } } });
  assert(!codes(same).includes("A_PREVIEW_DIFF"), "equal → no finding");
});

test("equipment installed/tested in the ledger whose mark is gone is blocking; a status drift is info and never auto-changed", () => {
  const e = mark("equipment", "E-1", { attrs: { tag: "T", type: "valve", c1: "7", status: "planned" } });
  const saved = { warnings: [], ledger: { rows: [], lines: [] }, equipment: [{ markId: e.uid, no: "E-1", status: "installed", accessories: [] }, { markId: newUid(), no: "E-2", status: "tested", accessories: [] }] };
  const r = V({ bom: BOM, sheetMarkup: { items: [e] } }, { saved });
  assert(has(r, "E_STATE_SOURCE").length === 1 && has(r, "E_STATE_SOURCE")[0].blocking);
  const drift = has(r, "E_STATE_DRIFT"); assert(drift.length === 1 && drift[0].severity === "info" && /خودکار عوض نمی‌شود/.test(drift[0].message));
});

test("revision: an approved revision and an unsaved draft are explicit findings; an unsaved draft runs no server rules", () => {
  const ok = V({ bom: BOM }, { revision: { status: "approved" } });
  assert(codes(ok).includes("REV_APPROVED"));
  const unsaved = validate({ payload: { bom: BOM }, revision: {}, saved: null, source: "draft" });
  assert(codes(unsaved).includes("REV_UNSAVED"));
  assert(!codes(unsaved).some((c) => /^(A_SAVED|A_ROW|A_PREVIEW|E_STATE|A_DUP)/.test(c)), "no ledger rules without a saved state");
  assert(unsaved.findings.every((f) => /^draft:/.test(f.source)));
});

test("stored warnings: open ones are findings, resolved ones stay as history with their resolution", () => {
  const eq = newUid();
  const warnings = [{ id: "w1", kind: "ambiguous", detail: { type: "equipment_weld", equipmentRef: eq, equipmentNo: "E-1", weldNo: "5", reason: "ambiguous" }, resolved_at: null },
    { id: "w2", kind: "ambiguous", detail: { no: "9", incoming: [1, 2], previous: [1] }, resolved_at: "2026-01-01T00:00:00Z", resolution: "تطبیق دستی انجام شد" }];
  const r = V({ bom: BOM }, { saved: { equipment: [], ledger: { rows: [], lines: [] }, warnings } });
  const a = has(r, "E_LEGACY_WARNING")[0], b = has(r, "ID_WARNING")[0];
  equal([a.resolved, a.entityUid, a.detail.warningId], [false, eq, "w1"]);
  equal([b.resolved, b.detail.resolution], [true, "تطبیق دستی انجام شد"]);
  const s = r.summary; equal([s.resolved, s.open >= 1], [1, true]);
});

test("cut table: the existing cut checks surface as data-integrity findings", () => {
  const r = V({ bom: BOM, weldList: [{ ...R("1"), uid: newUid() }], cutLengths: [{ piece: "C1", from: "99", to: "98" }] });
  assert(r.findings.some((f) => f.category === "data-integrity"), JSON.stringify(codes(r)));
});

test("summary counts open findings by severity, blocking, resolved, per category", () => {
  const s = summarize([{ severity: "error", resolved: false, blocking: true, category: "weld" }, { severity: "warning", resolved: false, blocking: false, category: "bom" },
    { severity: "info", resolved: true, blocking: false, category: "identity" }, { severity: "info", resolved: false, blocking: false, category: "weld" }]);
  equal([s.total, s.open, s.errors, s.warnings, s.info, s.resolved, s.blocking], [4, 3, 1, 1, 1, 1, 1]);
  equal(s.byCategory, { weld: 2, bom: 1 });
});

test("the engine never mutates its input and is deterministic", () => {
  const payload = { weldList: [{ ...R("1", { c1: "2" }), uid: newUid() }, R("2")], bom: BOM, sheetMarkup: { items: [mark("equipment", "E-1")] } };
  const before = JSON.stringify(payload);
  const a = V(payload), b = V(payload);
  equal(JSON.stringify(payload), before); equal(a, b);
  assert(new Set(a.findings.map((f) => f.id)).size === a.findings.length, "finding ids are unique");
});

await run();
