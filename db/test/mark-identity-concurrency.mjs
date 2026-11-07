#!/usr/bin/env node
/**
 * Mark identity under real concurrency (Phase 2).
 *
 *   PG_TEST_URL=postgres://user:pass@host:5432/emptydb  (part of `npm run db:test:pg`)
 *
 * Proved by what is LEFT in the tables: one identity per mark however many saves race, an identity registered to one drawing
 * revision only, equipment and allocations on exactly those identities. PGlite is one connection and cannot show this; without
 * PG_TEST_URL the file says SKIPPED and exits 0 — that is NOT a pass.
 */
import { test, run, assert, equal } from "./harness.mjs";

const URL = process.env.PG_TEST_URL;
if (!URL) { console.log("mark-identity-concurrency: SKIPPED — PG_TEST_URL is not set; nothing here ran against PostgreSQL."); process.exit(0); }
process.env.DATABASE_URL = URL;
process.env.AUTH_MODE = "dev";
process.env.STORAGE_ROOT = await (await import("./harness.mjs")).scratchDir("markconc-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const mi = await import("../../lib/db/repos/mark-identity.mjs");
const { DEMO } = await import("../../lib/demo.js");
const { isUid } = await import("../../lib/sheet/mark-identity.mjs");

const req = (url, { method = "GET", body } = {}) =>
  new Request(url, { method, headers: { authorization: "Bearer kc|alice", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const db = await getDb();
const projectId = (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", body: { code: "MCC", name: "M" } })))).body.project.id;
const inP = (fn) => withProject(db, projectId, fn);
const q = (sql, p = []) => inP(async () => (await db.query(sql, p)).rows);
let seq = 0;
const newDoc = async (docNo, revision = "0") => (await json(await documentsRoute.POST(req("http://x/api/documents", { method: "POST",
  body: { projectId, docNo, revision, fileBase64: Buffer.from(`scan ${docNo} ${revision} ${++seq}`).toString("base64") } })))).body.document.id;
const BOM = [{ pt: 2, group: "FLANGES", description: "FLANGE WELD NECK RF 300# A105 BW", diam: "4", qty: 20, qtyUnit: "pcs" }, { pt: 7, group: "MISC", description: "STUD BOLT SET", diam: "4", qty: 8, qtyUnit: "pcs" }];
const marks = () => [
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `m${n}`, kind: "weld-shop", no: String(n), src: "engine", x: 0.1 * n, y: 0.1, attrs: { c1: "2", size: "4" } })),
  { id: "m6", kind: "equipment", no: "V-1", src: "engine", x: 0.5, y: 0.5, attrs: { tag: "T", type: "valve", c1: "7", status: "planned" } },
];
const body = (documentId) => ({ projectId, documentId, lineNo: "MCC-L1", payload: { ...JSON.parse(JSON.stringify(DEMO)), bom: BOM, sheetMarkup: { items: marks() } } });

test("M1. six saves of one drawing revision at once, none carrying an identity: one identity per mark, one equipment row, one ledger", async () => {
  const doc = await newDoc("MCC-A");
  const out = await Promise.all(Array.from({ length: 6 }, () => runsRoute.POST(req("http://x/api/runs", { method: "POST", body: body(doc) })).then(json)));
  assert(out.every((r) => r.status === 201), JSON.stringify(out.map((r) => r.status)));
  const reg = await q("SELECT uid::text AS uid FROM sheet_mark_identity WHERE document_id = $1", [doc]);
  equal(reg.length, 6, "six marks, six identities — however many saves raced");
  const last = (await q("SELECT payload FROM extraction_run WHERE document_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1", [doc]))[0].payload.sheetMarkup.items;
  assert(last.every((m) => isUid(m.uid)));
  equal(new Set(last.map((m) => m.uid)).size, 6, "no identity on two marks");
  equal(new Set(last.map((m) => m.uid)).size === new Set(reg.map((r) => r.uid)).size, true);
  const eq = await q("SELECT mark_id FROM iso_equipment WHERE document_id = $1", [doc]);
  equal(eq.length, 1, "one equipment row");
  const owners = await q("SELECT owner_ref FROM bom_allocation WHERE document_id = $1 AND status IN ('reserved','installed')", [doc]);
  equal(owners.length, 6, "one active ledger line per owner (5 welds, 1 valve)");
  assert(owners.every((o) => reg.some((r) => r.uid === o.owner_ref)), "every ledger owner is a registered identity");
});

test("M2. one identity offered to two drawing revisions at once: it belongs to exactly one", async () => {
  const docs = [await newDoc("MCC-B", "0"), await newDoc("MCC-B", "1")];
  const uid = (await import("../../lib/sheet/mark-identity.mjs")).newUid();
  const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => {
    const documentId = docs[i % 2];
    return inP(() => db.transaction((tx) => mi.registerMarks(tx, { projectId, documentId, items: [{ id: "m1", kind: "weld-shop", no: "1", uid }] }))).then(() => "ok", (e) => (e.code === "MARK_UID_CONFLICT" ? "refused" : `ERROR:${e.message}`));
  }));
  assert(!attempts.some((a) => a.startsWith("ERROR")), JSON.stringify(attempts));
  const owner = await q("SELECT document_id FROM sheet_mark_identity WHERE uid = $1", [uid]);
  equal(owner.length, 1);
  const winnerDoc = owner[0].document_id;
  attempts.forEach((a, i) => equal(a === "ok", docs[i % 2] === winnerDoc, `attempt ${i} (${a}) agrees with the owner`));
});

test("M3. the registry cannot be changed or emptied by the application role", async () => {
  const docs = await q("SELECT document_id FROM sheet_mark_identity LIMIT 1");
  for (const sql of ["UPDATE sheet_mark_identity SET document_id = document_id", "DELETE FROM sheet_mark_identity", "TRUNCATE sheet_mark_identity"]) {
    let msg = null; try { await inP(() => db.query(sql)); } catch (e) { msg = e.message; }
    assert(msg && /permission denied/.test(msg), `${sql}: ${msg}`);
  }
  assert(docs.length === 1);
});

await run();
await db.close();
