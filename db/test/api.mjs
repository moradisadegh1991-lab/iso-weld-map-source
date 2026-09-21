#!/usr/bin/env node
/**
 * API route tests (EPIC-1 wiring).
 *
 * Next.js route handlers are plain functions from a Request to a Response, so
 * they can be called directly. That gives real end-to-end coverage of
 * authentication, the permission check, row level security and persistence in
 * one pass, without a server, a browser or a port.
 */
import { test, run, assert, equal } from "./harness.mjs";
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
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "api-db-"));
process.env.STORAGE_ROOT = await mkdtemp(path.join(tmpdir(), "api-store-"));

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

test("sanitize corrects an nps the MTO contradicts", async () => {
  const d = { meta: { nps: 3 }, bom: [{ diam: 36, qty: 12 }], nodes: [], edges: [] };
  const notes = sanitize(d);
  equal(d.meta.nps, 36, "the MTO DIAM column is the authority");
  assert(notes.some((n) => n.includes("36")), "the correction is reported, never silent");
});

test("sanitize drops nodes with no coordinates and the edges that referenced them", async () => {
  const d = {
    meta: {}, bom: [],
    nodes: [{ id: "N1", E: 0, N: 0, EL: 0 }, { id: "N2", E: null, N: 1, EL: 1 },
            { id: "N3", E: 5, N: 5, EL: 5 }],
    edges: [{ from: "N1", to: "N2" }, { from: "N1", to: "N3" }],
  };
  sanitize(d);
  equal(d.nodes.map((n) => n.id), ["N1", "N3"]);
  equal(d.edges.length, 1, "an edge pointing at a removed node would crash the engine");
});

test("sanitize removes a node duplicated at the same point", async () => {
  const d = { meta: {}, bom: [],
    nodes: [{ id: "N1", E: 1, N: 2, EL: 3 }, { id: "N2", E: 1, N: 2, EL: 3 }], edges: [] };
  const notes = sanitize(d);
  equal(d.nodes.length, 1);
  assert(notes.length === 1, "and says so");
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

test("the latest run round trips through the API", async () => {
  const { body } = await json(await runsRoute.GET(
    req(`http://x/api/runs?projectId=${projectId}&documentId=${documentId}`)));
  assert(body.run, "a run comes back");
  assert(Array.isArray(body.register), "with its register");
});

await run();
