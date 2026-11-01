#!/usr/bin/env node
/**
 * Saving a run is all or nothing (app/api/runs; architecture review of
 * 2026-11-01). The line, the run, the register with its spools and welds
 * (identity carried from the last revision), the line list and the BOM are
 * one transaction: when the last step fails, none of the first is left.
 *
 * Run on PGlite, the driver this server runs; the same code path runs on
 * node-postgres (lib/db/client.mjs gives both a transaction whose handle is
 * a pass-through for nested ones) but a PostgreSQL server was not available
 * to run it against here.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { DEMO } from "../../lib/demo.js";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("atomic-db-");
process.env.STORAGE_ROOT = await scratchDir("atomic-store-");
const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const { getDb } = await import("../../lib/server/db.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) => new Request(url, {
  method, headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });
const clone = (x) => structuredClone(x);
const db = await getDb();

const mk = async (as, code) => (await json(await projectsRoute.POST(req("http://x/api/projects", { method: "POST", as, body: { code, name: code } })))).body.project;
const P = await mk("kc|alice", "AT1"), Q = await mk("kc|bob", "AT2");
const upload = async (project, as, docNo, revision, content) => (await json(await documentsRoute.POST(req("http://x/api/documents", {
  method: "POST", as, body: { projectId: project.id, docNo, revision, fileBase64: Buffer.from(content).toString("base64") } })))).body.document;
const post = async (project, as, documentId, payload) => json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", as, body: { projectId: project.id, documentId, payload } })));
const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
const counts = async () => ({
  runs: await count("SELECT count(*) AS n FROM extraction_run"), welds: await count("SELECT count(*) AS n FROM weld"),
  spools: await count("SELECT count(*) AS n FROM spool"), lines: await count("SELECT count(*) AS n FROM line"), bom: await count("SELECT count(*) AS n FROM iso_bom_row") });

const withBom = (rev, lineNo, drawingNo = "ISO-AT-1") => ({ ...clone(DEMO), meta: { ...DEMO.meta, rev, lineNo, drawingNo },
  bom: [...(DEMO.bom || []), { pt: 99, group: "PIPE", description: "Pipe", diam: 6, qty: 2, qtyUnit: "pcs" }],
  lineData: { designPressure: "7.4", designTemp: "65" } });

test("a save writes the line, run, register, line list and BOM together", async () => {
  const doc = await upload(P, "kc|alice", "ISO-AT-1", "0", "scan 0");
  const before = await counts();
  const { status, body } = await post(P, "kc|alice", doc.id, withBom("0", '6"-AT-1-A1'));
  equal(status, 201);
  const after = await counts();
  equal([after.runs - before.runs, after.lines - before.lines, after.bom - before.bom], [1, 1, 1 + (DEMO.bom || []).length]);
  assert(after.welds > before.welds && after.spools > before.spools);
  equal(body.lineList.filled.sort(), ["designPressure", "designTemp"]);
});

test("the BOM step failing leaves nothing of the save: no run, no register, no new line, no line list", async () => {
  const doc = await upload(P, "kc|alice", "ISO-AT-2", "0", "scan 2");
  await db.exec(`CREATE FUNCTION atomic_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced BOM failure'; END $$;
    CREATE TRIGGER atomic_fail BEFORE INSERT ON iso_bom_row FOR EACH ROW EXECUTE FUNCTION atomic_fail();`);
  const before = await counts();
  const { status } = await post(P, "kc|alice", doc.id, withBom("0", '6"-AT-2-A1', "ISO-AT-2"));
  assert(status >= 500, `the failure is reported, not hidden: ${status}`);
  equal(await counts(), before, "every table is as it was");
  equal(await count("SELECT count(*) AS n FROM line WHERE line_no = $1", ['6"-AT-2-A1']), 0, "the line made for this save is gone too");
  await db.exec("DROP TRIGGER atomic_fail ON iso_bom_row; DROP FUNCTION atomic_fail();");
  // and the same save works once the cause is gone
  const again = await post(P, "kc|alice", doc.id, withBom("0", '6"-AT-2-A1', "ISO-AT-2"));
  equal(again.status, 201);
});

test("a failed second revision leaves the first intact, with its identities", async () => {
  const doc0 = await upload(P, "kc|alice", "ISO-AT-3", "0", "scan 3-0");
  const r0 = (await post(P, "kc|alice", doc0.id, withBom("0", '6"-AT-3-A1', "ISO-AT-3"))).body;
  const uids0 = Object.fromEntries(r0.register.map((w) => [w.weld_no, w.weld_uid]));
  const docB = await upload(P, "kc|alice", "ISO-AT-3", "B", "scan 3-B");
  await db.exec(`CREATE FUNCTION atomic_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced'; END $$;
    CREATE TRIGGER atomic_fail BEFORE INSERT ON iso_bom_row FOR EACH ROW EXECUTE FUNCTION atomic_fail();`);
  const before = await counts();
  const moved = withBom("B", '6"-AT-3-A1', "ISO-AT-3"); moved.nodes.forEach((n) => { n.E += 50_000; });
  assert((await post(P, "kc|alice", docB.id, moved)).status >= 500);
  equal(await counts(), before);
  await db.exec("DROP TRIGGER atomic_fail ON iso_bom_row; DROP FUNCTION atomic_fail();");
  const still = await db.query("SELECT weld_no, weld_uid FROM weld WHERE extraction_run_id = $1", [r0.run.id]);
  equal(Object.fromEntries(still.rows.map((w) => [w.weld_no, w.weld_uid])), uids0, "revision 0's register is untouched");
  // the revision then saves, and carries the identities
  const ok = (await post(P, "kc|alice", docB.id, moved)).body;
  equal(ok.carriedIdentities, r0.register.length);
  equal(Object.fromEntries(ok.register.map((w) => [w.weld_no, w.weld_uid])), uids0);
});

test("a revision that removes a fitting: unchanged joints keep their identity, the deleted ones stay in the old revision only, the new one is new", async () => {
  const doc0 = await upload(P, "kc|alice", "ISO-AT-4", "0", "scan 4-0");
  const r0 = (await post(P, "kc|alice", doc0.id, withBom("0", '6"-AT-4-A1', "ISO-AT-4"))).body;
  const uids0 = new Set(r0.register.map((w) => w.weld_uid));
  const docB = await upload(P, "kc|alice", "ISO-AT-4", "B", "scan 4-B");
  // revision B: the middle elbow is gone and its two legs run into one (the same joint list otherwise)
  const changed = withBom("B", '6"-AT-4-A1', "ISO-AT-4");
  const i = Math.floor(changed.nodes.length / 2), id = changed.nodes[i].id;
  const ins = changed.edges.filter((e) => e.to === id), outs = changed.edges.filter((e) => e.from === id);
  changed.nodes.splice(i, 1);
  changed.edges = changed.edges.filter((e) => e.to !== id && e.from !== id);
  changed.edges.push({ from: ins[0].from, to: outs[0].to, nps: ins[0].nps });
  const rB = (await post(P, "kc|alice", docB.id, changed)).body;
  const carried = rB.register.filter((w) => uids0.has(w.weld_uid));
  const fresh = rB.register.filter((w) => !uids0.has(w.weld_uid));
  equal(carried.length, rB.carriedIdentities);
  assert(carried.length > 0 && fresh.length > 0, `carried ${carried.length}, new ${fresh.length}`);
  equal(new Set(rB.register.map((w) => w.weld_uid)).size, rB.register.length, "no two welds of the revision share an identity");
  // the deleted welds are still on revision 0 (immutable) and not on B
  const gone = r0.register.filter((w) => !rB.register.some((x) => x.weld_uid === w.weld_uid));
  assert(gone.length > 0, `${gone.length} welds exist in revision 0 only`);
  const still0 = await db.query("SELECT count(*)::int AS n FROM weld WHERE extraction_run_id = $1", [r0.run.id]);
  equal(still0.rows[0].n, r0.register.length, "revision 0 keeps every weld it had");
});

test("another project sees none of a project's runs, welds or BOM, and its own save is its own", async () => {
  const doc = await upload(Q, "kc|bob", "ISO-AT-1", "0", "bob scan");
  const { status, body } = await post(Q, "kc|bob", doc.id, withBom("0", '6"-AT-1-A1'));
  equal(status, 201, "the same drawing and line numbers in another project are its own");
  equal(body.carriedIdentities, 0, "and take no identity from the other project's sheet");
  equal(await count("SELECT count(*) AS n FROM iso_bom_row WHERE project_id = $1", [Q.id]) > 0, true);
  const peek = await json(await runsRoute.GET(req(`http://x/api/runs?projectId=${P.id}&documentId=${doc.id}`, { as: "kc|bob" })));
  equal(peek.status, 404, "bob is no member of the first project");
  const wrongDoc = await json(await runsRoute.POST(req("http://x/api/runs", { method: "POST", as: "kc|bob", body: { projectId: P.id, documentId: doc.id, payload: withBom("0", "x") } })));
  equal(wrongDoc.status, 404, "nor can he save into it");
});

await run();
