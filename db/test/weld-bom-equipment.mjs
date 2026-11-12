#!/usr/bin/env node
/**
 * Phase 6 — one weld, one identity, across the typed list, the BOM ledger and the equipment links
 * (docs/audit/phase-6-weld-bom-equipment-integration.md).
 *
 * The welds of a payload are ONE projection (lib/sheet/weld-projection.mjs): typed rows are the welds of a typed list, a sheet weld mark with the
 * same uid is the same weld and adds nothing. A typed weld reserves its BOM component PTs under its uid (printed number = display only);
 * equipment joins welds by uid; a legacy printed number links only when it names one weld; deleting a weld an equipment names is refused;
 * installed lines and installed equipment are never released by a save; the ledger's history is append-only.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { isUid, newUid } from "../../lib/sheet/mark-identity.mjs";
import { projectWelds, effectiveItems } from "../../lib/sheet/weld-projection.mjs";
import { ledgerDemands } from "../../lib/register/bom-allocation.mjs";
import { equipmentWelds, duplicateMark, normalize, weldRefsOf, dependents, equipmentChecks } from "../../lib/sheet/markup.mjs";
import { touchesSheetData } from "../../lib/db/repos/register-persistence.mjs";
import { ledgerByPt, decorate, view, deleteCheck } from "../../lib/register/bom-table.mjs";

const R = (no, extra = {}) => ({ no, spool: "SP-1", loc: "Shop", kind: "BW", nps: "4", ...extra });
const BOMP = [{ pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 2, qtyUnit: "pcs" },
  { pt: 1, group: "PIPE", description: "PIPE SMLS A106 B", diam: "4", qty: 12, qtyUnit: "m" },
  { pt: 7, group: "MISC", description: "STUD BOLT SET", diam: "4", qty: 4, qtyUnit: "pcs" }];

// ── the projection (pure) ────────────────────────────────────────────────

test("1. a typed row is a weld with the row's uid; the printed number is only `no`", () => {
  const u = newUid();
  const p = projectWelds({ weldList: [{ ...R("W-01", { c1: "2", c2: "2" }), uid: u }] });
  equal(p.source, "weldList"); equal(p.welds.length, 1);
  equal(p.welds[0].uid, u); equal(p.welds[0].no, "W-01"); equal(p.welds[0].attrs.c1, "2");
  equal(p.noIdentity, []);
});

test("2. the same weld in the typed list and as a sheet mark is ONE weld (one demand, no double reservation)", () => {
  const u = newUid();
  const payload = { weldList: [{ ...R("1", { c1: "2" }), uid: u }], sheetMarkup: { items: [{ id: "m1", uid: u, kind: "weld-shop", no: "1", attrs: { c1: "2" } }] } };
  const { items, projection } = effectiveItems(payload);
  equal(items.filter((m) => m.kind.startsWith("weld")).length, 1);
  equal(projection.unlinked, []);
  const d = ledgerDemands(items, BOMP);
  equal(d.length, 1); equal(d[0].ownerRef, u); equal(d[0].ownerNo, "1"); equal(d[0].qty, 1);
});

test("3. a sheet weld mark that is not any typed row holds nothing and is reported — never matched by number", () => {
  const u = newUid(), other = newUid();
  const payload = { weldList: [{ ...R("1", { c1: "2" }), uid: u }], sheetMarkup: { items: [{ id: "m1", uid: other, kind: "weld-shop", no: "1", attrs: { c1: "2" } }] } };
  const { items, projection } = effectiveItems(payload);
  equal(projection.unlinked.length, 1); equal(projection.unlinked[0].uid, other);
  equal(ledgerDemands(items, BOMP).map((d) => d.ownerRef), [u], "only the typed weld reserves, though both print «1»");
});

test("4. two typed welds with the same printed number stay two welds with two owners", () => {
  const a = newUid(), b = newUid();
  const { items } = effectiveItems({ weldList: [{ ...R("5", { c1: "2" }), uid: a }, { ...R("5", { c1: "2" }), uid: b }] });
  equal(ledgerDemands(items, BOMP).map((d) => d.ownerRef).sort(), [a, b].sort());
});

test("5. a weld with no component reserves nothing; a row with no valid uid owns nothing; a pipe (length) is not counted per weld", () => {
  const a = newUid();
  const { items, projection } = effectiveItems({ weldList: [{ ...R("1"), uid: a }, { ...R("2", { c1: "2" }) }, { ...R("3", { c1: "1" }), uid: newUid() }] });
  equal(ledgerDemands(items, BOMP), [], "no c1/c2 → nothing; the uid-less row owns nothing; the pipe row is length-allocated, not per weld");
  equal(projection.noIdentity.length, 1);
});

test("a typed weld with no weld list at all: the sheet's weld marks are the welds (the geometry route is unchanged)", () => {
  const p = projectWelds({ sheetMarkup: { items: [{ id: "m1", uid: newUid(), kind: "weld-shop", no: "1" }, { id: "m2", kind: "spool", no: "SP-1" }] } });
  equal(p.source, "sheetMarkup"); equal(p.welds.length, 1);
});

// ── equipment → weld (pure) ──────────────────────────────────────────────

const W1 = newUid(), W2 = newUid(), WD1 = newUid(), WD2 = newUid(), EQU = newUid();
const eq = (attrs) => ({ id: "e1", uid: EQU, kind: "equipment", no: "V-1", attrs });

test("6. an equipment names its welds by uid; renumbering a weld does not break the link", () => {
  const welds = [{ uid: W1, kind: "weld-shop", no: "1" }, { uid: W2, kind: "weld-shop", no: "2" }];
  const e = eq({ weldRefs: W1, welds: "1" });
  equal(equipmentWelds(e, welds).joined, [{ uid: W1, no: "1" }]);
  const renumbered = [{ uid: W1, kind: "weld-shop", no: "77" }, welds[1]];
  equal(equipmentWelds(e, renumbered).joined, [{ uid: W1, no: "77" }], "same weld, new number");
  assert(dependents([e, ...renumbered], W1).some((t) => /تجهیز V-1/.test(t)), "and it is still known as joined");
  equal(weldRefsOf(`${W1}, nonsense, ${W1.toUpperCase()}`), [W1], "only valid uids, no repeats");
});

test("7. duplicate printed numbers never mislink: refs pick the one; a legacy number that names several links nothing", () => {
  const welds = [{ uid: WD1, kind: "weld-shop", no: "5" }, { uid: WD2, kind: "weld-field", no: "5" }];
  equal(equipmentWelds(eq({ weldRefs: WD2 }), welds).joined.map((j) => j.uid), [WD2]);
  const legacy = equipmentWelds(eq({ welds: "5" }), welds);
  equal(legacy.joined, []); equal(legacy.unresolved, [{ no: "5", reason: "ambiguous" }]); assert(legacy.legacy);
  assert(equipmentChecks([eq({ welds: "5" }), ...welds], []).some((t) => /نام چند سرجوش/.test(t)), "and says so");
  equal(equipmentWelds(eq({ welds: "9" }), welds).unresolved, [{ no: "9", reason: "missing" }]);
  equal(equipmentWelds(eq({ welds: "5" }), [welds[0]]).joined, [{ uid: WD1, no: "5" }], "a legacy number that names exactly one weld does link");
});

test("a referenced weld that is gone is `dangling`, not silently dropped", () => {
  equal(equipmentWelds(eq({ weldRefs: W1 }), []).dangling, [W1]);
});

test("a duplicate of an equipment is joined to no weld (a relationship of the original), and keeps its engineering description", () => {
  const items = normalize([{ ...eq({ tag: "T", type: "valve", c1: "7", weldRefs: W1, welds: "1", status: "installed" }), x: 0.5, y: 0.5 }]);
  const { items: next, key } = duplicateMark(items, EQU);
  const copy = next.find((m) => m.uid === key);
  equal([copy.attrs.tag, copy.attrs.type, copy.attrs.c1], ["T", "valve", "7"]);
  assert(!("weldRefs" in copy.attrs) && !("welds" in copy.attrs) && !("status" in copy.attrs));
});

test("a correction touching a typed weld's components, number or presence re-makes allocations and links", () => {
  assert(touchesSheetData([{ path: "weldList[3].c1" }]));
  assert(touchesSheetData([{ path: "weldList[0].no" }]));
  assert(touchesSheetData([{ path: "weldList[1].uid" }]));
  assert(!touchesSheetData([{ path: "weldList[1].wps" }]), "an unrelated attribute does not");
  assert(touchesSheetData([{ path: "bom[0].qty" }]));
});

test("the BOM table counts the welds\' reserved and installed ends from the server (they are reported apart from other owners)", () => {
  const ledger = ledgerByPt({ rows: [{ pt: 2, weldEnds: 4, weldReserved: 2, weldInstalled: 1, weldLeft: 1, reserved: 0, installed: 0, left: 4 }, { pt: 7, reserved: 1, installed: 0, left: 3 }] });
  equal([ledger.get("2").reservedAll, ledger.get("2").installedAll, ledger.get("7").reservedAll], [2, 1, 1]);
  const all = decorate([{ pt: 2, description: "FLANGE", qty: 4 }, { pt: 7, description: "STUD", qty: 4 }, { pt: 9, description: "X", qty: 1 }], { ledger });
  equal(view(all, { filter: "reserved" }).map((d) => d.row.pt), [2, 7]);
  equal(view(all, { filter: "installed" }).map((d) => d.row.pt), [2]);
  equal(deleteCheck(all[0]).ok, false, "installed ends on the row: it cannot be deleted from the draft");
});

// ── the server ───────────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("wbe-db-");
process.env.STORAGE_ROOT = await scratchDir("wbe-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const runRoute = await import("../../app/api/runs/[id]/route.js");
const editsRoute = await import("../../app/api/runs/[id]/edits/route.js");
const allocRoute = await import("../../app/api/bom-allocations/route.js");
const equipRoute = await import("../../app/api/iso-equipment/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const { DEMO } = await import("../../lib/demo.js");
const { payloadHash } = await import("../../lib/review/payload-hash.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const db = await getDb();
const projectId = (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "WBE", name: "W" } })))).body.project.id;
const q = (sql, p = []) => withProject(db, projectId, async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo, revision = "0") => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST",
  body: { projectId, docNo, revision, fileBase64: Buffer.from(`scan ${docNo} ${revision} ${++seq}`).toString("base64") } })))).body.document.id;
const typed = (rows, extra = {}) => ({ meta: { drawingNo: "WBE-1", sheet: "1/1", lineNo: "WBE-L1", nps: 4 }, weldList: rows, bom: BOMP, ...extra });
const post = async (documentId, payload) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "WBE-L1", payload } })));
const stored = async (id) => (await q("SELECT payload FROM extraction_run WHERE id = $1", [id]))[0].payload;
const lines = (d, status) => q(`SELECT id, pt, owner_kind, owner_ref, owner_no, qty, status FROM bom_allocation WHERE document_id = $1 ${status ? "AND status = '" + status + "'" : ""} ORDER BY pt, owner_no`, [d]);
const events = (d) => q("SELECT event, allocation_id, qty_before, qty_after FROM bom_allocation_event WHERE document_id = $1 ORDER BY at, id", [d]);
const links = (d) => q("SELECT w.weld_ref, w.weld_no, e.equipment_no FROM iso_equipment_weld w JOIN iso_equipment e ON e.id = w.equipment_id WHERE e.document_id = $1 ORDER BY w.weld_no", [d]);
const warnings = (d) => q("SELECT detail FROM sheet_mark_warning WHERE document_id = $1 AND resolved_at IS NULL", [d]);
const correct = async (id, edited, baseHash) => json(await editsRoute.POST(req(`http://x/api/runs/${id}/edits`, { method: "POST", body: { projectId, payload: edited, reason: "t", baseHash: baseHash === undefined ? payloadHash(await stored(id)) : baseHash } }), ctx(id)));
const transition = async (documentId, allocationId, action, reason) => json(await allocRoute.POST(req("http://x/api/bom-allocations", { method: "POST", body: { projectId, documentId, allocationId, action, reason } })));

let docA, runA, wA, wB;

test("8. a typed weld reserves its component PT under its uid; saving again does not reserve twice and keeps the line's identity", async () => {
  docA = await newDoc("WBE-A");
  wA = newUid(); wB = newUid();
  const r = await post(docA, typed([{ ...R("1", { c1: "2" }), uid: wA }, { ...R("2"), uid: wB }]));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 400));
  runA = r.body.run.id;
  const l = await lines(docA, "reserved");
  equal(l.length, 1, "only the weld with a component reserves");
  equal([l[0].pt, l[0].owner_kind, l[0].owner_ref, l[0].owner_no, Number(l[0].qty)], [2, "weld", wA, "1", 1], "owned by the uid; «1» is only its label");
  const again = await post(docA, typed((await stored(runA)).weldList));
  equal(again.status, 201);
  const l2 = await lines(docA, "reserved");
  equal(l2.length, 1); equal(l2[0].id, l[0].id, "the same ledger line");
  equal((await events(docA)).map((e) => e.event), ["reserve"], "history: one reserve, nothing else");
});

test("9. renumbering a typed weld updates only the label of its line, not its identity or quantity", async () => {
  const p = await stored(runA);
  const rows = p.weldList.map((w) => (w.uid === wA ? { ...w, no: "77" } : w));
  const r = await post(docA, typed(rows));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const l = await lines(docA, "reserved");
  equal([l.length, l[0].owner_ref, l[0].owner_no], [1, wA, "77"]);
  equal((await events(docA)).length, 1, "no new event for a relabel");
});

test("10. components changed: the reserved line is adjusted / released with a recorded event (reserved changes are audited)", async () => {
  const p = await stored((await q("SELECT id FROM extraction_run WHERE document_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [docA]))[0].id);
  const rows = p.weldList.map((w) => (w.uid === wA ? { ...w, c1: "2", c2: "2" } : w));
  equal((await post(docA, typed(rows))).status, 201);
  equal(Number((await lines(docA, "reserved"))[0].qty), 2, "both ends of the same PT");
  const cleared = p.weldList.map((w) => (w.uid === wA ? { ...w, c1: "", c2: "" } : w));
  equal((await post(docA, typed(cleared))).status, 201);
  equal((await lines(docA, "reserved")).length, 0);
  assert((await events(docA)).map((e) => e.event).includes("release"), "the release is in the history");
  assert((await events(docA)).length >= 3, "and nothing was erased");
});

test("11. the PT's welded ends bound the typed welds: more than it has is refused as a whole", async () => {
  const doc = await newDoc("WBE-CAP");
  const rows = ["1", "2", "3"].map((n) => ({ ...R(n, { c1: "2" }), uid: newUid() }));        // PT 2 has 2 pieces = 2 ends; 3 welds ask 3
  const r = await post(doc, typed(rows));
  equal(r.status, 409, JSON.stringify(r.body).slice(0, 300));
  equal(r.body.code, "BOM_ALLOCATION");
  equal((await q("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1", [doc]))[0].n, 0, "nothing saved");
  equal((await lines(doc)).length, 0);
});

test("12. a PT that is not in the revision's BOM holds nothing (the page reports it); nothing is invented", async () => {
  const doc = await newDoc("WBE-MISS");
  const r = await post(doc, typed([{ ...R("1", { c1: "99" }), uid: newUid() }]));
  equal(r.status, 201);
  equal((await lines(doc)).length, 0);
});

test("13. a weld installed on a BOM line is protected: the row cannot be deleted or its components dropped, whatever the page showed", async () => {
  const doc = await newDoc("WBE-INST");
  const u = newUid();
  const r = await post(doc, typed([{ ...R("1", { c1: "2" }), uid: u }, { ...R("2"), uid: newUid() }]));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const id = r.body.run.id;
  const line = (await lines(doc, "reserved"))[0];
  const ins = await transition(doc, line.id, "install", "site");
  equal(ins.status, 200, JSON.stringify(ins.body).slice(0, 300));
  const p = await stored(id);
  const dropped = await post(doc, typed(p.weldList.filter((w) => w.uid !== u)));              // the row deleted
  equal(dropped.status, 409, JSON.stringify(dropped.body).slice(0, 300));
  assert(/نصب‌شده/.test(dropped.body.error));
  const cleared = await post(doc, typed(p.weldList.map((w) => (w.uid === u ? { ...w, c1: "" } : w))));
  equal(cleared.status, 409, "components removed while installed");
  const l = await lines(doc);
  equal(l.length, 1); equal(l[0].status, "installed");
  assert((await events(doc)).some((e) => e.event === "install"), "the install is in the history and stays there");
});

test("14. two saves racing for the same revision are taken in turn; the ledger never exceeds what the BOM has", async () => {
  const doc = await newDoc("WBE-RACE");
  const mk = (n) => ["1", "2"].map((x) => ({ ...R(`${n}${x}`, { c1: "2" }), uid: newUid() }));
  const [a, b] = await Promise.all([post(doc, typed(mk("a"))), post(doc, typed(mk("b")))]);
  assert([a.status, b.status].every((s) => s === 201 || s === 409), `no 500 (${a.status}, ${b.status})`);
  const total = (await lines(doc)).filter((l) => l.status === "reserved").reduce((t, l) => t + Number(l.qty), 0);
  assert(total <= 2, `reserved ${total} of 2 ends`);
});

test("15. a pipe (length item) is not counted per weld, as before", async () => {
  const doc = await newDoc("WBE-PIPE");
  const r = await post(doc, typed([{ ...R("1", { c1: "1" }), uid: newUid() }]));
  equal(r.status, 201);
  equal((await lines(doc)).length, 0);
});

test("16. revision boundary: another revision's lines are not this one's, and its weld uid is refused here", async () => {
  const docB = await newDoc("WBE-A", "1");
  const refused = await post(docB, typed([{ ...R("1", { c1: "2" }), uid: wA }]));
  equal(refused.status, 409); equal(refused.body.code, "MARK_UID_CONFLICT");
  const ok = await post(docB, typed([{ ...R("1", { c1: "2" }) }]));
  equal(ok.status, 201);
  const l = await lines(docB);
  equal(l.length, 1); assert(l[0].owner_ref !== wA && isUid(l[0].owner_ref), "a new revision's weld is a new owner");
  equal((await lines(docA)).every((x) => x.owner_ref !== l[0].owner_ref), true);
});

// ── equipment ────────────────────────────────────────────────────────────

const EQ = (uid, attrs, no = "V-1") => ({ id: "e1", uid, kind: "equipment", no, x: 0.5, y: 0.5, src: "hand", attrs });
let docE, runE, eqUid, e1, e2;

test("17. equipment joined to a typed weld by uid: the link is stored by uid, with the number as its label; reopen lists it", async () => {
  docE = await newDoc("WBE-EQ");
  eqUid = newUid(); e1 = newUid(); e2 = newUid();
  const r = await post(docE, typed([{ ...R("1"), uid: e1 }, { ...R("2"), uid: e2 }], { sheetMarkup: { page: 1, items: [EQ(eqUid, { tag: "T-1", type: "valve", status: "planned", weldRefs: e1, welds: "1" })] } }));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 400));
  runE = r.body.run.id;
  equal((await links(docE)).map((l) => [l.weld_ref, l.weld_no]), [[e1, "1"]]);
  const listed = await json(await equipRoute.GET(req(`http://x/api/iso-equipment?projectId=${projectId}&documentId=${docE}`)));
  equal(listed.body.equipment[0].welds, [{ ref: e1, no: "1" }], "reopen: the same relationship");
});

test("18. renumbering and moving the weld keep the equipment link; the label follows the weld", async () => {
  const p = await stored(runE);
  const rows = p.weldList.map((w) => (w.uid === e1 ? { ...w, no: "55" } : w));
  const moved = { ...p.weldMarkup, page: 1, marks: {}, byUid: { [e1]: { x: 0.9, y: 0.1, src: "hand" } } };
  const r = await post(docE, typed(rows, { sheetMarkup: p.sheetMarkup, weldMarkup: moved }));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  equal((await links(docE)).map((l) => [l.weld_ref, l.weld_no]), [[e1, "55"]], "same weld uid, new label");
  runE = r.body.run.id;
});

test("19. deleting a weld an equipment still names is refused (and the equipment is not touched); unlinking first allows it", async () => {
  const p = await stored(runE);
  const gone = await post(docE, typed(p.weldList.filter((w) => w.uid !== e1), { sheetMarkup: p.sheetMarkup }));
  equal(gone.status, 409, JSON.stringify(gone.body).slice(0, 300));
  equal(gone.body.code, "EQUIPMENT_WELD_MISSING");
  equal((await links(docE)).length, 1, "the link is intact");
  const eqItems = p.sheetMarkup.items.map((m) => ({ ...m, attrs: { ...m.attrs, weldRefs: "", welds: "" } }));
  const ok = await post(docE, typed(p.weldList.filter((w) => w.uid !== e1), { sheetMarkup: { ...p.sheetMarkup, items: eqItems } }));
  equal(ok.status, 201, JSON.stringify(ok.body).slice(0, 300));
  equal((await links(docE)).length, 0, "unlinked deliberately, then deleted");
});

test("20. duplicate printed numbers on the sheet never mislink: the uid picks the weld", async () => {
  const doc = await newDoc("WBE-DUP");
  const d1 = newUid(), d2 = newUid(), eqU = newUid();
  const marks = [{ id: "m1", uid: d1, kind: "weld-shop", no: "5", x: 0.1, y: 0.1, src: "hand", attrs: {} }, { id: "m2", uid: d2, kind: "weld-field", no: "5", x: 0.8, y: 0.8, src: "hand", attrs: {} },
    EQ(eqU, { weldRefs: d2, welds: "5" }, "V-2")];
  const p = JSON.parse(JSON.stringify(DEMO)); delete p.bom;
  const r = await post(doc, { ...p, bom: BOMP, sheetMarkup: { page: 1, items: marks } });
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 400));
  equal((await links(doc)).map((l) => l.weld_ref), [d2], "joined to the second «5», not the first");
});

test("21. a legacy equipment naming a repeated number links nothing, is recorded for manual resolution, and keeps a link already proven", async () => {
  const doc = await newDoc("WBE-LEG");
  const d1 = newUid(), eqU = newUid();
  const base = JSON.parse(JSON.stringify(DEMO)); delete base.bom;
  const one = [{ id: "m1", uid: d1, kind: "weld-shop", no: "5", x: 0.1, y: 0.1, src: "hand", attrs: {} }, EQ(eqU, { welds: "5" }, "V-3")];
  equal((await post(doc, { ...base, bom: BOMP, sheetMarkup: { page: 1, items: one } })).status, 201);
  equal((await links(doc)).map((l) => l.weld_ref), [d1], "legacy number naming ONE weld links (provable)");
  const two = [...one.slice(0, 1), { id: "m9", uid: newUid(), kind: "weld-field", no: "5", x: 0.7, y: 0.7, src: "hand", attrs: {} }, one[1]];
  equal((await post(doc, { ...base, bom: BOMP, sheetMarkup: { page: 1, items: two } })).status, 201);
  equal((await links(doc)).map((l) => l.weld_ref), [d1], "the number is now ambiguous: the proven link is kept, nothing new is attached on a guess");
  const w = await warnings(doc);
  assert(w.some((x) => x.detail.type === "equipment_weld" && x.detail.reason === "ambiguous" && x.detail.weldNo === "5"), "recorded for manual resolution");
  equal((await warnings(doc)).filter((x) => x.detail.type === "equipment_weld").length, 1, "once, not once per save");
});

test("22. installed equipment is still protected when its weld link is edited away with it", async () => {
  const doc = await newDoc("WBE-INSTEQ");
  const u = newUid(), eqU = newUid();
  const r = await post(doc, typed([{ ...R("1"), uid: u }], { sheetMarkup: { page: 1, items: [EQ(eqU, { status: "installed", weldRefs: u, welds: "1" }, "V-9")] } }));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const p = await stored(r.body.run.id);
  const removed = await post(doc, typed(p.weldList, { sheetMarkup: { page: 1, items: [] } }));
  equal(removed.status, 409, JSON.stringify(removed.body).slice(0, 300));
  equal((await q("SELECT count(*)::int AS n FROM iso_equipment WHERE document_id = $1", [doc]))[0].n, 1);
});

test("23. a correction of a typed weld's component re-makes the ledger in the correction's transaction", async () => {
  const doc = await newDoc("WBE-CORR");
  const u = newUid();
  const r = await post(doc, typed([{ ...R("1"), uid: u }]));
  equal(r.status, 201);
  const id = r.body.run.id;
  const g = await json(await runRoute.GET(req(`http://x/api/runs/${id}?projectId=${projectId}`), ctx(id)));
  const edited = JSON.parse(JSON.stringify(g.body.payload)); edited.weldList[0].c1 = "2";
  const c = await correct(id, edited, g.body.run.payloadHash);
  equal(c.status, 200, JSON.stringify(c.body).slice(0, 300));
  const l = await lines(doc, "reserved");
  equal([l.length, l[0].owner_ref], [1, u], "reserved by the correction");
});

await run();
