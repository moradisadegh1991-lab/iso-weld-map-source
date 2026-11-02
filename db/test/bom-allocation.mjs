#!/usr/bin/env node
/**
 * Who uses what of a sheet's BOM (owner's request of 2026-11-02; migration 097,
 * lib/register/bom-allocation.mjs, lib/db/repos/bom-allocation.mjs): a flange
 * reserved by one weld is not offered to a third when two are all there is; an
 * elbow's two ends serve two welds; pipe is by length; the ceiling is the
 * database's; a save is all or nothing; nothing installed is released by a save.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { rowCapacity, weldDemands, usage, canTake, allocationChecks, ledgerDemands } from "../../lib/register/bom-allocation.mjs";

const BOM = [
  { pt: 1, group: "PIPE", description: "PIPE S40 BE API 5L-B", diam: "4", qty: 6, qtyUnit: "m" },
  { pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 2, qtyUnit: "pcs" },
  { pt: 3, group: "FITTINGS", description: "ELBOW 90 LR BW A234-WPB", diam: "4", qty: 1, qtyUnit: "pcs" },
  { pt: 4, group: "GASKETS", description: "GASKET SPIRAL WOUND 300#", diam: "4", qty: 2, qtyUnit: "pcs" },
  { pt: 5, group: "FITTINGS", description: "SPECIAL FITTING X", diam: "4", qty: 3, qtyUnit: "pcs" },
  { pt: 6, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: null, qtyUnit: "pcs" },
];
const W = (id, no, c1, c2) => ({ id, kind: "weld-shop", no, attrs: { ...(c1 ? { c1 } : {}), ...(c2 ? { c2 } : {}) } });

test("what a BOM row can give a weld: a counted fitting its quantity × its welded ends; pipe nothing per weld; no joint none; unknown no ceiling", () => {
  equal(rowCapacity(BOM[1]).capacity, 2, "two weld-neck flanges: one end each");
  equal(rowCapacity(BOM[2]).capacity, 2, "one elbow: two ends");
  equal(rowCapacity(BOM[0]), { mode: "length", qty: 6, unit: "m", perUnit: null, capacity: null, item: "pipe" });
  equal([rowCapacity(BOM[3]).mode, rowCapacity(BOM[3]).capacity], ["none", 0]);
  equal([rowCapacity(BOM[4]).mode, rowCapacity(BOM[4]).capacity], ["unknown", null], "the description does not say: not guessed");
  equal(rowCapacity(BOM[5]).capacity, null, "no quantity read: no ceiling");
});

test("two flanges serve two welds; a third is refused, with the reason; the same flange stays allowed where it already is", () => {
  const items = [W("a", "1", "2", "1"), W("b", "2", "2"), W("c", "3")];
  equal(usage(items, BOM).get("2").used, 2);
  equal(usage(items, BOM).get("2").left, 0);
  const no = canTake(items, BOM, "c", "c1", "2");
  assert(!no.ok && /هیچ سری/.test(no.why), "refused for the third weld");
  assert(canTake(items, BOM, "b", "c1", "2").ok, "weld 2 keeps the one it has");
  assert(canTake(items, BOM, "c", "c1", "1").ok, "pipe is by length: not counted per weld");
  equal(usage([...items, W("d", "4", "1", "1")], BOM).get("1").used, 0, "and it is not in the used count either");
  assert(canTake(items, BOM, "c", "c1", "5").ok && canTake(items, BOM, "c", "c1", "6").ok, "no known ceiling: allowed");
  assert(!canTake(items, BOM, "c", "c1", "4").ok, "a gasket has no welded end");
  assert(canTake(items, BOM, "c", "c1", "99").ok, "a PT not in the BOM is reported elsewhere, not blocked here");
});

test("one elbow serves two welds (its two ends); a third is over", () => {
  const items = [W("a", "1", "3"), W("b", "2", "3")];
  equal(usage(items, BOM).get("3").left, 0);
  assert(!canTake([...items, W("c", "3")], BOM, "c", "c1", "3").ok);
  equal(allocationChecks(items, BOM), []);
  const over = allocationChecks([...items, W("c", "3", "3")], BOM);
  equal(over.length, 1);
  assert(/3 سر جوش به آن داده شده ولی فقط 2 سر دارد/.test(over[0]), over[0]);
});

test("the same flange on both sides of one weld takes two ends; a row no weld can use is named", () => {
  equal(usage([W("a", "1", "2", "2")], BOM).get("2").used, 2);
  assert(allocationChecks([W("a", "1", "4")], BOM)[0].includes("سر جوشی‌شدنی ندارد"));
});

test("the ledger's lines: one per weld and counted row, its quantity the ends taken; pipe and unknown PTs are not in it", () => {
  const items = [W("a", "1", "2", "2"), W("b", "2", "3", "1"), W("c", "3", "99")];
  equal(ledgerDemands(items, BOM).map((d) => [d.ownerRef, d.pt, d.qty]), [["a", 2, 2], ["b", 3, 1]]);
  equal(weldDemands([{ id: "s", kind: "spool", no: "SP-1", attrs: { c1: "2" } }]), [], "only welds name components");
});

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("bom-alloc-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const docs = await import("../../lib/db/repos/documents.mjs");
const ll = await import("../../lib/db/repos/line-list.mjs");
const al = await import("../../lib/db/repos/bom-allocation.mjs");
const db = await getDb();
const U = await projects.ensureUser(db, { subject: "kc|ba-a", displayName: "a" });
const U2 = await projects.ensureUser(db, { subject: "kc|ba-b", displayName: "b" });
const P = (await projects.createProject(db, { code: "BA1", name: "A", ownerUserId: U.id })).id;
const P2 = (await projects.createProject(db, { code: "BA2", name: "B", ownerUserId: U2.id })).id;
const inP = (fn) => withProject(db, P, fn);
const { document: D } = await docs.registerDocument(db, { projectId: P, docNo: "ISO-BA-1", revision: "A0", sheetNo: "1/1", fileSha256: "b".repeat(64), storageUri: "local://ba1" });
await inP(() => ll.saveIsoBom(db, { projectId: P, documentId: D.id, bom: BOM, createdBy: U.id }));
const demands = (items) => ledgerDemands(items, BOM);
const sync = (items, userId = U.id) => inP(() => db.transaction((tx) => al.syncWeldAllocations(tx, { projectId: P, documentId: D.id, demands: demands(items), userId })));
const view = () => inP(() => al.availability(db, { projectId: P, documentId: D.id }));
const row = (a, pt) => a.rows.find((r) => r.pt === pt);

test("the BOM's weld ceilings are saved with it: flanges 2, elbow 2, pipe/gasket/unknown as the rules say", async () => {
  const a = await view();
  equal(a.rows.map((r) => [r.pt, r.weldEnds]), [[1, null], [2, 2], [3, 2], [4, 0], [5, null], [6, null]]);
});

test("saving the sheet reserves each weld's ends; the ledger shows reserved and left; the history records it", async () => {
  const r = await sync([W("a", "1", "2", "1"), W("b", "2", "2", "3")]);
  equal(r, { reserved: 3, adjusted: 0, released: 0 });
  const a = await view();
  equal([row(a, 2).weldReserved, row(a, 2).weldLeft, row(a, 3).weldReserved, row(a, 3).weldLeft], [2, 0, 1, 1]);
  assert(a.lines.every((l) => l.status === "reserved" && l.ownerKind === "weld"));
  const h = await inP(() => al.history(db, { projectId: P, documentId: D.id }));
  equal([h.length, h.every((e) => e.event === "reserve")], [3, true]);
});

test("the same sheet saved again changes nothing; a third weld taking the last flange is refused and the save is undone", async () => {
  equal(await sync([W("a", "1", "2", "1"), W("b", "2", "2", "3")]), { reserved: 0, adjusted: 0, released: 0 });
  await throws(() => sync([W("a", "1", "2", "1"), W("b", "2", "2", "3"), W("c", "3", "2")]), "فقط 0 از 2 باقی");
  const a = await view();
  equal(a.lines.length, 3, "nothing of the refused save is left");
});

test("moving a flange from one weld to another in one save works (released first); removing a weld releases its lines with a recorded reason", async () => {
  const r = await sync([W("a", "1", "1"), W("c", "3", "2", "2")]);
  equal([r.released > 0, r.reserved > 0], [true, true]);
  const a = await view();
  equal([row(a, 2).weldReserved, row(a, 3).weldReserved], [2, 0]);
  const h = await inP(() => al.history(db, { projectId: P, documentId: D.id }));
  assert(h.some((e) => e.event === "release" && /removed from the sheet/.test(e.reason)), "released with a reason, not silently");
});

test("install, then the save cannot release it; returning needs a reason and gives the ends back; release is for reserved lines only", async () => {
  const lines = (await view()).lines.filter((l) => l.pt === 2);
  await inP(() => db.transaction((tx) => al.transition(tx, { projectId: P, documentId: D.id, allocationId: lines[0].id, action: "install", userId: U.id })));
  let a = await view();
  equal([row(a, 2).weldInstalled, row(a, 2).weldReserved, row(a, 2).weldLeft], [2, 0, 0]);
  await throws(() => sync([W("a", "1", "1")]), "نصب‌شده ثبت است");
  await throws(() => inP(() => db.transaction((tx) => al.transition(tx, { projectId: P, documentId: D.id, allocationId: lines[0].id, action: "release", reason: "x", userId: U.id }))), "فقط برای «reserved»");
  await throws(() => inP(() => db.transaction((tx) => al.transition(tx, { projectId: P, documentId: D.id, allocationId: lines[0].id, action: "return", userId: U.id }))), "دلیل");
  await inP(() => db.transaction((tx) => al.transition(tx, { projectId: P, documentId: D.id, allocationId: lines[0].id, action: "return", reason: "wrong flange", userId: U.id })));
  a = await view();
  equal([row(a, 2).weldInstalled, row(a, 2).weldLeft, row(a, 2).returned], [0, 2, 2]);
  equal((await sync([W("a", "1", "1")])).released, 0, "nothing left to release now");
});

test("the ceiling is the database's: a line written straight in that takes more than is left is refused, whoever writes it", async () => {
  await sync([W("a", "1", "2"), W("b", "2", "2")]);
  await throws(() => inP(() => db.query(
    "INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, qty, unit) VALUES ($1, $2, 2, 'weld', 'zz', 1, 'pcs')", [P, D.id])), "23514");
  await throws(() => inP(() => db.query(
    "INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, qty, unit) VALUES ($1, $2, 77, 'weld', 'zz', 1, 'pcs')", [P, D.id])), "23503");
  // other owners draw on the row's quantity (2 flanges), apart from the welds' ends
  await inP(() => db.query("INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, qty, unit) VALUES ($1, $2, 2, 'accessory', 'eq1', 2, 'pcs')", [P, D.id]));
  await throws(() => inP(() => db.query("INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, qty, unit) VALUES ($1, $2, 2, 'accessory', 'eq2', 1, 'pcs')", [P, D.id])), "23514");
  await inP(() => db.query("UPDATE bom_allocation SET status = 'released' WHERE owner_ref = 'eq1'"));
});

test("a length row is allocated by length and can be shared: 2 m + 2.5 m of a 6 m pipe, 1.5 m left, 2 m more refused", async () => {
  const q = (ref, qty) => inP(() => db.query("INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, qty, unit) VALUES ($1, $2, 1, 'spool', $3, $4, 'm')", [P, D.id, ref, qty]));
  await q("SP-A", 2); await q("SP-B", 2.5);
  const a = await view();
  equal([row(a, 1).reserved, row(a, 1).left], [4.5, 1.5]);
  await throws(() => q("SP-C", 2), "23514");
});

test("two saves taking the last flange at once: one wins, one is refused (the row is locked)", async () => {
  await inP(() => db.query("UPDATE bom_allocation SET status = 'released' WHERE owner_kind = 'weld'"));
  const one = (ref) => inP(() => db.transaction((tx) => tx.query("INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, qty, unit) VALUES ($1, $2, 2, 'weld', $3, 2, 'pcs')", [P, D.id, ref])));
  const r = await Promise.allSettled([one("x1"), one("x2")]);
  equal(r.map((x) => x.status).sort(), ["fulfilled", "rejected"]);
});

test("a smaller BOM saved over live reservations is refused until they are released; a lost PT too", async () => {
  const small = BOM.map((b) => (b.pt === 2 ? { ...b, qty: 1 } : b));
  await inP(() => ll.saveIsoBom(db, { projectId: P, documentId: D.id, bom: small, createdBy: U.id }));
  await throws(() => inP(() => al.verifyLedger(db, { projectId: P, documentId: D.id })), "BOM اکنون فقط 1 دارد");
  await inP(() => ll.saveIsoBom(db, { projectId: P, documentId: D.id, bom: small.filter((b) => b.pt !== 2), createdBy: U.id }));
  await throws(() => inP(() => al.verifyLedger(db, { projectId: P, documentId: D.id })), "از BOM حذف شده");
  await inP(() => ll.saveIsoBom(db, { projectId: P, documentId: D.id, bom: BOM, createdBy: U.id }));
  await inP(() => al.verifyLedger(db, { projectId: P, documentId: D.id }));
});

test("another project sees none of it", async () => {
  await withProject(db, P2, async () => {
    equal((await db.query("SELECT count(*)::int AS n FROM bom_allocation")).rows[0].n, 0);
    equal((await db.query("SELECT count(*)::int AS n FROM bom_allocation_event")).rows[0].n, 0);
  });
});

// ── through the real routes: the run save and the allocation API ───────────────────────────────────
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const allocRoute = await import("../../app/api/bom-allocations/route.js");
const { DEMO } = await import("../../lib/demo.js");
const req = (url, { method = "GET", as = "kc|alice", body } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const AP = (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "BA3", name: "api" } })))).body.project;
const adoc = (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", body: { projectId: AP.id, docNo: "ISO-BA-API", revision: "0", fileBase64: Buffer.from("scan").toString("base64") } })))).body.document;
const payload = (marks) => ({ ...structuredClone(DEMO), meta: { ...DEMO.meta, rev: "0", lineNo: '6"-BA-1-A1', drawingNo: "ISO-BA-API" }, bom: BOM, sheetMarkup: { page: 1, items: marks } });
const save = async (marks) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId: AP.id, documentId: adoc.id, payload: payload(marks) } })));
const alloc = async () => (await json(await allocRoute.GET(req(`http://x/api/bom-allocations?projectId=${AP.id}&documentId=${adoc.id}&history=1`)))).body;
const runs = async () => Number((await db.query("SELECT count(*) AS n FROM extraction_run WHERE document_id = $1", [adoc.id])).rows[0].n);

test("API: a run saved with weld components reserves them; the allocation view shows reserved, left and the history", async () => {
  const r = await save([W("a", "1", "2", "1"), W("b", "2", "2", "3")]);
  equal([r.status, r.body.allocation], [201, { reserved: 3, adjusted: 0, released: 0 }]);
  const a = await alloc();
  equal([row(a, 2).weldReserved, row(a, 2).weldLeft, a.history.length], [2, 0, 3]);
});

test("API: a save that names a flange the BOM no longer has is refused (409) and leaves no run and no ledger change", async () => {
  const before = { runs: await runs(), ledger: (await alloc()).lines.length };
  const r = await save([W("a", "1", "2", "1"), W("b", "2", "2", "3"), W("c", "3", "2")]);
  equal(r.status, 409);
  assert(/PT 2/.test(r.body.error), r.body.error);
  equal({ runs: await runs(), ledger: (await alloc()).lines.length }, before);
});

test("API: install a line, return it with a reason; release is closed once the register is approved", async () => {
  const a = await alloc();
  const line = a.lines.find((l) => l.pt === 3);
  const act = async (action, body = {}, as = "kc|alice") => json(await allocRoute.POST(req("http://x/api/bom-allocations", { method: "POST", as, body: { projectId: AP.id, documentId: adoc.id, allocationId: line.id, action, ...body } })));
  equal((await act("install")).status, 200);
  equal((await act("return")).status, 400, "a reason is needed");
  equal((await act("return", { reason: "wrong elbow" })).status, 200);
  equal((await alloc()).history.filter((e) => e.ownerNo === "2" || e.pt === 3).some((e) => e.event === "return" && e.reason === "wrong elbow"), true);
  // once the register is approved, a reservation is not released any more (a new revision is); installing stays open
  await db.query("UPDATE extraction_run SET status = 'approved', approved_at = now(), approved_sha256 = $2, approved_by = (SELECT id FROM app_user LIMIT 1) WHERE document_id = $1", [adoc.id, "c".repeat(64)]);
  const other = (await alloc()).lines.find((l) => l.pt === 2 && l.status === "reserved");
  const rel = await json(await allocRoute.POST(req("http://x/api/bom-allocations", { method: "POST", body: { projectId: AP.id, documentId: adoc.id, allocationId: other.id, action: "release", reason: "x" } })));
  equal(rel.status, 409);
  equal((await json(await allocRoute.POST(req("http://x/api/bom-allocations", { method: "POST", body: { projectId: AP.id, documentId: adoc.id, allocationId: other.id, action: "install" } })))).status, 200);
  equal((await save([W("a", "1", "2", "1")])).status, 409, "the register itself is not saved over");
});

await run();
