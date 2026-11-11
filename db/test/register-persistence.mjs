import { payloadHash as correctionPayloadHash } from "../../lib/review/payload-hash.mjs";
#!/usr/bin/env node
/**
 * Register, BOM, allocations and equipment: one persistence path (lib/db/repos/register-persistence.mjs).
 *
 * Driven through the real route handlers (POST /api/runs, POST /api/runs/[id]/edits) so that authentication, permission, RLS and
 * the route's transaction are all in play. What is proved: the three states of `bom`; that a correction re-makes the BOM,
 * allocations and equipment instead of leaving them as the first save made them; that nothing installed or tested is dropped;
 * that an approved BOM and a run that is not the revision's current one are not changed; that a failure anywhere undoes the lot.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { DEMO } from "../../lib/demo.js";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("regpers-db-");
process.env.STORAGE_ROOT = await scratchDir("regpers-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const editsRoute = await import("../../app/api/runs/[id]/edits/route.js");
const approveRoute = await import("../../app/api/runs/[id]/approve/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const al = await import("../../lib/db/repos/bom-allocation.mjs");
const persistence = await import("../../lib/db/repos/register-persistence.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });

const db = await getDb();
const created = await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "RP1", name: "RP" } })));
const projectId = created.body.project.id;
const inP = (fn) => withProject(db, projectId, fn);
const q = (sql, params = []) => inP(async () => (await db.query(sql, params)).rows);
const n = async (sql, params = []) => Number((await q(sql, params))[0].n);

const BOM = [
  { pt: 1, group: "PIPE", description: "PIPE S40 BE API 5L-B", diam: "4", qty: 6, qtyUnit: "m" },
  { pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 2, qtyUnit: "pcs" },
  { pt: 3, group: "FITTINGS", description: "ELBOW 90 LR BW A234-WPB", diam: "4", qty: 3, qtyUnit: "pcs" },
  { pt: 7, group: "MISC", description: "STUD BOLT SET", diam: "4", qty: 4, qtyUnit: "pcs" },
];
// marks carry a persistent identity (uid, lib/sheet/mark-identity.mjs); `id` is the legacy list handle. Same id → same uid in these fixtures.
const UID = (id) => `00000000-0000-4000-8000-${Buffer.from(String(id)).toString("hex").padStart(12, "0").slice(-12)}`;
const W = (id, no, c1, c2) => ({ id, uid: UID(id), kind: "weld-shop", no, attrs: { ...(c1 ? { c1 } : {}), ...(c2 ? { c2 } : {}) } });
const EQ = (id, no, attrs = {}) => ({ id, uid: UID(id), kind: "equipment", no, attrs: { tag: `T-${no}`, type: "valve", status: "planned", ...attrs } });
const payloadOf = (extra = {}) => { const p = JSON.parse(JSON.stringify(DEMO)); delete p.bom; return { ...p, ...extra }; };

let seq = 0;
const newDoc = async (docNo, revision = "0") => (await json(await documentsRoute.POST(req("http://x/api/documents", {
  method: "POST", body: { projectId, docNo, revision, fileBase64: Buffer.from(`scan ${docNo} ${revision} ${++seq}`).toString("base64") } })))).body.document.id;
const save = async (documentId, payload) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId, lineNo: "RP-L1", payload } })));
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const correct = async (runId, payload, as = "kc|alice") => json(await editsRoute.POST(req(`http://x/api/runs/${runId}/edits`, { method: "POST", as, body: { projectId, payload, reason: "t", baseHash: correctionPayloadHash((await q("SELECT payload FROM extraction_run WHERE id = $1", [runId]))[0].payload) } }), ctx(runId)));
const bomOf = (documentId) => q("SELECT pt, qty FROM iso_bom_row WHERE document_id = $1 ORDER BY pt", [documentId]);
const allocs = (documentId, status = null) => q("SELECT pt, owner_ref, qty, status FROM bom_allocation WHERE document_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY pt, owner_ref", [documentId, status]);
const equipment = (documentId) => q("SELECT mark_id, status FROM iso_equipment WHERE document_id = $1 ORDER BY mark_id", [documentId]);

test("the three states of bom are told apart (bomState)", () => {
  equal(persistence.bomState({}), { mode: "unchanged" });
  equal(persistence.bomState({ bom: undefined }), { mode: "unchanged" });
  equal(persistence.bomState({ bom: null }), { mode: "unchanged" }, "null never destroys");
  equal(persistence.bomState({ bom: [] }), { mode: "clear" });
  equal(persistence.bomState({ bom: BOM }).mode, "replace");
  let e; try { persistence.bomState({ bom: "x" }); } catch (x) { e = x; }
  assert(e && e.status === 400, "anything else is refused");
  assert(persistence.touchesSheetData([{ path: "bom[0].qty" }, { path: "nodes[1].E" }]));
  assert(persistence.touchesSheetData([{ path: "sheetMarkup.items[0].no" }]));
  assert(!persistence.touchesSheetData([{ path: "nodes[1].E" }, { path: "meta.nps" }, { path: "bomX" }]));
});

let docA, runA;
test("1. an initial run with a non-empty BOM and marks saves the register, the BOM, the equipment and the allocations together", async () => {
  docA = await newDoc("RP-A");
  const r = await save(docA, payloadOf({ bom: BOM, sheetMarkup: { items: [W("w1", "1", "2"), W("w2", "2", "2", "3"), EQ("e1", "V-1", { c1: "7" })] } }));
  equal(r.status, 201, JSON.stringify(r.body).slice(0, 200));
  runA = r.body.run.id;
  equal((await bomOf(docA)).map((b) => b.pt), [1, 2, 3, 7]);
  equal((await equipment(docA)).map((e) => e.mark_id), [UID("e1")], "equipment is kept by the mark's persistent identity");
  equal((await allocs(docA)).map((a) => [a.pt, a.owner_ref, Number(a.qty)]), [[2, UID("w1"), 1], [2, UID("w2"), 1], [3, UID("w2"), 1], [7, UID("e1"), 1]]);
  equal(r.body.bomRows, 4);
  assert(r.body.allocation && r.body.allocation.reserved === 4);
});

test("2. an initial run with the BOM omitted keeps the BOM already on file for that revision (no BOM on a new one)", async () => {
  const docNew = await newDoc("RP-NEW");
  const r = await save(docNew, payloadOf());
  equal(r.status, 201);
  equal(await bomOf(docNew), [], "a new revision with no bom has none");
  // the same revision saved again with bom omitted: its BOM, allocations and equipment are not touched by that omission
  const again = await save(docA, payloadOf({ sheetMarkup: { items: [W("w1", "1", "2"), W("w2", "2", "2", "3"), EQ("e1", "V-1", { c1: "7" })] } }));
  equal(again.status, 201);
  equal((await bomOf(docA)).map((b) => b.pt), [1, 2, 3, 7], "omitted is not empty: the BOM stays");
  equal((await allocs(docA, "reserved")).length, 4, "and the same marks hold the same lines");
});

test("3. an explicit empty BOM clears it only when nothing holds it", async () => {
  const r = await save(docA, payloadOf({ bom: [], sheetMarkup: { items: [W("w1", "1", "2")] } }));
  equal(r.status, 409);
  equal(r.body.code, "BOM_IN_USE");
  assert(/آزاد/.test(r.body.error), r.body.error);
  equal((await bomOf(docA)).length, 4, "refused: nothing changed");
  equal((await allocs(docA, "reserved")).length, 4);
  // on a revision with a BOM and no holds it is cleared
  const docC = await newDoc("RP-CLEAR");
  await save(docC, payloadOf({ bom: BOM }));
  equal((await bomOf(docC)).length, 4);
  const cleared = await save(docC, payloadOf({ bom: [] }));
  equal(cleared.status, 201);
  equal(await bomOf(docC), []);
});

test("4. a correction that does not touch the sheet data leaves the BOM, equipment and allocations exactly as they are", async () => {
  const before = { b: await bomOf(docA), a: await allocs(docA), e: await equipment(docA) };
  const p = payloadOf({ bom: BOM, sheetMarkup: { items: [W("w1", "1", "2"), W("w2", "2", "2", "3"), EQ("e1", "V-1", { c1: "7" })] } });
  const run1 = (await save(docA, p)).body.run.id;
  const moved = JSON.parse(JSON.stringify(p)); moved.nodes[2].N += 1000; moved.nodes[3].N += 1000;
  const r = await correct(run1, moved);
  equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert(!r.body.sheetData, "geometry only: no dependents were re-made");
  equal({ b: await bomOf(docA), a: await allocs(docA), e: await equipment(docA) }, before);
  runA = run1;
});

test("5. a correction that changes the BOM re-makes the BOM and the allocations against it", async () => {
  const p = payloadOf({ bom: BOM, sheetMarkup: { items: [W("w1", "1", "2"), W("w2", "2", "2", "3"), EQ("e1", "V-1", { c1: "7" })] } });
  const changed = JSON.parse(JSON.stringify(p));
  changed.bom[2].qty = 5;            // elbows 3 → 5
  changed.sheetMarkup.items.push(W("w3", "3", "3", "3"));   // a third weld on the elbows
  const r = await correct(runA, changed);
  equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  equal(r.body.sheetData.bom.mode, "replace");
  equal(Number((await bomOf(docA)).find((b) => b.pt === 3).qty), 5, "the saved BOM follows the correction");
  const mine = await allocs(docA, "reserved");
  equal(mine.filter((a) => a.pt === 3).map((a) => [a.owner_ref, Number(a.qty)]), [[UID("w2"), 1], [UID("w3"), 2]]);
});

test("6. allocation capacity is enforced on a correction: more than the BOM row has is refused and undone", async () => {
  const before = { b: await bomOf(docA), a: await allocs(docA), reg: await n("SELECT count(*) AS n FROM weld WHERE extraction_run_id = $1", [runA]) };
  const over = payloadOf({ bom: BOM.map((b) => (b.pt === 2 ? { ...b, qty: 1 } : b)), sheetMarkup: { items: [W("w1", "1", "2"), W("w2", "2", "2", "3"), W("w3", "3", "3", "3"), EQ("e1", "V-1", { c1: "7" })] } });
  const r = await correct(runA, over);
  equal(r.status, 409, JSON.stringify(r.body).slice(0, 300));
  equal({ b: await bomOf(docA), a: await allocs(docA), reg: await n("SELECT count(*) AS n FROM weld WHERE extraction_run_id = $1", [runA]) }, before, "BOM, ledger and register as they were");
  const stored = (await q("SELECT payload FROM extraction_run WHERE id = $1", [runA]))[0].payload;
  assert(stored.bom.find((b) => b.pt === 2).qty === 2, "even the payload of the run is the old one");
});

test("8. an installed line is never released by a correction", async () => {
  const [line] = (await allocs(docA, "reserved")).filter((a) => a.pt === 7);
  const id = (await q("SELECT id FROM bom_allocation WHERE document_id = $1 AND pt = 7 AND status = 'reserved'", [docA]))[0].id;
  await inP(() => al.transition(db, { projectId, documentId: docA, allocationId: id, action: "install", userId: null }));
  const gone = payloadOf({ bom: BOM, sheetMarkup: { items: [W("w1", "1", "2"), W("w2", "2", "2", "3"), W("w3", "3", "3", "3")] } });   // the valve's mark is gone
  gone.bom[2].qty = 5;
  const r = await correct(runA, gone);
  equal(r.status, 409, JSON.stringify(r.body).slice(0, 300));
  assert(/نصب‌شده/.test(r.body.error), r.body.error);
  equal((await allocs(docA, "installed")).map((a) => a.pt), [7]);
  void line;
});

test("9. installed or tested equipment, and its accessories, are not dropped by a correction", async () => {
  await inP(async () => { await db.query("UPDATE iso_equipment SET status = 'tested' WHERE document_id = $1 AND mark_id = $2", [docA, UID("e1")]); });
  const noMark = payloadOf({ bom: BOM, sheetMarkup: { items: [W("w1", "1", "2"), W("w2", "2", "2", "3"), W("w3", "3", "3", "3")] } });
  noMark.bom[2].qty = 5;
  const r = await correct(runA, noMark);
  equal(r.status, 409);
  assert(/tested|ثبت است/.test(r.body.error), r.body.error);
  equal((await equipment(docA)).map((e) => [e.mark_id, e.status]), [[UID("e1"), "tested"]]);
});

test("a BOM change on a revision with an approved run is refused: a signed BOM changes by a new revision", async () => {
  const doc = await newDoc("RP-SIGNED");
  const first = await save(doc, payloadOf({ bom: BOM }));
  const ap = await json(await approveRoute.POST(req(`http://x/api/runs/${first.body.run.id}/approve`, { method: "POST", body: { projectId } }), ctx(first.body.run.id)));
  equal(ap.status, 200, JSON.stringify(ap.body).slice(0, 200));
  const again = await save(doc, payloadOf({ bom: [{ ...BOM[0], qty: 9 }] }));
  equal(again.status, 409);
  equal(again.body.code, "REVISION_ALREADY_APPROVED");
  equal((await bomOf(doc)).length, 4);
  // and the service itself refuses, whoever calls it
  await throws(() => inP(() => db.transaction((tx) => persistence.syncSheetData(tx, { projectId, documentId: doc, payload: { bom: [{ ...BOM[0], qty: 9 }] } }))), "BOM_LOCKED");
  await throws(() => inP(() => db.transaction((tx) => persistence.syncSheetData(tx, { projectId, documentId: doc, payload: { bom: [] } }))), "BOM_LOCKED");
});

test("a correction of a run that is not the revision's current one cannot change the sheet data", async () => {
  const doc = await newDoc("RP-OLD");
  const older = await save(doc, payloadOf({ bom: BOM }));
  const newer = await save(doc, payloadOf({ bom: BOM }));
  assert(newer.body.run.id !== older.body.run.id);
  const changed = payloadOf({ bom: BOM.map((b) => (b.pt === 1 ? { ...b, qty: 99 } : b)) });
  const r = await correct(older.body.run.id, changed);
  equal(r.status, 409);
  equal(r.body.code, "RUN_NOT_CURRENT");
  equal(Number((await bomOf(doc)).find((b) => b.pt === 1).qty), 6);
  // geometry on that older run is still correctable
  const geo = payloadOf({ bom: BOM }); geo.nodes[2].N += 500;
  equal((await correct(older.body.run.id, geo)).status, 200);
});

test("11. one dependent failing undoes the whole save: no run, no register, no BOM, no equipment, no allocations", async () => {
  const doc = await newDoc("RP-ATOMIC");
  const runsBefore = await n("SELECT count(*) AS n FROM extraction_run WHERE document_id = $1", [doc]);
  // the second mark's accessory names a PT the BOM does not have: the equipment sync refuses AFTER the BOM and register were written
  const bad = payloadOf({ bom: BOM, sheetMarkup: { items: [W("w1", "1", "2"), W("w2", "2", "2", "3"), W("w3", "3", "2")] } });   // three welds on two flanges
  const r = await save(doc, bad);
  equal(r.status, 409, JSON.stringify(r.body).slice(0, 200));
  equal(await n("SELECT count(*) AS n FROM extraction_run WHERE document_id = $1", [doc]), runsBefore, "no run left");
  equal(await n("SELECT count(*) AS n FROM weld w JOIN extraction_run r ON r.id = w.extraction_run_id WHERE r.document_id = $1", [doc]), 0);
  equal(await bomOf(doc), []);
  equal(await allocs(doc), []);
  equal(await equipment(doc), []);
});

test("12. a new revision of the drawing has its own BOM and ledger; the old revision's stay as they were", async () => {
  const docB = await newDoc("RP-A", "B");
  const r = await save(docB, payloadOf({ bom: BOM.map((b) => (b.pt === 2 ? { ...b, qty: 3 } : b)), sheetMarkup: { items: [W("w9", "9", "2")] } }));
  equal(r.status, 201);
  equal(Number((await bomOf(docB)).find((b) => b.pt === 2).qty), 3);
  equal((await allocs(docB)).map((a) => a.owner_ref), [UID("w9")]);
  equal(Number((await bomOf(docA)).find((b) => b.pt === 2).qty), 2, "revision 0 keeps its own BOM");
  assert((await allocs(docA)).length >= 4, "and its own ledger");
});

await run();
