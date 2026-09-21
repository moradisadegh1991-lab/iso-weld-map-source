#!/usr/bin/env node
/**
 * Human-in-the-loop tests (EPIC-5).
 *
 * The edit log is the point of this epic: it records, field by field, what an
 * engineer had to correct in what the model read. That record is the most
 * useful dataset the programme produces, so the tests care about its
 * precision — a log full of false corrections is worse than no log.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { diffPayload, editHotspots } from "../../lib/review/payload-diff.mjs";
import { DISCLAIMER_FA, approvalLine, disclaimerRows } from "../../lib/disclaimer.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// ── the diff ─────────────────────────────────────────────────────────────

test("a corrected coordinate is reported with its path and both values", async () => {
  const d = diffPayload(
    { nodes: [{ id: "N1", E: 118948 }, { id: "N2", E: 118948 }] },
    { nodes: [{ id: "N1", E: 118948 }, { id: "N2", E: 118984 }] });
  equal(d.length, 1);
  equal(d[0].path, "nodes[1].E");
  equal(d[0].field, "E");
  equal(d[0].before, 118948);
  equal(d[0].after, 118984);
  equal(d[0].kind, "changed");
});

test("re-typing a number as a string is not a correction", async () => {
  // A JSON tab round trip turns 36 into "36". Logging that would bury the
  // real corrections in noise.
  equal(diffPayload({ meta: { nps: 36 } }, { meta: { nps: "36" } }), []);
});

test("an added node and a removed one are distinguished", async () => {
  const d = diffPayload({ nodes: [{ id: "N1" }] }, { nodes: [{ id: "N1" }, { id: "N2" }] });
  equal(d.map((x) => x.kind), ["added"]);
  const r = diffPayload({ bom: [{ pt: 1 }, { pt: 2 }] }, { bom: [{ pt: 1 }] });
  equal(r.map((x) => x.kind), ["removed"]);
});

test("nested changes keep the full path", async () => {
  const d = diffPayload(
    { meta: { drawingNo: "SW 265022A", rev: "0" } },
    { meta: { drawingNo: "SW 265022A", rev: "B" } });
  equal(d[0].path, "meta.rev");
});

test("hotspots strip the index, because the question is which FIELD is weak", async () => {
  const spots = editHotspots([
    { path: "nodes[0].E", before: 1, after: 2 },
    { path: "nodes[7].E", before: 3, after: 4 },
    { path: "meta.nps", before: 3, after: 36 },
  ]);
  equal(spots[0].path, "nodes[].E");
  equal(spots[0].count, 2, "the same field on two rows is one problem, not two");
  equal(spots[0].examples.length, 2, "with examples to look at");
});

// ── the disclaimer ───────────────────────────────────────────────────────

test("an unapproved output says so, rather than saying nothing", async () => {
  assert(approvalLine(null).includes("تأییدنشده"));
  const signed = approvalLine({ approvedBy: "رضایی", approvedAt: "2026-09-21T10:00:00Z",
                                sha256: "abcdef0123456789" });
  assert(signed.includes("رضایی"));
  assert(signed.includes("abcdef012345"), "and carries the fingerprint of what was signed");
});

test("the spreadsheet rows carry both languages and the approval state", async () => {
  const rows = disclaimerRows(null).flat().join(" ");
  assert(rows.includes(DISCLAIMER_FA.slice(0, 20)));
  assert(rows.includes("DRAFT"), "an English reader gets the warning too");
});

// ── through the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "review-db-"));

const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runsRepo = await import("../../lib/db/repos/runs.mjs");
const review = await import("../../lib/db/repos/review.mjs");
const { buildModel } = await import("../../lib/engine.js");
const { DEMO } = await import("../../lib/demo.js");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice", displayName: "Alice" });
const project = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });

let runId, docId, uidsBefore;

test("a run appears in the review queue with its warning count", async () => {
  await withProject(db, project.id, async () => {
    const { rows: [doc] } = await db.query(
      `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
       VALUES ($1,'SW 265022A','0',$2,'local://x') RETURNING id`, [project.id, "a".repeat(64)]);
    docId = doc.id;
    // A payload with a deliberately wrong pipe length, so a check warns.
    const wrong = JSON.parse(JSON.stringify(DEMO));
    wrong.bom = wrong.bom.map((b) => (b.pt === 1 ? { ...b, qty: 40 } : b));
    const model = buildModel(wrong, {});
    const r = await runsRepo.createRun(db, {
      projectId: project.id, documentId: docId, payload: wrong,
      validationChecks: model.checks, createdBy: alice.id });
    runId = r.id;
    await runsRepo.saveRegister(db, {
      projectId: project.id, runId, documentId: docId, model });
    uidsBefore = (await runsRepo.getRegister(db, { projectId: project.id, runId }))
      .map((w) => w.weld_uid);

    const queue = await review.reviewQueue(db, { projectId: project.id });
    equal(queue.length, 1);
    equal(queue[0].docNo, "SW 265022A");
    assert(queue[0].warnings > 0, "and the queue is ordered by how likely it is to be wrong");
    equal(queue[0].welds, 10);
  });
});

test("a correction is logged field by field and the register is rebuilt", async () => {
  await withProject(db, project.id, async () => {
    const fixed = JSON.parse(JSON.stringify(DEMO));   // put the BOM quantity back
    const { edits, register } = await review.applyCorrection(db, {
      projectId: project.id, runId, payload: fixed,
      reason: "qty لوله از ۴۰ به ۱۲.۶ اصلاح شد", userId: alice.id });

    equal(edits.length, 1, "one field changed, so one edit");
    equal(edits[0].path, "bom[0].qty");
    equal(edits[0].before, 40);
    equal(edits[0].after, 12.6);
    equal(register.length, 10, "and the register was rebuilt by the engine, not patched");

    const logged = await review.editsOf(db, { projectId: project.id, runId });
    equal(logged.length, 1);
    equal(logged[0].field, "qty");
    equal(logged[0].display_name, "Alice", "attributed to whoever made it");
  });
});

test("weld identity survives a correction, so NDT records are not orphaned", async () => {
  await withProject(db, project.id, async () => {
    const after = (await runsRepo.getRegister(db, { projectId: project.id, runId }))
      .map((w) => w.weld_uid);
    equal(after, uidsBefore,
      "a corrected quantity must not orphan the NDT record on an untouched weld");
  });
});

test("correcting the geometry moves the register the engine computes", async () => {
  await withProject(db, project.id, async () => {
    const moved = JSON.parse(JSON.stringify(DEMO));
    moved.nodes[2].N += 4000;                       // a real dimension correction
    moved.nodes[3].N += 4000;
    const { edits, register } = await review.applyCorrection(db, {
      projectId: project.id, runId, payload: moved, userId: alice.id });
    equal(edits.map((e) => e.path), ["nodes[2].N", "nodes[3].N"]);
    assert(register.length >= 10, "the engine re-derived the register from the corrected route");
  });
});

test("the hotspot report names the field, not the row", async () => {
  await withProject(db, project.id, async () => {
    const h = await review.hotspots(db, { projectId: project.id });
    const n = h.fields.find((f) => f.path === "nodes[].N");
    equal(n.count, 2, "two rows of the same field is one weakness");
    assert(n.share > 0, "reported as a share of all corrections");
  });
});

test("approving locks the run, in the database and not only in the route", async () => {
  await withProject(db, project.id, async () => {
    await runsRepo.approveRun(db, { projectId: project.id, runId, userId: alice.id });
    const { rows: [r] } = await db.query("SELECT locked_at, status FROM extraction_run WHERE id = $1",
      [runId]);
    assert(r.locked_at, "the trigger set the lock, so no future route can forget to");
    equal(r.status, "approved");
  });
});

test("an approved register refuses further correction and says what to do", async () => {
  await withProject(db, project.id, async () => {
    const e = await throws(() => review.applyCorrection(db, {
      projectId: project.id, runId, payload: DEMO, userId: alice.id }), "RUN_LOCKED");
    equal(e.status, 409);
    assert(e.message.includes("رویژن جدید"), "and points at the only legitimate route");
  });
});

test("the database itself rejects a payload write to a locked run", async () => {
  await withProject(db, project.id, async () => {
    // Not via the repository — straight at the table, the way a future script
    // or a second service would arrive.
    await throws(() => db.query(
      "UPDATE extraction_run SET payload = $1 WHERE id = $2", ["{}", runId]),
      "approved and locked");
  });
});

test("an approved run leaves the review queue", async () => {
  await withProject(db, project.id, async () => {
    equal(await review.reviewQueue(db, { projectId: project.id }), []);
    const signed = await review.approvedRunFor(db, { projectId: project.id, documentId: docId });
    assert(signed.approved_sha256, "and is findable as the signed register for that revision");
  });
});

// ── the exports carry the warning ────────────────────────────────────────

const { registerCsv } = await import("../../lib/engine.js");

test("the CSV carries the disclaimer, because it gets imported elsewhere", async () => {
  const csv = registerCsv(buildModel(DEMO, {}), DEMO.meta, null);
  assert(csv.includes(DISCLAIMER_FA), "a CSV arrives somewhere else looking approved");
  assert(csv.includes("تأییدنشده"), "and says it is not");
});

test("a signed CSV names who signed it", async () => {
  const csv = registerCsv(buildModel(DEMO, {}), DEMO.meta,
    { approvedBy: "رضایی", approvedAt: "2026-09-21", sha256: "deadbeef0123" });
  assert(csv.includes("رضایی"));
  assert(csv.includes("deadbeef0123"));
});

// ── the API surface ──────────────────────────────────────────────────────

const queueRoute = await import("../../app/api/review-queue/route.js");
const editsRoute = await import("../../app/api/runs/[id]/edits/route.js");
const hotspotRoute = await import("../../app/api/reports/edit-hotspots/route.js");
const runsRoute = await import("../../app/api/runs/route.js");
const { addMember } = await import("../../lib/db/repos/projects.mjs");

const req = (url, { method = "GET", as = "kc|alice", body } = {}) =>
  new Request(url, { method,
    headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res) => ({ status: res.status, body: await res.json() });

test("re-extracting over a signed revision is refused, pointing at the remedy", async () => {
  const res = await json(await runsRoute.POST(req("http://x/api/runs", {
    method: "POST", body: { projectId: project.id, documentId: docId, payload: DEMO } })));
  equal(res.status, 409);
  equal(res.body.code, "REVISION_ALREADY_APPROVED");
  assert(res.body.approvedRunId, "and names the register that was signed");
});

test("the queue and the hotspot report are readable through the API", async () => {
  const q = await json(await queueRoute.GET(
    req(`http://x/api/review-queue?projectId=${project.id}`)));
  equal(q.status, 200);
  equal(q.body.queue, [], "everything here is approved");

  const h = await json(await hotspotRoute.GET(
    req(`http://x/api/reports/edit-hotspots?projectId=${project.id}`)));
  assert(h.body.fields.some((f) => f.path === "nodes[].N"));
  equal(h.body.totalEdits, 3);
});

test("a viewer may read the edit log but not write one", async () => {
  const db2 = await getDb();
  const mallory = await projects.ensureUser(db2, { subject: "kc|mallory" });
  await addMember(db2, { projectId: project.id, userId: mallory.id, role: "viewer" });

  const read = await json(await editsRoute.GET(
    req(`http://x/api/runs/${runId}/edits?projectId=${project.id}`, { as: "kc|mallory" }),
    { params: { id: runId } }));
  equal(read.status, 200);
  equal(read.body.edits.length, 3);

  const write = await json(await editsRoute.POST(
    req(`http://x/api/runs/${runId}/edits`, { method: "POST", as: "kc|mallory",
      body: { projectId: project.id, payload: DEMO } }),
    { params: { id: runId } }));
  equal(write.status, 403);
});

await run();
