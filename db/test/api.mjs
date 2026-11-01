#!/usr/bin/env node
/**
 * API route tests (EPIC-1 wiring).
 *
 * Next.js route handlers are plain functions from a Request to a Response, so
 * they can be called directly. That gives real end-to-end coverage of
 * authentication, the permission check, row level security and persistence in
 * one pass, without a server, a browser or a port.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { mergePasses } from "../../lib/extraction/merge.mjs";
import { sanitize, score, acceptRepair } from "../../lib/extraction/sanitize.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AUTH_MODE = "dev";
// A fresh database and a fresh blob store per run. Pointing at the shared
// .pglite directory would make the suite pass once and then fail on its own
// leftovers, which is a slow way to learn that a test was never isolated.
process.env.PGLITE_DIR = await scratchDir("api-db-");
process.env.STORAGE_ROOT = await scratchDir("api-store-");

const projectsRoute = await import("../../app/api/projects/route.js");
const documentsRoute = await import("../../app/api/documents/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const approveRoute = await import("../../app/api/runs/[id]/approve/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { addMember, ensureUser } = await import("../../lib/db/repos/projects.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, {
    method,
    headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (res) => ({ status: res.status, body: await res.json() });

// ── extraction helpers, pulled out of the page component ─────────────────

test("the merge keeps the edges the nodes pass returned", async () => {
  // A tee has three incident edges; a chain cannot describe one. Dropping
  // `edges` silently demotes every extracted graph to a linear chain, so the
  // branch of a tee disappears without any warning at all.
  const merged = mergePasses(
    { data: { meta: { drawingNo: "X" }, bom: [] } },
    { data: { nps: 12, nodes: [{ id: "N1" }, { id: "N2" }, { id: "N3" }, { id: "N4" }],
              edges: [{ from: "N1", to: "N2", nps: 12 },
                      { from: "N2", to: "N3", nps: 12 },
                      { from: "N2", to: "N4", nps: 8 }] } });
  equal(merged.edges.length, 3, "all three legs of the tee must survive the merge");
  equal(merged.edges[2].nps, 8, "the branch keeps its own diameter");
});

test("the merge survives a failed half", async () => {
  const onlyNodes = mergePasses(null, { data: { nps: 12, nodes: [{ id: "N1" }], edges: [] } });
  equal(onlyNodes.bom, []);
  equal(onlyNodes.nodes.length, 1, "a partial extraction is better than a dead end");
  const onlyMeta = mergePasses({ data: { meta: { nps: 36 }, bom: [{ diam: 36 }] } }, null);
  equal(onlyMeta.nodes, []);
  equal(onlyMeta.meta.nps, 36);
});

// sanitize REPORTS and never changes the reading (architecture review 2026-11-01): it used to drop
// nodes, merge coincident ones and rewrite sizes, each a silent change to the engineering record.

test("sanitize keeps a line size the MTO does not list, and says so", async () => {
  const d = { meta: { nps: 3 }, bom: [{ diam: 36, qty: 12 }], nodes: [], edges: [] };
  const before = structuredClone(d);
  const notes = sanitize(d);
  equal(d, before, "the reading is not changed");
  assert(notes.some((n) => n.includes("36") && n.includes("3")), "the disagreement is reported, never silent");
});

test("sanitize keeps a node with no coordinates and the edges to it; the engine names the node", async () => {
  const d = {
    meta: {}, bom: [],
    nodes: [{ id: "N1", E: 0, N: 0, EL: 0 }, { id: "N2", E: null, N: 1, EL: 1 },
            { id: "N3", E: 5, N: 5, EL: 5 }],
    edges: [{ from: "N1", to: "N2" }, { from: "N2", to: "N3" }],
  };
  const notes = sanitize(d);
  equal(d.nodes.map((n) => n.id), ["N1", "N2", "N3"]);
  equal(d.edges.length, 2);
  assert(notes.some((n) => n.includes("مختصات")));
  // before, N2 and its two edges were dropped and the engine drew N1→N3 straight, with no warning
  const m = buildModel(d, {});
  assert(m.error && m.error.includes("N2") && m.error.includes("مختصات"), `the engine names the node: ${m.error}`);
});

test("sanitize keeps two items at one point (a flange and the valve bolted to it)", async () => {
  const d = { meta: { nps: 6 }, bom: [],
    nodes: [{ id: "T1", type: "tie-in", E: 0, N: 0, EL: 0 }, { id: "F1", type: "flange-wn", E: 1000, N: 0, EL: 0 },
            { id: "V1", type: "valve-bw", E: 1000, N: 0, EL: 0 }, { id: "T2", type: "tie-in", E: 2000, N: 0, EL: 0 }],
    edges: [{ from: "T1", to: "F1", nps: 6 }, { from: "F1", to: "V1", nps: 6 }, { from: "V1", to: "T2", nps: 6 }] };
  const notes = sanitize(d);
  equal(d.nodes.length, 4, "both stay");
  assert(notes.some((n) => n.includes("مختصات مشترک")), "and the shared point is reported");
});

test("sanitize keeps a branch's own size when the BOM does not list it", async () => {
  const d = { meta: { nps: 6 }, bom: [{ diam: 6 }], nodes: [], edges: [{ from: "A", to: "B", nps: 0.75 }] };
  const notes = sanitize(d);
  equal(d.edges[0].nps, 0.75, "a 3/4\" branch is not a misread 6\"");
  assert(notes.some((n) => n.includes("DIAM")));
});

test("a leg with no size and a line with no size: the welds' size is unknown (null), never 0, and a check says so", async () => {
  const d = { meta: {}, bom: [],
    nodes: [{ id: "N1", type: "tie-in", E: 0, N: 0, EL: 0 }, { id: "N2", type: "elbow90", E: 3000, N: 0, EL: 0 },
            { id: "N3", type: "tie-in", E: 3000, N: 2000, EL: 0 }],
    edges: [{ from: "N1", to: "N2" }, { from: "N2", to: "N3" }] };
  const m = buildModel(d, {});
  assert(!m.error, m.error);
  assert(m.register.length > 0 && m.register.every((w) => w.nps === null && w.size === null), JSON.stringify(m.register.map((w) => w.nps)));
  assert(m.checks.some((c) => c.label === "قطر لوله خوانده نشد" && c.status === "warn"));
});

test("a repair that drops an edge of the reading is refused even when its checks improve", async () => {
  const base = { nodes: [{ id: "A" }, { id: "B" }, { id: "C" }], edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }] };
  const fixed = { nodes: base.nodes, edges: [{ from: "A", to: "B" }] };
  const v = acceptRepair({ checks: [{ status: "warn" }] }, { checks: [] }, base, fixed);
  equal(v.accept, false);
  assert(v.why.includes("اتصال"));
  const renamed = { nodes: [{ id: "A" }, { id: "B" }, { id: "X" }], edges: base.edges };
  equal(acceptRepair({ checks: [{ status: "warn" }] }, { checks: [] }, base, renamed).accept, false, "nor one that replaces a node");
});

test("a repair that deletes the route is refused even though it has no warnings", async () => {
  const before = buildModel(DEMO, {});
  const broken = { ...DEMO, nodes: DEMO.nodes.slice(0, 1) };
  const after = buildModel(broken, {});
  assert(after.error, "the broken model errors");
  equal(score(after) > score(before), true, "an error must outweigh any number of warnings");
  const verdict = acceptRepair(before, after, DEMO, broken);
  equal(verdict.accept, false);
  equal(verdict.why, "نتیجه کمتر از دو گره داشت");
});

// ── the wiring ───────────────────────────────────────────────────────────

let projectId, documentId, runId;

test("a request with no token is refused", async () => {
  const res = await projectsRoute.GET(new Request("http://x/api/projects"));
  equal(res.status, 401, "unauthenticated, not a silent empty list");
});

test("creating a project makes the creator its admin", async () => {
  const { status, body } = await json(await projectsRoute.POST(
    req("http://x/api/projects", { method: "POST", body: { code: "K110", name: "Ethane Cracking" } })));
  equal(status, 201);
  projectId = body.project.id;

  const mine = await json(await projectsRoute.GET(req("http://x/api/projects")));
  equal(mine.body.projects.map((p) => p.code), ["K110"]);
  equal(mine.body.projects[0].role, "admin");
});

test("a stranger sees none of it", async () => {
  const theirs = await json(await projectsRoute.GET(req("http://x/api/projects", { as: "kc|mallory" })));
  equal(theirs.body.projects, [], "membership decides visibility");

  const probe = await json(await documentsRoute.GET(
    req(`http://x/api/documents?projectId=${projectId}&docNo=SW%20265022A`, { as: "kc|mallory" })));
  equal(probe.status, 404, "and a project they do not belong to does not exist as far as they know");
});

test("uploading a drawing stores it once and registers the revision", async () => {
  const fileBase64 = Buffer.from("scan of SW 265022A rev 0").toString("base64");
  const first = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST",
    body: { projectId, docNo: "SW 265022A", revision: "0", fileBase64, contentType: "image/jpeg" },
  })));
  equal(first.status, 201);
  equal(first.body.created, true);
  equal(first.body.deduplicated, false);
  documentId = first.body.document.id;

  const again = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST",
    body: { projectId, docNo: "SW 265022A", revision: "0", fileBase64, contentType: "image/jpeg" },
  })));
  equal(again.status, 200);
  equal(again.body.created, false, "the same sheet must not become a second document");
  equal(again.body.deduplicated, true, "nor a second blob");
});

test("a client-claimed hash is ignored when the bytes are present", async () => {
  const fileBase64 = Buffer.from("different content entirely").toString("base64");
  const { body } = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST",
    body: { projectId, docNo: "SW 999", revision: "0", fileBase64, fileSha256: "f".repeat(64) },
  })));
  assert(body.document.file_sha256 !== "f".repeat(64),
    "a hash supplied by the uploader is a statement of intent, not evidence");
});

test("a sheet too big for the body registers by hash and says the file is pending", async () => {
  const sha = "a".repeat(64);
  const { status, body } = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST",
    body: { projectId, docNo: "SW 888", revision: "0", fileSha256: sha, byteSize: 9_000_000 },
  })));
  equal(status, 201);
  equal(body.document.file_sha256, sha);
  assert(body.document.storage_uri.startsWith("pending://"),
    "nothing may mistake a hash-only record for a stored file");
});

test("a registration with neither bytes nor a valid hash is refused", async () => {
  const { status } = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST", body: { projectId, docNo: "SW 777", revision: "0", fileSha256: "nope" },
  })));
  equal(status, 400);
});

test("a register typed in with no drawing file registers the sheet as having none, and the file attaches later", async () => {
  // The piping page's «ذخیره در سامانه» after JSON typed by hand: no file,
  // no hash. It used to be refused outright with an English message.
  const post = (body) => documentsRoute.POST(req("http://x/api/documents", {
    method: "POST", body: { projectId, docNo: "SW 666", revision: "0", ...body } })).then(json);
  const first = await post({ noFile: true });
  equal(first.status, 201);
  equal(first.body.noFile, true);
  assert(first.body.document.storage_uri.startsWith("none://"), "the row says there is no file");
  const again = await post({ noFile: true });
  equal(again.status, 200, "saving the typed register again is the same sheet, not a content conflict");
  equal(again.body.document.id, first.body.document.id);
  const fileBase64 = Buffer.from("scan of SW 666 rev 0").toString("base64");
  const attached = await post({ fileBase64, contentType: "application/pdf" });
  equal(attached.body.attached, true, "the real file is attached to the same revision");
  equal(attached.body.document.id, first.body.document.id);
  assert(!attached.body.document.storage_uri.startsWith("none://"));
  const stays = await post({ noFile: true });
  equal(stays.body.document.file_sha256, attached.body.document.file_sha256, "«no file» never replaces a file on record");
  const other = await post({ fileBase64: Buffer.from("another scan").toString("base64"), contentType: "application/pdf" });
  equal(other.status, 409, "a second, different file for the same revision is still a revision problem");
});

test("a new revision supersedes the old one through the API", async () => {
  const res = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST",
    body: { projectId, docNo: "SW 265022A", revision: "B", revisionDate: "2026-09-01",
            fileBase64: Buffer.from("scan of SW 265022A rev B").toString("base64") },
  })));
  equal(res.body.superseded.map((d) => d.revision), ["0"]);

  const current = await json(await documentsRoute.GET(
    req(`http://x/api/documents?projectId=${projectId}&docNo=SW%20265022A`)));
  equal(current.body.document.revision, "B");
});

test("posting an extraction persists the register the engine computes", async () => {
  const { status, body } = await json(await runsRoute.POST(req("http://x/api/runs", {
    method: "POST",
    body: { projectId, documentId, lineNo: "36-P-001", payload: DEMO,
            model: "claude-sonnet-5", inputTokens: 24000, outputTokens: 3900 },
  })));
  equal(status, 201);
  runId = body.run.id;
  equal(body.register.length, 10);
  equal(body.register.filter((w) => w.shop_field === "Field").map((w) => w.weld_no),
    ["W-01", "W-05", "W-06", "W-10"]);
  equal(body.spools.length, 3);
});

test("a saved register belongs to a line: its welds and spools carry it, so a test package and MC can see them", async () => {
  // Before this, a register saved through the API made no line at all —
  // only the demo seed, which inserted its line by hand, had one.
  const db = await getDb();
  const { rows: [line] } = await db.query("SELECT id FROM line WHERE project_id = $1 AND line_no = '36-P-001'", [projectId]);
  assert(line, "the line named with the register exists");
  const { rows: [n] } = await db.query(
    "SELECT count(*)::int AS welds, count(*) FILTER (WHERE line_id = $2)::int AS on_line FROM weld WHERE extraction_run_id = $1", [runId, line.id]);
  equal(n.on_line, n.welds, "every weld of the run is on the line");
  assert(n.welds > 0);
});

test("the register is recomputed server-side, never taken from the client", async () => {
  // A client posting a payload it has tampered with gets the engine's answer,
  // not its own: the browser is not a place to decide where a weld goes.
  const tampered = JSON.parse(JSON.stringify(DEMO));
  tampered.nodes = tampered.nodes.slice(0, 2);
  const { body } = await json(await runsRoute.POST(req("http://x/api/runs", {
    method: "POST",
    body: { projectId, documentId, lineNo: "36-P-001", payload: tampered,
            register: [{ no: "W-99", loc: "Shop" }] },
  })));
  assert(!body.register.some((w) => w.weld_no === "W-99"), "the client's register is ignored");
  assert(body.register.length !== 10, "the engine answered for the payload it was given");
});

test("a failed model still leaves a run row, because the failure is evidence", async () => {
  const { status, body } = await json(await runsRoute.POST(req("http://x/api/runs", {
    method: "POST",
    body: { projectId, documentId, payload: { nodes: [{ id: "N1", type: "tie-in", E: 0, N: 0, EL: 0 }] } },
  })));
  equal(status, 201);
  assert(body.engineError, "the error is recorded");
  equal(body.register, []);
  equal(body.run.status, "failed");
});

test("a viewer may not run an extraction", async () => {
  const db = await getDb();
  const mallory = await ensureUser(db, { subject: "kc|mallory" });
  await addMember(db, { projectId, userId: mallory.id, role: "viewer" });
  const { status, body } = await json(await runsRoute.POST(req("http://x/api/runs", {
    method: "POST", as: "kc|mallory",
    body: { projectId, documentId, payload: DEMO },
  })));
  equal(status, 403);
  equal(body.code, "FORBIDDEN");
});

test("QC may not approve a register, and the refusal is the role's, not a bug", async () => {
  const db = await getDb();
  const qc = await ensureUser(db, { subject: "kc|qc" });
  await addMember(db, { projectId, userId: qc.id, role: "qc" });
  const { status, body } = await json(await approveRoute.POST(
    req(`http://x/api/runs/${runId}/approve`, { method: "POST", as: "kc|qc", body: { projectId } }),
    { params: { id: runId } }));
  equal(status, 403);
  assert(body.error.includes("register:approve"), "the message names the action");
});

test("an engineer approves, and the approval records what was signed", async () => {
  const db = await getDb();
  const eng = await ensureUser(db, { subject: "kc|eng" });
  await addMember(db, { projectId, userId: eng.id, role: "engineer" });
  const { status, body } = await json(await approveRoute.POST(
    req(`http://x/api/runs/${runId}/approve`, { method: "POST", as: "kc|eng", body: { projectId } }),
    { params: { id: runId } }));
  equal(status, 200);
  equal(body.run.status, "approved");
  equal(body.run.approved_by, eng.id);
  assert(/^[0-9a-f]{64}$/.test(body.run.approved_sha256), "an approval must say what it covered");
});

test("a weld list typed by hand becomes a register: as entered, checked, never guessed", async () => {
  // No drawing file, no geometry: the sheet is registered as having no file
  // and the register is the list the person typed from the weld map.
  const doc = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST", body: { projectId, docNo: "ISO-LIST-1", revision: "0", noFile: true } })));
  const meta = { drawingNo: "ISO-LIST-1", rev: "0", lineNo: "36-P-777", nps: 6, schedule: "SCH 40" };
  const post = (weldList, m = meta) => runsRoute.POST(req("http://x/api/runs", {
    method: "POST", body: { projectId, documentId: doc.body.document.id, payload: { meta: m, weldList } } })).then(json);
  const db = await getDb();
  const runsBefore = (await db.query("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1", [doc.body.document.id])).rows[0].n;

  // Every row that is not a register row is named; nothing is saved.
  const bad = await post([
    { no: "W-1", spool: "S1", loc: "Shop", kind: "BW" },
    { no: "W-1", spool: "S1", loc: "Shop", kind: "BW" },
    { no: "W-2", loc: "somewhere", kind: "BW" },
    { no: "W-3", loc: "Shop", kind: "BW" },
    { no: "W-4", spool: "S1", loc: "Field", kind: "" },
  ]);
  equal(bad.status, 400);
  equal(bad.body.problems.length, 4, bad.body.problems.join(" | "));
  assert(/تکراری/.test(bad.body.problems[0]) && /Shop|Field/.test(bad.body.problems[1]) && /اسپول/.test(bad.body.problems[2]) && /نوع/.test(bad.body.problems[3]));
  equal((await db.query("SELECT count(*)::int AS n FROM extraction_run WHERE document_id = $1", [doc.body.document.id])).rows[0].n, runsBefore, "no run is kept for a list that is not a register");

  const good = await post([
    { no: "W-1", spool: "S1", loc: "Shop", kind: "BW" },
    { no: "W-2", spool: "S1", loc: "کارگاه", kind: "Butt weld", nps: '4"' },
    { no: "W-3", spool: "", loc: "Field", kind: "Tie-in", ref: "P-777 suction" },
    { no: "W-4", spool: "S2", loc: "shop", kind: "BW" },
  ]);
  equal(good.status, 201, JSON.stringify(good.body).slice(0, 200));
  const byNo = Object.fromEntries(good.body.register.map((w) => [w.weld_no, w]));
  equal(byNo["W-2"].shop_field, "Shop", "«کارگاه» is Shop");
  equal(Number(byNo["W-2"].nps), 4, "the row's own size");
  equal(Number(byNo["W-1"].nps), 6, "a blank size is the sheet's stated size, which is not a guess");
  equal(byNo["W-3"].shop_field, "Field");
  equal(byNo["W-3"].ndt_requirement, "RT 100%", "the same provisional NDT as the engine's");
  equal(byNo["W-3"].pos_el, null, "no geometry, no elevation");
  equal(good.body.spools.sort(), ["S1", "S2"]);
  const { rows: [line] } = await db.query("SELECT id FROM line WHERE project_id = $1 AND line_no = '36-P-777'", [projectId]);
  assert(line, "the list's line exists, so its welds reach a test package and MC");
  const { rows: sp } = await db.query("SELECT spool_no, length_mm, nps_max FROM spool WHERE extraction_run_id = $1 ORDER BY spool_no", [good.body.run.id]);
  equal(sp.map((x) => [x.spool_no, x.length_mm, Number(x.nps_max)]), [["S1", null, 6], ["S2", null, 6]], "a length nobody measured is unknown, not zero");

  // Rev 1 of the same sheet: known by weld number, so W-1..W-3 keep their identity.
  const doc1 = await json(await documentsRoute.POST(req("http://x/api/documents", {
    method: "POST", body: { projectId, docNo: "ISO-LIST-1", revision: "1", noFile: true } })));
  const rev1 = await runsRoute.POST(req("http://x/api/runs", { method: "POST", body: { projectId, documentId: doc1.body.document.id,
    payload: { meta: { ...meta, rev: "1" }, weldList: [
      { no: "W-1", spool: "S1", loc: "Shop", kind: "BW" },
      { no: "W-2", spool: "S1", loc: "Shop", kind: "BW", nps: 4 },
      { no: "W-3", loc: "Field", kind: "Tie-in", ref: "P-777 suction" },
    ] } } })).then(json);
  equal(rev1.status, 201);
  const uid = (reg, no) => reg.find((w) => w.weld_no === no).weld_uid;
  for (const no of ["W-1", "W-2", "W-3"]) equal(uid(rev1.body.register, no), uid(good.body.register, no), `${no} keeps its identity`);
});

test("the latest run round trips through the API", async () => {
  const { body } = await json(await runsRoute.GET(
    req(`http://x/api/runs?projectId=${projectId}&documentId=${documentId}`)));
  assert(body.run, "a run comes back");
  assert(Array.isArray(body.register), "with its register");
});

await run();
