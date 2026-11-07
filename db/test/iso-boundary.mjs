#!/usr/bin/env node
/**
 * Phase 12.2.1 — isometric document-boundary hardening (docs/audit/phase-12-sld-intelligence.md §17.6, §18).
 * The isometric-only ledgers (BOM allocation, installed equipment, mark identity / warnings) are addressed by DOCUMENT id or by a CHILD id
 * (allocation, accessory, warning). A P&ID or SLD document must never reach them, neither by its own id nor through a child id:
 *
 *   A. isometric operations still work (availability, history, equipment list, warning list, install / return / status / sync).
 *   B. SLD and P&ID documents get 409 NOT_AN_ISOMETRIC_DOCUMENT on every protected route (GET and POST) and repo function; nothing is written.
 *   C. child ids: an allocation / accessory / warning of an SLD or P&ID document is refused even when the request names an ISOMETRIC document id,
 *      and an isometric child addressed with another isometric document id keeps its old answer; nothing is written.
 *   D. unknown ids and another project's ids keep their old 404; authorization and project scope are unchanged.
 *   E. source scan: every route that takes a document / child id and every repo that touches an isometric-only table is in a reviewed list.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("isob-db-");
process.env.STORAGE_ROOT = await scratchDir("isob-store-");
const R = (p) => import(`../../${p}`);
const projectsRoute = await R("app/api/projects/route.js"), documentsRoute = await R("app/api/documents/route.js");
const allocRoute = await R("app/api/bom-allocations/route.js"), equipRoute = await R("app/api/iso-equipment/route.js"), warnRoute = await R("app/api/mark-warnings/route.js");
const { getDb } = await R("lib/server/db.mjs"), { withProject } = await R("lib/db/scope.mjs");
const { ensureUser } = await R("lib/db/repos/projects.mjs");
const al = await R("lib/db/repos/bom-allocation.mjs"), eq = await R("lib/db/repos/iso-equipment.mjs"), mi = await R("lib/db/repos/mark-identity.mjs"), ll = await R("lib/db/repos/line-list.mjs");
const validationRepo = await R("lib/db/repos/validation.mjs");
const { ledgerDemands } = await R("lib/register/bom-allocation.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) => new Request(url, { method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const db = await getDb();
const mkProject = async (code, as = "kc|alice") => (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", as, body: { code, name: code } })))).body.project.id;
const P = await mkProject("ISB1"), OTHER = await mkProject("ISB2", "kc|mallory");
const inP = (fn, pid = P) => withProject(db, pid, fn);
const q = (sql, p = [], pid = P) => inP(async () => (await db.query(sql, p)).rows, pid);
let seq = 0;
const newDoc = async (docNo, docType, pid = P) => {
  const r = await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST", as: pid === P ? "kc|alice" : "kc|mallory", body: { projectId: pid, docNo, revision: "0", ...(docType ? { docType } : {}), fileBase64: Buffer.from(`f ${docNo} ${++seq}`).toString("base64"), contentType: "application/pdf" } })));
  assert(r.status === 201, JSON.stringify(r.body)); return r.body.document;
};
const BOM = [
  { pt: 1, group: "PIPE", description: "PIPE S40 BE API 5L-B", diam: "4", qty: 6, qtyUnit: "m" },
  { pt: 2, group: "VALVES", description: "VALVE GATE 150# RF A216-WCB", diam: "4", qty: 2, qtyUnit: "pcs" },
  { pt: 3, group: "GASKETS", description: "GASKET SPIRAL WOUND 150#", diam: "4", qty: 4, qtyUnit: "pcs" },
  { pt: 5, group: "FLANGES", description: "FLANGE WELD NECK RF 150# A105 BW", diam: "4", qty: 4, qtyUnit: "pcs" },
];
const W = (id, no, c1, c2) => ({ id, kind: "weld-shop", no, attrs: { ...(c1 ? { c1 } : {}), ...(c2 ? { c2 } : {}) } });
const EQ = (id, no, attrs) => ({ id, kind: "equipment", no, x: 0.4, y: 0.4, ax: 0.38, ay: 0.42, attrs });
const ITEMS = [W("w1", "1", "5", "1"), W("w2", "2", "1", "5"), EQ("e1", "GV-1", { type: "Gate Valve", tag: "GV-001", c1: "2", welds: "1, 2", acc: "3×1" })];
const alice = async () => (await ensureUser(db, { subject: "kc|alice" })).id;
const url = (path, o = {}) => `http://x/api/${path}?${new URLSearchParams(o)}`;
const get = async (route, path, o, as) => json(await route.GET(req(url(path, o), { as })));
const post = async (route, path, body, as) => json(await route.POST(req(`http://x/api/${path}`, { method: "POST", as, body })));

// A document of each kind in one project, each with a BOM, a ledger line, an equipment + accessory and a mark warning — seeded straight in SQL for the
// P&ID / SLD documents (the API can no longer create them), and through the real repos for the isometric one.
const D = {};
const seedByRepo = async (doc, userId) => {
  await inP(() => ll.saveIsoBom(db, { projectId: P, documentId: doc.id, bom: BOM, createdBy: userId }));
  await inP(() => db.transaction(async (tx) => {
    await eq.syncEquipment(tx, { projectId: P, documentId: doc.id, items: ITEMS, bom: BOM, userId });
    await al.syncAllocations(tx, { projectId: P, documentId: doc.id, demands: ledgerDemands(ITEMS, BOM), userId });
  }));
};
const seedBySql = async (doc, userId) => {
  await inP(() => ll.saveIsoBom(db, { projectId: P, documentId: doc.id, bom: BOM, createdBy: userId }));   // the BOM table is not under test: only the ledgers are
  await q("INSERT INTO bom_allocation (project_id, document_id, pt, owner_kind, owner_ref, qty, unit) VALUES ($1, $2, 5, 'weld', 'w1', 1, 'pcs')", [P, doc.id]);
  const [{ id: aid }] = await q("SELECT id FROM bom_allocation WHERE document_id = $1", [doc.id]);
  await q("INSERT INTO bom_allocation_event (project_id, document_id, allocation_id, event, qty_after, status_after) VALUES ($1, $2, $3, 'reserve', 1, 'reserved')", [P, doc.id, aid]);
  await q("INSERT INTO iso_equipment (project_id, document_id, mark_id, equipment_no, pt) VALUES ($1, $2, 'e1', 'GV-1', 2)", [P, doc.id]);
  await q("INSERT INTO iso_equipment_accessory (project_id, equipment_id, pt, qty) SELECT $1, id, 3, 1 FROM iso_equipment WHERE document_id = $2", [P, doc.id]);
  await q("INSERT INTO sheet_mark_warning (project_id, document_id, kind, detail) VALUES ($1, $2, 'ambiguous', '{}'::jsonb)", [P, doc.id]);
  await q("INSERT INTO sheet_mark_identity (uid, project_id, document_id, cls, legacy_id) VALUES (gen_random_uuid(), $1, $2, 'weld', 'w1')", [P, doc.id]);
};
const childIds = async (doc) => ({
  allocationId: (await q("SELECT id FROM bom_allocation WHERE document_id = $1 ORDER BY pt, owner_ref LIMIT 1", [doc.id]))[0]?.id,
  accessoryId: (await q("SELECT a.id FROM iso_equipment_accessory a JOIN iso_equipment e ON e.id = a.equipment_id WHERE e.document_id = $1 LIMIT 1", [doc.id]))[0]?.id,
  warningId: (await q("SELECT id FROM sheet_mark_warning WHERE document_id = $1 LIMIT 1", [doc.id]))[0]?.id,
});
const canon = (v) => JSON.stringify(v);
// every row of every isometric-only table, for the P&ID / SLD documents AND the isometric ones — a rejected operation must leave all of it byte-identical
const ledgerState = () => q(`SELECT 'alloc' AS t, row_to_json(a)::text AS r FROM bom_allocation a
  UNION ALL SELECT 'event', row_to_json(e)::text FROM bom_allocation_event e
  UNION ALL SELECT 'equip', row_to_json(e)::text FROM iso_equipment e
  UNION ALL SELECT 'acc', row_to_json(a)::text FROM iso_equipment_accessory a
  UNION ALL SELECT 'ew', row_to_json(w)::text FROM iso_equipment_weld w
  UNION ALL SELECT 'warn', row_to_json(w)::text FROM sheet_mark_warning w
  UNION ALL SELECT 'ident', row_to_json(i)::text FROM sheet_mark_identity i
  ORDER BY 1, 2`).then((rows) => canon(rows));
const is409 = (r, docType) => r.status === 409 && r.body.code === "NOT_AN_ISOMETRIC_DOCUMENT" && (!docType || r.body.details?.docType === docType);

test("setup: one project with an isometric, a P&ID and an SLD document, each with a BOM, ledger lines, equipment, an accessory and a mark warning", async () => {
  const uid = await alice();
  D.iso = await newDoc("ISO-B-1"); D.iso2 = await newDoc("ISO-B-2"); D.pid = await newDoc("PID-B-1", "pid"); D.sld = await newDoc("SLD-B-1", "sld");
  assert(D.iso.doc_type === "isometric" && D.pid.doc_type === "pid" && D.sld.doc_type === "sld");
  await seedByRepo(D.iso, uid); await seedByRepo(D.iso2, uid);
  await q("INSERT INTO sheet_mark_warning (project_id, document_id, kind, detail) VALUES ($1, $2, 'ambiguous', '{}'::jsonb)", [P, D.iso.id]);
  await q("INSERT INTO sheet_mark_warning (project_id, document_id, kind, detail) VALUES ($1, $2, 'ambiguous', '{}'::jsonb)", [P, D.iso2.id]);
  await seedBySql(D.pid, uid); await seedBySql(D.sld, uid);
  D.child = { iso: await childIds(D.iso), iso2: await childIds(D.iso2), pid: await childIds(D.pid), sld: await childIds(D.sld) };
  for (const k of ["iso", "iso2", "pid", "sld"]) for (const [n, v] of Object.entries(D.child[k])) assert(v, `${k}.${n} was seeded`);
  D.before = await ledgerState();
});

test("A1. isometric: availability, history, equipment list and warning list answer exactly as before", async () => {
  const a = await get(allocRoute, "bom-allocations", { projectId: P, documentId: D.iso.id, history: "1" });
  assert(a.status === 200 && a.body.rows.length === BOM.length && a.body.lines.length > 0 && a.body.history.length > 0, canon(a.body).slice(0, 300));
  const e = await get(equipRoute, "iso-equipment", { projectId: P, documentId: D.iso.id });
  assert(e.status === 200 && e.body.equipment.length === 1 && e.body.equipment[0].accessories.length === 1, canon(e.body).slice(0, 300));
  const w = await get(warnRoute, "mark-warnings", { projectId: P, documentId: D.iso.id });
  assert(w.status === 200 && w.body.warnings.length === 1, canon(w.body).slice(0, 300));
});

test("A2. isometric: install, return, release and an accessory status change still work (route level)", async () => {
  const { allocationId, accessoryId } = D.child.iso;
  const inst = await post(allocRoute, "bom-allocations", { projectId: P, documentId: D.iso.id, allocationId, action: "install" });
  assert(inst.status === 200, canon(inst.body));
  const ret = await post(allocRoute, "bom-allocations", { projectId: P, documentId: D.iso.id, allocationId, action: "return", reason: "wrong part" });
  assert(ret.status === 200, canon(ret.body));
  const second = (await q("SELECT id FROM bom_allocation WHERE document_id = $1 AND status = 'reserved' ORDER BY pt, owner_ref LIMIT 1", [D.iso.id]))[0].id;
  const rel = await post(allocRoute, "bom-allocations", { projectId: P, documentId: D.iso.id, allocationId: second, action: "release", reason: "not needed" });
  assert(rel.status === 200, canon(rel.body));
  const st = await post(equipRoute, "iso-equipment", { projectId: P, accessoryId, status: "delivered" });
  assert(st.status === 200 && st.body.ok === true, canon(st.body));
  assert((await q("SELECT status FROM iso_equipment_accessory WHERE id = $1", [accessoryId]))[0].status === "delivered");
  D.before = await ledgerState();      // the isometric document's own changes are the new baseline for the rejection tests below
});

test("A3. isometric: a warning can still be resolved through the route (no isometric-boundary refusal; its own rule — not resolvable yet — answers)", async () => {
  const r = await post(warnRoute, "mark-warnings", { projectId: P, documentId: D.iso.id, warningId: D.child.iso.warningId, resolution: "checked" });
  assert(!is409(r), `isometric warning must not be refused as a foreign document: ${canon(r.body)}`);
  assert(r.status === 200 || r.body.code === "NO_REGISTER", `the warning's own rule answers: ${r.status} ${canon(r.body)}`);       // this sheet has no saved register yet
});

test("A4. isometric: the repo functions still sync a ledger, equipment and marks", async () => {
  const uid = await alice();
  await inP(() => db.transaction(async (tx) => {
    await eq.syncEquipment(tx, { projectId: P, documentId: D.iso2.id, items: ITEMS, bom: BOM, userId: uid });
    await al.syncAllocations(tx, { projectId: P, documentId: D.iso2.id, demands: ledgerDemands(ITEMS, BOM), userId: uid });
    await al.verifyLedger(tx, { projectId: P, documentId: D.iso2.id });
    await mi.registerMarks(tx, { projectId: P, documentId: D.iso2.id, items: [] });
    await mi.reconcileSheetMarks(tx, { projectId: P, documentId: D.iso2.id, previousItems: [], items: [] });
    await mi.recordMarkWarnings(tx, { projectId: P, documentId: D.iso2.id, report: {} });
    await mi.recordEquipmentWeldWarnings(tx, { projectId: P, documentId: D.iso2.id, unresolved: [] });
    await mi.markWarnings(tx, { projectId: P, documentId: D.iso2.id });
  }));
  D.before = await ledgerState();
});

for (const kind of ["sld", "pid"]) {
  test(`B-${kind}. a ${kind.toUpperCase()} document is refused 409 NOT_AN_ISOMETRIC_DOCUMENT on every protected route (GET and POST) and nothing is written`, async () => {
    const doc = D[kind], c = D.child[kind];
    const rs = [
      await get(allocRoute, "bom-allocations", { projectId: P, documentId: doc.id }),
      await get(allocRoute, "bom-allocations", { projectId: P, documentId: doc.id, history: "1" }),
      ...await Promise.all(["install", "return", "release"].map((action) => post(allocRoute, "bom-allocations", { projectId: P, documentId: doc.id, allocationId: c.allocationId, action, reason: "x" }))),
      await get(equipRoute, "iso-equipment", { projectId: P, documentId: doc.id }),
      await post(equipRoute, "iso-equipment", { projectId: P, accessoryId: c.accessoryId, status: "installed" }),
      await get(warnRoute, "mark-warnings", { projectId: P, documentId: doc.id }),
      await post(warnRoute, "mark-warnings", { projectId: P, documentId: doc.id, warningId: c.warningId, resolution: "x" }),
    ];
    rs.forEach((r, i) => assert(is409(r, kind), `route call #${i} for ${kind}: ${r.status} ${canon(r.body)}`));
    equal(await ledgerState(), D.before, "no row and no history event was written or changed");
  });

  test(`B-${kind}-repo. the repo functions refuse a ${kind.toUpperCase()} document too, inside a transaction, and write nothing`, async () => {
    const uid = await alice(), documentId = doc_(kind), c = D.child[kind];
    const fns = {
      syncAllocations: (tx) => al.syncAllocations(tx, { projectId: P, documentId, demands: ledgerDemands(ITEMS, BOM), userId: uid }),
      verifyLedger: (tx) => al.verifyLedger(tx, { projectId: P, documentId }),
      availability: (tx) => al.availability(tx, { projectId: P, documentId }),
      history: (tx) => al.history(tx, { projectId: P, documentId }),
      transition: (tx) => al.transition(tx, { projectId: P, documentId, allocationId: c.allocationId, action: "install", userId: uid }),
      syncEquipment: (tx) => eq.syncEquipment(tx, { projectId: P, documentId, items: ITEMS, bom: BOM, userId: uid }),
      listEquipment: (tx) => eq.listEquipment(tx, { projectId: P, documentId }),
      setAccessoryStatus: (tx) => eq.setAccessoryStatus(tx, { projectId: P, accessoryId: c.accessoryId, status: "installed" }),
      reconcileSheetMarks: (tx) => mi.reconcileSheetMarks(tx, { projectId: P, documentId, previousItems: [], items: [] }),
      registerMarks: (tx) => mi.registerMarks(tx, { projectId: P, documentId, items: [] }),
      recordMarkWarnings: (tx) => mi.recordMarkWarnings(tx, { projectId: P, documentId, report: { ambiguous: [{ uid: "x" }] } }),
      recordEquipmentWeldWarnings: (tx) => mi.recordEquipmentWeldWarnings(tx, { projectId: P, documentId, unresolved: [{ id: "e1" }] }),
      markWarnings: (tx) => mi.markWarnings(tx, { projectId: P, documentId }),
      resolveMarkWarning: (tx) => mi.resolveMarkWarning(tx, { projectId: P, warningId: c.warningId, userId: uid, resolution: "x" }),
      warningsFor: (tx) => validationRepo.warningsFor(tx, { projectId: P, documentId }),
      resolveWarning: (tx) => validationRepo.resolveWarning(tx, { projectId: P, documentId, warningId: c.warningId, resolution: "x", userId: uid }),
    };
    for (const [name, fn] of Object.entries(fns)) {
      let err = null;
      await inP(() => db.transaction(fn)).catch((e) => { err = e; });
      assert(err && err.status === 409 && err.code === "NOT_AN_ISOMETRIC_DOCUMENT", `${name}(${kind}) must refuse with 409 NOT_AN_ISOMETRIC_DOCUMENT, got ${err ? `${err.status} ${err.code} ${err.message}` : "success"}`);
    }
    equal(await ledgerState(), D.before);
  });
}
function doc_(kind) { return D[kind].id; }

test("C1. child ids cannot bypass the guard: an SLD / P&ID allocation, accessory or warning is refused even under an ISOMETRIC document id", async () => {
  for (const kind of ["sld", "pid"]) {
    const c = D.child[kind];
    for (const action of ["install", "return", "release"]) {
      const r = await post(allocRoute, "bom-allocations", { projectId: P, documentId: D.iso.id, allocationId: c.allocationId, action, reason: "x" });
      assert(is409(r, kind), `${kind} allocation ${action} under an isometric document id: ${r.status} ${canon(r.body)}`);
    }
    assert(is409(await post(equipRoute, "iso-equipment", { projectId: P, accessoryId: c.accessoryId, status: "installed" }), kind), `${kind} accessory`);
    assert(is409(await post(warnRoute, "mark-warnings", { projectId: P, documentId: D.iso.id, warningId: c.warningId, resolution: "x" }), kind), `${kind} warning`);
    // and the repo level, which is what a future caller would use
    let err = null; await inP(() => db.transaction((tx) => al.transition(tx, { projectId: P, documentId: D.iso.id, allocationId: c.allocationId, action: "install" }))).catch((e) => { err = e; });
    assert(err?.status === 409 && err.code === "NOT_AN_ISOMETRIC_DOCUMENT", `transition(${kind} allocation, isometric document id): ${err?.status} ${err?.code}`);
  }
  equal(await ledgerState(), D.before, "nothing was written");
});

test("C2. an isometric child under ANOTHER isometric document id keeps its old answer (not found), and writes nothing", async () => {
  const r = await post(allocRoute, "bom-allocations", { projectId: P, documentId: D.iso2.id, allocationId: D.child.iso.allocationId, action: "install" });
  equal(r.status, 404, canon(r.body));
  equal(await ledgerState(), D.before);
});

test("D1. unknown ids keep their old answers: an unknown document lists empty / 404, an unknown child is not found (never 409)", async () => {
  const ghost = "00000000-0000-0000-0000-000000000000";
  const a = await get(allocRoute, "bom-allocations", { projectId: P, documentId: ghost });
  assert(a.status !== 409, canon(a.body));
  const e = await get(equipRoute, "iso-equipment", { projectId: P, documentId: ghost });
  assert(e.status !== 409, canon(e.body));
  const w = await get(warnRoute, "mark-warnings", { projectId: P, documentId: ghost });
  assert(w.status !== 409, canon(w.body));
  assert((await post(allocRoute, "bom-allocations", { projectId: P, documentId: D.iso.id, allocationId: ghost, action: "install" })).status === 404);
  const acc = await post(equipRoute, "iso-equipment", { projectId: P, accessoryId: ghost, status: "installed" });
  assert(acc.status === 404, canon(acc.body));
  equal(await ledgerState(), D.before);
});

test("D2. cross-project: another project's document and child ids are not found for this project's user (and the reverse), and nothing is written", async () => {
  const foreign = await newDoc("SLD-X-1", "sld", OTHER);
  const fIso = await newDoc("ISO-X-1", undefined, OTHER);
  await inP(() => ll.saveIsoBom(db, { projectId: OTHER, documentId: fIso.id, bom: BOM, createdBy: null }), OTHER);
  // alice is not a member of OTHER: every call is refused as before (404), whatever the document type
  for (const d of [foreign, fIso]) {
    for (const r of [await get(allocRoute, "bom-allocations", { projectId: OTHER, documentId: d.id }), await get(equipRoute, "iso-equipment", { projectId: OTHER, documentId: d.id }), await get(warnRoute, "mark-warnings", { projectId: OTHER, documentId: d.id })]) {
      assert(r.status === 404, `non-member must get the old 404, got ${r.status} ${canon(r.body)}`);
    }
  }
  // alice's project with OTHER's document ids: not this project's documents, so not found / empty — never the foreign type's 409
  for (const d of [foreign, fIso]) {
    const r = await get(allocRoute, "bom-allocations", { projectId: P, documentId: d.id });
    assert(r.status !== 409, `a foreign project's document must not be classified by type: ${r.status} ${canon(r.body)}`);
  }
  equal(await ledgerState(), D.before);
});

test("D3. authorization is unchanged: a non-member gets 404, a viewer cannot write (403), before any type answer is given", async () => {
  const r = await post(allocRoute, "bom-allocations", { projectId: P, documentId: D.sld.id, allocationId: D.child.sld.allocationId, action: "install" }, "kc|mallory");
  assert(r.status === 404 || r.status === 403, `non-member: ${r.status}`);
  assert(!is409(r), "a non-member must not learn the document's type");
  const g = await get(allocRoute, "bom-allocations", { projectId: P, documentId: D.sld.id }, "kc|mallory");
  assert(!is409(g) && (g.status === 404 || g.status === 403), `non-member GET: ${g.status}`);
  equal(await ledgerState(), D.before);
});

// ── E. source scan ────────────────────────────────────────────────────────────────────────────────────────────────────────
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === "node_modules" || n === ".next" ? [] : walk(p)) : [p]; });
const rel = (p) => relative(".", p).split("\\").join("/");
const ROUTES = walk("app/api").filter((p) => /route\.js$/.test(p)).map(rel);
const ID_PARAM = /\b(documentId|document_id|accessoryId|allocationId|warningId|markUid|markIdentity)\b/;
const REVIEWED_ROUTES = {
  // isometric-only: must refuse a non-isometric document / child id through lib/db/run-scope.mjs
  guarded: ["app/api/bom-allocations/route.js", "app/api/iso-equipment/route.js", "app/api/mark-warnings/route.js", "app/api/overview/route.js", "app/api/runs/route.js",
    "app/api/runs/[id]/route.js", "app/api/validation/route.js"],
  // address documents by id but are type-agnostic BY DESIGN (a document / revision / file is any discipline's) or have their own discipline pass
  typeAgnostic: ["app/api/documents/route.js", "app/api/revisions/route.js", "app/api/pid/route.js", "app/api/sld/route.js", "app/api/sld/extract/route.js"],
};
const READS_ISO_TABLES = /\b(bom_allocation|iso_equipment|sheet_mark_(identity|warning)|iso_bom_row)\b/;
const ISO_REPOS = {
  guarded: ["lib/db/repos/bom-allocation.mjs", "lib/db/repos/iso-equipment.mjs", "lib/db/repos/mark-identity.mjs", "lib/db/repos/validation.mjs", "app/api/mark-warnings/route.js"],
  // read or write these tables only as part of a guarded caller's isometric flow (document ids that already passed a guard), never reachable on their own
  reachedOnlyViaGuarded: ["lib/db/repos/line-list.mjs", "lib/db/repos/register-persistence.mjs", "lib/db/repos/revision-lifecycle.mjs", "lib/engineering/validation.mjs", "lib/sheet/weld-list-identity.mjs"],
};

test("E1. source scan: every route that takes a document / child id is reviewed; a guarded one imports lib/db/run-scope.mjs", () => {
  const withId = ROUTES.filter((f) => ID_PARAM.test(readFileSync(f, "utf8")));
  const known = new Set(Object.values(REVIEWED_ROUTES).flat());
  const unreviewed = withId.filter((f) => !known.has(f));
  assert(unreviewed.length === 0, `route(s) addressed by a document / child id but not reviewed: ${unreviewed.join(", ")} — decide whether each is isometric-only (guard it with lib/db/run-scope.mjs) or type-agnostic, then list it in REVIEWED_ROUTES`);
  const gone = [...known].filter((f) => !withId.includes(f));
  assert(gone.length === 0, `reviewed route(s) no longer take a document / child id (remove from REVIEWED_ROUTES): ${gone.join(", ")}`);
  for (const f of REVIEWED_ROUTES.guarded) assert(/run-scope\.mjs/.test(readFileSync(f, "utf8")), `${f} is isometric-only and must import lib/db/run-scope.mjs`);
});

test("E2. source scan: every protected route calls the document guard before its handler's first write, and a child-id route resolves the child's own document", () => {
  const src = (f) => readFileSync(f, "utf8");
  for (const f of ["app/api/bom-allocations/route.js", "app/api/iso-equipment/route.js", "app/api/mark-warnings/route.js"]) {
    const s = src(f);
    assert(/assertIsometricDocument\(/.test(s) || /assertIsometricAccessory\(/.test(s), `${f}: no guard call`);
  }
  assert(/assertIsometricAllocation\(/.test(src("app/api/bom-allocations/route.js")), "allocations POST must resolve the allocation's own document");
  assert(/assertIsometricAccessory\(/.test(src("app/api/iso-equipment/route.js")), "equipment POST must resolve the accessory's own document");
  assert(/assertIsometricWarning\(/.test(src("app/api/mark-warnings/route.js")), "warnings POST must resolve the warning's own document");
});

test("E3. source scan: every file that touches an isometric-only table is reviewed; every guarded repo imports the guard; a new, unreviewed toucher fails here", () => {
  const files = [...walk("app"), ...walk("lib")].map(rel).filter((p) => /\.(m?js|jsx)$/.test(p) && READS_ISO_TABLES.test(readFileSync(p, "utf8")));
  const known = new Set([...Object.values(ISO_REPOS).flat(), "lib/db/run-scope.mjs"]);
  const unreviewed = files.filter((f) => !known.has(f));
  assert(unreviewed.length === 0, `unreviewed toucher(s) of an isometric-only table: ${unreviewed.join(", ")} — guard it with lib/db/run-scope.mjs or list it as reachedOnlyViaGuarded with the reason`);
  const gone = [...known].filter((f) => !files.includes(f));
  assert(gone.length === 0, `reviewed file(s) no longer touch an isometric-only table (remove from the list): ${gone.join(", ")}`);
  for (const f of ISO_REPOS.guarded) assert(/run-scope\.mjs/.test(readFileSync(f, "utf8")), `${f} must import lib/db/run-scope.mjs`);
});

test("E4. source scan: every exported function of a guarded isometric repo that takes a documentId or a child id calls a guard", () => {
  const unguarded = [];
  for (const f of ["lib/db/repos/bom-allocation.mjs", "lib/db/repos/iso-equipment.mjs", "lib/db/repos/mark-identity.mjs"]) {
    const s = readFileSync(f, "utf8");
    const parts = s.split(/\nexport (?:async )?function /).slice(1);
    for (const body of parts) {
      const head = body.slice(0, body.indexOf("{", body.indexOf(")")) + 1);
      if (!/\bdb\b/.test(head) || !/documentId|accessoryId|warningId|allocationId/.test(head)) continue;           // a pure helper (no database) or an id-less function
      const name = body.slice(0, body.indexOf("("));
      const fn = body.split(/\nexport |\n\/\*\*/)[0];
      if (!/assertIsometric(Document|Accessory|Warning|Allocation)\(/.test(fn)) unguarded.push(`${f}:${name}`);
    }
  }
  assert(unguarded.length === 0, `exported repo function(s) take a document / child id but call no isometric guard: ${unguarded.join(", ")}`);
});

await run();
