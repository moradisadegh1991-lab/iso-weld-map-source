#!/usr/bin/env node
/**
 * Phase 7 — the engineering validation engine (lib/engineering/validation.mjs), pure.
 * Every category and the rules the phase names: findings carry a persistent uid (never only the printed number), computed from the
 * existing rules, nothing repaired; stored warnings are the only resolvable ones.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
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


// ── the server (route level): read-only validation of the saved state, and warning resolution ───────────

import { isUid } from "../../lib/sheet/mark-identity.mjs";
process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("pvv-db-");
process.env.STORAGE_ROOT = await scratchDir("pvv-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const runRoute = await import("../../app/api/runs/[id]/route.js");
const editsRoute = await import("../../app/api/runs/[id]/edits/route.js");
const approveRoute = await import("../../app/api/runs/[id]/approve/route.js");
const allocRoute = await import("../../app/api/bom-allocations/route.js");
const validationRoute = await import("../../app/api/validation/route.js");
const warningsRoute = await import("../../app/api/mark-warnings/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const { DEMO } = await import("../../lib/demo.js");
const { addMember, ensureUser } = await import("../../lib/db/repos/projects.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const db = await getDb();
const projectId = (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "PVV", name: "V" } })))).body.project.id;
const q = (sql, p = []) => withProject(db, projectId, async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo) => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", body: { projectId, docNo, revision: "0", fileBase64: Buffer.from(`scan ${docNo} ${++seq}`).toString("base64") } })))).body.document.id;
const post = async (documentId, payload) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "PVV-L1", payload } })));
const getRun = async (id) => json(await runRoute.GET(req(`http://x/api/runs/${id}?projectId=${projectId}`), ctx(id)));
const validation = async (documentId, as, pid = projectId) => json(await validationRoute.GET(req(`http://x/api/validation?projectId=${pid}&documentId=${documentId}`, { as })));
const warningList = async (documentId) => json(await warningsRoute.GET(req(`http://x/api/mark-warnings?projectId=${projectId}&documentId=${documentId}`)));
const resolveW = async (documentId, warningId, extra = {}, as = "kc|alice") => json(await warningsRoute.POST(req("http://x/api/mark-warnings", { method: "POST", as, body: { projectId, documentId, warningId, resolution: "پیوند در فرم تجهیز انتخاب شد", ...extra } })));
const correct = async (id, edited, baseHash) => json(await editsRoute.POST(req(`http://x/api/runs/${id}/edits`, { method: "POST", body: { projectId, payload: edited, reason: "t", baseHash: baseHash === undefined ? (await getRun(id)).body.run.payloadHash : baseHash } }), ctx(id)));
const events = (d) => q("SELECT count(*)::int AS n FROM bom_allocation_event WHERE document_id = $1", [d]);

const typed = (rows, items = [], extra = {}) => ({ meta: { drawingNo: "PVV-1", sheet: "1/1", lineNo: "PVV-L1", nps: 4 }, weldList: rows, bom: BOM, sheetMarkup: { page: 1, items }, ...extra });
const EQU = newUid();
const eqMark = (attrs, uid = EQU) => ({ id: "e1", uid, kind: "equipment", no: "V-1", x: 0.5, y: 0.5, attrs: { tag: "T-1", type: "valve", c1: "7", ...attrs } });
const W5a = newUid(), W5b = newUid();
const base = () => { const p = JSON.parse(JSON.stringify(DEMO)); delete p.bom; return { ...p, bom: BOM }; };
const sheetOnly = (items) => ({ ...base(), sheetMarkup: { page: 1, items } });
const weldMark = (id, uid, kind, no, attrs = {}) => ({ id, uid, kind, no, x: 0.2, y: 0.2, src: "hand", attrs });
// a legacy equipment naming «5»: first it names one weld (provable, linked); then the sheet gets a second «5» and the number is ambiguous — recorded as a warning, nothing re-linked
async function saveAmbiguous(doc, ids = { a: W5a, b: W5b, e: EQU }) {
  const one = [weldMark("w1", ids.a, "weld-shop", "5", { c1: "2" }), eqMark({ welds: "5" }, ids.e)];
  const r1 = await post(doc, sheetOnly(one));
  if (r1.status !== 201) return r1;
  return post(doc, sheetOnly([one[0], weldMark("w2", ids.b, "weld-field", "5"), one[1]]));
}

let docA, runA, warn;

test("S1. the server validates the SAVED revision: findings carry the weld's uid; an ambiguous legacy equipment number is a finding and a stored warning", async () => {
  docA = await newDoc("PVV-A");
  const r = await saveAmbiguous(docA);
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300)); runA = r.body.run.id;
  const v = await validation(docA);
  equal(v.status, 200, JSON.stringify(v.body).slice(0, 300));
  assert(v.body.findings.every((f) => /^saved:/.test(f.source)), "all from the saved state");
  const cs = v.body.findings.map((f) => f.code);
  assert(cs.includes("E_WELD_AMBIGUOUS") && cs.includes("E_LEGACY_WARNING"), cs.join());
  equal(v.body.revision.docNo, "PVV-A"); assert(v.body.payloadHash && v.body.summary.total === v.body.findings.length);
  const e = v.body.findings.find((f) => f.code === "E_WELD_AMBIGUOUS");
  assert(isUid(e.entityUid) || e.entityUid, "the equipment is named by its uid");
  const dup = v.body.findings.filter((f) => f.code === "W_DUP_NUMBER");
  equal(dup.length, 2, "both welds that print «5» are named, each by its own uid");
  equal(new Set(dup.map((f) => f.entityUid)).size, 2); assert(dup.every((f) => [W5a, W5b].includes(f.entityUid)));
  const lw = v.body.findings.find((f) => f.code === "E_LEGACY_WARNING");
  equal([lw.resolved, lw.detail.weldNo], [false, "5"]);
  warn = lw.detail.warningId; assert(warn);
});

test("S2. asking is read-only: the ledger, its history and the warnings are exactly as before", async () => {
  const before = [await events(docA), (await q("SELECT count(*)::int AS n FROM sheet_mark_warning"))[0]];
  await validation(docA); await validation(docA);
  equal([await events(docA), (await q("SELECT count(*)::int AS n FROM sheet_mark_warning"))[0]], before);
});

test("S3. permission and boundary: a non-member and a stranger project see nothing; a viewer reads but cannot resolve; another revision is not found", async () => {
  const stranger = await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", as: "kc|zed", body: { code: "ZZZ", name: "Z" } })));
  equal((await validation(docA, "kc|zed")).status, 404, "a non-member of the project");
  equal((await validation(docA, "kc|alice", stranger.body.project.id)).status, 404, "this revision through another project");
  const mallory = await ensureUser(db, { subject: "kc|viewer1" });
  await addMember(db, { projectId, userId: mallory.id, role: "viewer" });
  equal((await validation(docA, "kc|viewer1")).status, 200, "a viewer may read");
  const r = await resolveW(docA, warn, {}, "kc|viewer1");
  equal(r.status, 403); equal(r.body.code, "FORBIDDEN");
  equal((await validation("00000000-0000-4000-8000-000000000000")).status, 404, "unknown revision");
  equal((await validationRoute.GET(req(`http://x/api/validation?projectId=${projectId}`))).status, 400);
  const other = await newDoc("PVV-OTHER"); await post(other, typed([{ ...R("1"), uid: newUid() }]));
  equal((await resolveW(other, warn)).status, 404, "a warning of another revision is not resolvable through this one");
});

test("S4. a warning cannot be closed while the relationship is not there; nothing changes", async () => {
  const r = await resolveW(docA, warn);
  equal(r.status, 409, JSON.stringify(r.body)); equal(r.body.code, "WARNING_NOT_RESOLVABLE");
  equal((await warningList(docA)).body.warnings.filter((w) => !w.resolved_at).length >= 1, true);
  const noNote = await resolveW(docA, warn, { resolution: "  " });
  assert([400, 409].includes(noNote.status));
});

test("S5. stale: a resolve made against an old copy of the register is refused", async () => {
  const g = await getRun(runA);
  const edited = JSON.parse(JSON.stringify(g.body.payload));
  edited.sheetMarkup.items.find((m) => m.kind === "equipment").attrs.weldRefs = W5a;
  edited.sheetMarkup.items.find((m) => m.kind === "equipment").attrs.welds = "";
  const oldHash = (await validation(docA)).body.payloadHash;
  const c = await correct(runA, edited, g.body.run.payloadHash);
  equal(c.status, 200, JSON.stringify(c.body).slice(0, 300));
  const r = await resolveW(docA, warn, { baseHash: oldHash });
  equal(r.status, 409); equal(r.body.code, "STALE_RUN");
});

test("S6. after the person links the equipment to ONE weld by uid, the finding is gone on refresh, the warning can be resolved, and its history stays", async () => {
  const v = await validation(docA);
  assert(!v.body.findings.some((f) => f.code === "E_WELD_AMBIGUOUS"), "the ambiguity is gone from the computed findings");
  const r = await resolveW(docA, warn, { baseHash: v.body.payloadHash });
  equal(r.status, 200, JSON.stringify(r.body));
  const again = await validation(docA);
  const lw = again.body.findings.find((f) => f.code === "E_LEGACY_WARNING");
  assert(lw && lw.resolved === true && /پیوند/.test(lw.detail.resolution), "kept, marked resolved, with the note");
  assert(again.body.summary.resolved >= 1);
  const list = (await warningList(docA)).body.warnings.find((w) => w.id === warn);
  assert(list.resolved_at && list.resolution && list.resolved_by, "who, when and why are stored");
  equal((await resolveW(docA, warn)).status, 409, "and it is not resolved twice");
  const link = await q("SELECT weld_ref FROM iso_equipment_weld w JOIN iso_equipment e ON e.id = w.equipment_id WHERE e.document_id = $1", [docA]);
  equal(link.map((l) => l.weld_ref), [W5a], "resolving changed no link");
});

test("S7. correcting a BOM reference and refreshing: the missing-PT finding goes away; a held allocation is reported, never released", async () => {
  const doc = await newDoc("PVV-B"), u = newUid();
  const r = await post(doc, typed([{ ...R("1", { c1: "2", c2: "99" }), uid: u }]));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  let v = await validation(doc);
  const miss = v.body.findings.filter((f) => f.code === "W_PT_MISSING");
  equal(miss.length, 1); equal([miss[0].entityUid, miss[0].detail.pt], [u, "99"]);
  assert(v.body.findings.some((f) => f.code === "A_ROW_HELD"), "PT 2 is held by this weld");
  const evBefore = (await events(doc))[0].n;
  const g = await getRun(r.body.run.id);
  const edited = JSON.parse(JSON.stringify(g.body.payload)); edited.weldList[0].c2 = "2";
  equal((await correct(r.body.run.id, edited, g.body.run.payloadHash)).status, 200);
  v = await validation(doc);
  assert(!v.body.findings.some((f) => f.code === "W_PT_MISSING"), "gone after the correction and a refresh");
  assert((await events(doc))[0].n >= evBefore, "history only grows");
});

test("S8. an installed allocation: reported as held, the weld that owns it cannot vanish silently; validation never releases it", async () => {
  const doc = await newDoc("PVV-C"), u = newUid();
  const r = await post(doc, typed([{ ...R("1", { c1: "2" }), uid: u }]));
  equal(r.status, 201);
  const line = (await q("SELECT id FROM bom_allocation WHERE document_id = $1 AND status = 'reserved'", [doc]))[0];
  equal((await json(await allocRoute.POST(req("http://x/api/bom-allocations", { method: "POST", body: { projectId, documentId: doc, allocationId: line.id, action: "install", reason: "site" } })))).status, 200);
  const v = await validation(doc);
  const held = v.body.findings.find((f) => f.code === "A_ROW_HELD" && f.detail.pt === 2);
  equal(held.detail.installed, 1);
  assert((await q("SELECT 1 FROM bom_allocation WHERE document_id = $1 AND status = 'installed'", [doc])).length === 1);
  await validation(doc);
  assert((await q("SELECT 1 FROM bom_allocation WHERE document_id = $1 AND status = 'installed'", [doc])).length === 1, "still installed after validating");
});

test("S9. an unlinked sheet weld mark is reported with its uid and attributes and is NOT matched to a typed row by number", async () => {
  const doc = await newDoc("PVV-D"), u = newUid(), orphan = newUid();
  const r = await post(doc, typed([{ ...R("1", { c1: "2" }), uid: u }], [{ id: "m1", uid: orphan, kind: "weld-shop", no: "1", x: 0.3, y: 0.3, attrs: { c1: "2" } }]));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const v = await validation(doc);
  const f = v.body.findings.filter((x) => x.code === "W_UNLINKED");
  equal(f.length, 1); equal([f[0].entityUid, f[0].entityNumber], [orphan, "1"]);
  equal((await q("SELECT owner_ref FROM bom_allocation WHERE document_id = $1 AND status = 'reserved'", [doc])).map((l) => l.owner_ref), [u], "the unlinked mark holds nothing");
});

test("S10. an approved revision: findings say so and a warning cannot be resolved on it (new revision is the way)", async () => {
  const doc = await newDoc("PVV-E");
  const r = await saveAmbiguous(doc, { a: newUid(), b: newUid(), e: newUid() });
  equal(r.status, 201);
  const w = (await validation(doc)).body.findings.find((f) => f.code === "E_LEGACY_WARNING").detail.warningId;
  const id = r.body.run.id;
  equal((await json(await approveRoute.POST(req(`http://x/api/runs/${id}/approve`, { method: "POST", body: { projectId } }), ctx(id)))).status, 200);
  const v = await validation(doc);
  assert(v.body.findings.some((f) => f.code === "REV_APPROVED"));
  const res = await resolveW(doc, w);
  equal(res.status, 409); equal(res.body.code, "RUN_LOCKED");
});

await run();
