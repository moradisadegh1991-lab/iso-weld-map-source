#!/usr/bin/env node
/** Correction versioning and audit history on a real PostgreSQL pool. Run via db:test:pg. */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { createClient } from "../../lib/db/client.mjs";
import { migrate } from "../../lib/db/migrate.mjs";
import { withProject } from "../../lib/db/scope.mjs";
import * as projects from "../../lib/db/repos/projects.mjs";
import * as runs from "../../lib/db/repos/runs.mjs";
import { applyCorrection, editsOf } from "../../lib/db/repos/review.mjs";
import { modelFor } from "../../lib/register/weld-list.mjs";
import { payloadHash } from "../../lib/review/payload-hash.mjs";

if (!process.env.PG_TEST_URL) {
  console.log("correction-concurrency: SKIPPED — PG_TEST_URL is not set; no pool concurrency was tested.");
  process.exit(0);
}
const db = await createClient({ url: process.env.PG_TEST_URL });
assert(db.driver === "pg");
await migrate(db);
const user = await projects.ensureUser(db, { subject: "kc|correction-concurrency" });
const project = await projects.createProject(db, { code: "CORRECTION-PG", name: "Correction test", ownerUserId: user.id });
const other = await projects.createProject(db, { code: "CORRECTION-OTHER", name: "Other", ownerUserId: user.id });
const scoped = (fn, projectId = project.id) => withProject(db, projectId, fn);
const fixture = (name) => scoped(async () => {
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
     VALUES ($1,$2,'0',$3,'local://correction-test') RETURNING id`, [project.id, name, "e".repeat(64)]);
  const payload = { meta: { drawingNo: name, note: "original" },
    weldList: [{ no: "1", uid: crypto.randomUUID(), nps: "4", kind: "BW", loc: "Shop", spool: "SP-1" }] };
  const r = await runs.createRun(db, { projectId: project.id, documentId: doc.id, payload, createdBy: user.id });
  await runs.saveRegister(db, { projectId: project.id, runId: r.id, documentId: doc.id, model: modelFor(payload) });
  return r.id;
});
const snapshot = (id) => scoped(async () => {
  const { rows: [row] } = await db.query("SELECT payload FROM extraction_run WHERE id = $1", [id]);
  return { payload: row.payload, hash: payloadHash(row.payload),
    edits: await editsOf(db, { projectId: project.id, runId: id }),
    register: await runs.getRegister(db, { projectId: project.id, runId: id }) };
});
const correct = (id, payload, baseHash) => scoped(() => applyCorrection(db,
  { projectId: project.id, runId: id, payload, baseHash, userId: user.id }));
const outcome = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test("eight edits of one version: one commits, seven are stale; only the winner is in the audit and register", async () => {
  const id = await fixture("CORRECTION-RACE"), before = await snapshot(id);
  const attempts = Array.from({ length: 8 }, (_, i) => {
    const payload = structuredClone(before.payload); payload.meta.note = `editor-${i}`;
    return outcome(correct(id, payload, before.hash));
  });
  const results = await Promise.all(attempts);
  equal(results.filter((r) => r.value).length, 1);
  equal(results.filter((r) => r.error?.status === 409 && r.error.code === "STALE_RUN").length, 7);
  const after = await snapshot(id);
  equal(after.edits.length, 1, "losing edits leave no audit rows");
  equal([after.edits[0].path, after.edits[0].before_value, after.edits[0].after_value],
    ["meta.note", "original", after.payload.meta.note]);
  equal(after.register.map((w) => w.weld_uid), before.register.map((w) => w.weld_uid));
  equal(results.find((r) => r.value).value.payloadHash, after.hash, "the winner returns the stored version token");
});

// Hold an actual uncommitted write, then wait until the correction really waits on a PostgreSQL row lock.
// This distinguishes locking BEFORE reading/diffing from reading an old snapshot and waiting only at UPDATE.
async function whileWriterHoldsRun(id, makeCorrection) {
  const locked = deferred(), release = deferred();
  const writer = outcome(scoped(() => db.transaction(async (tx) => {
    const { rows: [r] } = await tx.query("SELECT payload FROM extraction_run WHERE id = $1 FOR UPDATE", [id]);
    r.payload.meta.note = "concurrent";
    await tx.query("UPDATE extraction_run SET payload = $1 WHERE id = $2", [JSON.stringify(r.payload), id]);
    locked.resolve();
    await release.promise;
  })));
  // A setup failure must not leave the test waiting forever for its own gate.
  await Promise.race([locked.promise, writer.then((r) => { if (r.error) throw r.error; })]);
  const correction = outcome(makeCorrection());
  let observed = false;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows: [r] } = await db.query(
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
         AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%extraction_run%') AS waiting`);
      if (r.waiting) { observed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    release.resolve();
    const result = await writer;
    if (result.error) throw result.error;
  }
  const result = await correction;
  assert(observed, "the correction must wait for the writer, even when its input appears unchanged");
  return result;
}

test("a legacy internal edit computes its audit diff from the locked current payload, not an earlier snapshot", async () => {
  const id = await fixture("CORRECTION-LEGACY"), before = await snapshot(id);
  const edited = structuredClone(before.payload); edited.meta.note = "final";
  const result = await whileWriterHoldsRun(id, () => correct(id, edited));
  if (result.error) throw result.error;
  const after = await snapshot(id);
  equal(after.payload.meta.note, "final");
  equal(after.edits.map((e) => [e.path, e.before_value, e.after_value]), [["meta.note", "concurrent", "final"]]);
});

test("a no-op against the old committed payload waits for the writer, then refuses its stale token", async () => {
  const id = await fixture("CORRECTION-NOOP"), before = await snapshot(id);
  const result = await whileWriterHoldsRun(id, () => correct(id, before.payload, before.hash));
  equal([result.error?.status, result.error?.code], [409, "STALE_RUN"]);
  const after = await snapshot(id);
  equal(after.payload.meta.note, "concurrent");
  equal(after.edits, [], "the stale no-op never logs a correction");
  equal(after.register, before.register, "nor replaces register rows");
});

test("a correction cannot use another project's run, and an approved run remains locked", async () => {
  const id = await fixture("CORRECTION-SCOPE"), before = await snapshot(id);
  await throws(() => scoped(() => applyCorrection(db, {
    projectId: other.id, runId: id, payload: before.payload, baseHash: before.hash, userId: user.id
  }), other.id), "not found");
  equal(await snapshot(id), before);
  await scoped(() => runs.approveRun(db, { projectId: project.id, runId: id, userId: user.id }));
  await throws(() => correct(id, before.payload, before.hash), "RUN_LOCKED");
  equal((await snapshot(id)).edits, []);
});

await run();
