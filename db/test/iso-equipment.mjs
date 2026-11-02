#!/usr/bin/env node
/**
 * Installation equipment (owner's request of 2026-11-02; migration 098,
 * lib/db/repos/iso-equipment.mjs): an item on the sheet — a triangle — joined to
 * several welds, with accessories that are BOM rows; its register kept with
 * keys; what it takes of the BOM bounded by the row's quantity and kept in
 * the allocation ledger; nothing installed dropped by a save.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { ledgerDemands, pieceUsage, allocationChecks } from "../../lib/register/bom-allocation.mjs";

const BOM = [
  { pt: 1, group: "PIPE", description: "PIPE S40 BE API 5L-B", diam: "4", qty: 6, qtyUnit: "m" },
  { pt: 2, group: "VALVES", description: "VALVE GATE 150# RF A216-WCB", diam: "4", qty: 2, qtyUnit: "pcs" },
  { pt: 3, group: "GASKETS", description: "GASKET SPIRAL WOUND 150#", diam: "4", qty: 4, qtyUnit: "pcs" },
  { pt: 4, group: "BOLTS", description: "STUD BOLT A193-B7 W/2 NUTS", diam: "5/8", qty: 16, qtyUnit: "pcs" },
  { pt: 5, group: "FLANGES", description: "FLANGE WELD NECK RF 150# A105 BW", diam: "4", qty: 4, qtyUnit: "pcs" },
];
const W = (id, no, c1, c2) => ({ id, kind: "weld-shop", no, attrs: { ...(c1 ? { c1 } : {}), ...(c2 ? { c2 } : {}) } });
const EQ = (id, no, attrs) => ({ id, kind: "equipment", no, x: 0.4, y: 0.4, ax: 0.38, ay: 0.42, attrs });

test("what the installed items take of the BOM: the item's row once, each accessory by its quantity — bounded by the row's quantity", () => {
  const items = [EQ("e1", "GV-1", { c1: "2", welds: "1, 2", acc: "3×1, 4×8" }), EQ("e2", "GV-2", { c1: "2", acc: "3×1, 4×8" })];
  equal(ledgerDemands(items, BOM).map((d) => [d.ownerKind, d.ownerRef, d.pt, d.qty, d.unit]),
    [["equipment", "e1", 2, 1, "pcs"], ["accessory", "e1", 3, 1, "pcs"], ["accessory", "e1", 4, 8, "pcs"], ["equipment", "e2", 2, 1, "pcs"], ["accessory", "e2", 3, 1, "pcs"], ["accessory", "e2", 4, 8, "pcs"]]);
  const u = pieceUsage(items, BOM);
  equal([u.get("2").used, u.get("2").left, u.get("3").left, u.get("4").left], [2, 0, 2, 0]);
  equal(allocationChecks(items, BOM), []);
  const over = allocationChecks([...items, EQ("e3", "GV-3", { c1: "2", acc: "4×1" })], BOM);
  equal(over.length, 2);
  assert(/PT 2 .*خواسته‌اند ولی BOM فقط 2 دارد/.test(over[0]) && /PT 4 .*17 از آن خواسته‌اند ولی BOM فقط 16/.test(over[1]), over.join("|"));
});

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("equipment-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const docs = await import("../../lib/db/repos/documents.mjs");
const ll = await import("../../lib/db/repos/line-list.mjs");
const al = await import("../../lib/db/repos/bom-allocation.mjs");
const eq = await import("../../lib/db/repos/iso-equipment.mjs");
const db = await getDb();
const U = await projects.ensureUser(db, { subject: "kc|eq-a", displayName: "a" });
const U2 = await projects.ensureUser(db, { subject: "kc|eq-b", displayName: "b" });
const P = (await projects.createProject(db, { code: "EQ1", name: "A", ownerUserId: U.id })).id;
const P2 = (await projects.createProject(db, { code: "EQ2", name: "B", ownerUserId: U2.id })).id;
const inP = (fn) => withProject(db, P, fn);
const { document: D } = await docs.registerDocument(db, { projectId: P, docNo: "ISO-EQ-1", revision: "A0", sheetNo: "1/1", fileSha256: "e".repeat(64), storageUri: "local://eq1" });
await inP(() => ll.saveIsoBom(db, { projectId: P, documentId: D.id, bom: BOM, createdBy: U.id }));
const save = (items) => inP(() => db.transaction(async (tx) => {
  const e = await eq.syncEquipment(tx, { projectId: P, documentId: D.id, items, bom: BOM, userId: U.id });
  const a = await al.syncAllocations(tx, { projectId: P, documentId: D.id, demands: ledgerDemands(items, BOM), userId: U.id });
  return { e, a };
}));
const list = () => inP(() => eq.listEquipment(db, { projectId: P, documentId: D.id }));
const ledger = () => inP(() => al.availability(db, { projectId: P, documentId: D.id }));
const WELDS = [W("w1", "1", "5", "1"), W("w2", "2", "1", "5"), W("w3", "3")];

test("saved: one equipment joined to two welds, with accessories; the register has keys; the BOM lines are reserved", async () => {
  const r = await save([...WELDS, EQ("e1", "GV-1", { type: "Gate Valve", tag: "GV-001", c1: "2", spool: "SP-1", welds: "1, 2", acc: "3×1, 4×8", status: "planned" })]);
  equal(r.e, { equipment: 1, removed: 0 });
  const [g] = await list();
  equal([g.no, g.tag, g.type, g.pt, g.spool, g.status], ["GV-1", "GV-001", "Gate Valve", 2, "SP-1", "planned"]);
  equal(g.welds.map((w) => w.no), ["1", "2"]);
  equal(g.accessories.map((a) => [a.pt, a.qty, a.unit, a.status]), [[3, 1, "pcs", "planned"], [4, 8, "pcs", "planned"]]);
  const a = await ledger();
  const row = (pt) => a.rows.find((x) => x.pt === pt);
  equal([row(2).reserved, row(3).reserved, row(4).reserved], [1, 1, 8], "the valve itself and its accessories, apart from the welds' ends");
  equal([row(2).left, row(3).left, row(4).left], [1, 3, 8]);
});

test("a weld number that is not on the sheet is not joined; saving again changes the joins and accessories, keeping an accessory's own status", async () => {
  await inP(async () => { const [g] = await eq.listEquipment(db, { projectId: P, documentId: D.id }); await eq.setAccessoryStatus(db, { projectId: P, accessoryId: g.accessories[0].id, status: "delivered" }); });
  await save([...WELDS, EQ("e1", "GV-1", { type: "Gate Valve", tag: "GV-001", c1: "2", spool: "SP-1", welds: "2, 3, 99", acc: "3×2, 4×8" })]);
  const [g] = await list();
  equal(g.welds.map((w) => w.no), ["2", "3"], "99 is not a weld of the sheet");
  equal(g.accessories.map((a) => [a.pt, a.qty, a.status]), [[3, 2, "delivered"], [4, 8, "planned"]], "the gasket's quantity changed, its own status kept");
  equal((await ledger()).rows.find((x) => x.pt === 3).reserved, 2);
});

test("accessories are bounded by the BOM row's quantity: 5 gaskets of 4 are refused, and the whole save is undone", async () => {
  await throws(() => save([...WELDS, EQ("e1", "GV-1", { c1: "2", welds: "2", acc: "3×5" })]), "فقط");
  equal((await list())[0].accessories.find((a) => a.pt === 3).qty, 2, "the register and the ledger are as they were");
  equal((await ledger()).rows.find((x) => x.pt === 3).reserved, 2);
});

test("a second equipment takes the other valve; a third finds none left (the pool is the row's quantity)", async () => {
  await save([...WELDS, EQ("e1", "GV-1", { c1: "2", welds: "2", acc: "3×2" }), EQ("e2", "GV-2", { c1: "2", welds: "1" })]);
  await throws(() => save([...WELDS, EQ("e1", "GV-1", { c1: "2", welds: "2", acc: "3×2" }), EQ("e2", "GV-2", { c1: "2" }), EQ("e3", "GV-3", { c1: "2" })]), "فقط");
  equal((await list()).length, 2);
});

test("an equipment installed, or an accessory installed, is not dropped by a save; once returned it can be", async () => {
  await inP(() => db.query("UPDATE iso_equipment SET status = 'installed' WHERE equipment_no = 'GV-2'"));
  await throws(() => save([...WELDS, EQ("e1", "GV-1", { c1: "2", welds: "2", acc: "3×2" })]), "«installed»");
  equal((await list()).length, 2);
  await inP(() => db.query("UPDATE iso_equipment SET status = 'planned' WHERE equipment_no = 'GV-2'"));
  await inP(async () => { const [g] = await eq.listEquipment(db, { projectId: P, documentId: D.id }); await eq.setAccessoryStatus(db, { projectId: P, accessoryId: g.accessories[0].id, status: "installed" }); });
  await throws(() => save([...WELDS, EQ("e1", "GV-1", { c1: "2", welds: "2", acc: "4×1" })]), "«installed»");
  await inP(() => db.query("UPDATE iso_equipment_accessory SET status = 'planned'"));
  const r = await save([...WELDS, EQ("e1", "GV-1", { c1: "2", welds: "2", acc: "3×2" })]);
  equal([r.e.removed, (await list()).length], [1, 1]);
  const h = await inP(() => al.history(db, { projectId: P, documentId: D.id }));
  assert(h.some((e) => e.event === "release" && e.ownerKind === "equipment" && /removed from the sheet/.test(e.reason)), "its BOM line was released with a reason");
});

test("a status that is not one of the four, and an unknown accessory, are refused by the database or the repo", async () => {
  await throws(() => inP(() => db.query("UPDATE iso_equipment SET status = 'broken'")), "23514");
  await throws(() => inP(() => eq.setAccessoryStatus(db, { projectId: P, accessoryId: "00000000-0000-0000-0000-000000000000", status: "installed" })), "not found");
  await throws(() => inP(() => eq.setAccessoryStatus(db, { projectId: P, accessoryId: "00000000-0000-0000-0000-000000000000", status: "lost" })), "status must");
  await throws(() => inP(() => db.query("INSERT INTO iso_equipment_weld (project_id, equipment_id, weld_ref) VALUES ($1, $2, 'x')", [P, "00000000-0000-0000-0000-000000000000"])), "23503");
});

test("another project sees none of it", async () => {
  await withProject(db, P2, async () => {
    for (const t of ["iso_equipment", "iso_equipment_weld", "iso_equipment_accessory"]) equal((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0);
  });
});

// ── through the real routes ──────────────────────────────────────────────────────────────────────
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const apiRoute = await import("../../app/api/iso-equipment/route.js");
const { DEMO } = await import("../../lib/demo.js");
const req = (url, { method = "GET", body } = {}) => new Request(url, { method, headers: { authorization: "Bearer kc|alice", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const AP = (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "EQ3", name: "api" } })))).body.project;
const adoc = (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", body: { projectId: AP.id, docNo: "ISO-EQ-API", revision: "0", fileBase64: Buffer.from("scan").toString("base64") } })))).body.document;
const post = async (marks) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId: AP.id, documentId: adoc.id,
  payload: { ...structuredClone(DEMO), meta: { ...DEMO.meta, rev: "0", lineNo: '6"-EQ-1-A1', drawingNo: "ISO-EQ-API" }, bom: BOM, sheetMarkup: { page: 1, items: marks } } } })));

test("API: a run saved with equipment keeps its register; the equipment API lists it with welds and accessories; too many accessories refuse the save", async () => {
  const r = await post([...WELDS, EQ("e1", "GV-1", { type: "Gate Valve", c1: "2", welds: "1, 2", acc: "3×2" })]);
  equal([r.status, r.body.equipment, r.body.allocation.reserved >= 3], [201, { equipment: 1, removed: 0 }, true]);
  const l = (await json(await apiRoute.GET(req(`http://x/api/iso-equipment?projectId=${AP.id}&documentId=${adoc.id}`)))).body.equipment;
  equal([l.length, l[0].welds.map((w) => w.no), l[0].accessories.map((a) => [a.pt, a.qty])], [1, ["1", "2"], [[3, 2]]]);
  const set = await json(await apiRoute.POST(req("http://x/api/iso-equipment", { method: "POST", body: { projectId: AP.id, accessoryId: l[0].accessories[0].id, status: "installed" } })));
  equal(set.status, 200);
  const bad = await post([...WELDS, EQ("e1", "GV-1", { type: "Gate Valve", c1: "2", welds: "1, 2", acc: "3×9" })]);
  equal(bad.status, 409);
});

await run();
