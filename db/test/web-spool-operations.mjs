#!/usr/bin/env node
/** Browser retry contract and authenticated web spool operation receipts. */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { isDeepStrictEqual } from "node:util";
import { prepareSpoolOperation, acknowledgeSpoolOperation } from "../../lib/client/spool-operation.mjs";

const memory = () => {
  const rows = new Map();
  return { getItem: (k) => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, v), removeItem: (k) => rows.delete(k) };
};
const intent = { actorId: "user-a", projectId: "project-a", spoolId: "spool-a", code: "fit_up", doneAt: "2026-09-10", refNo: "FU-1" };
test("a lost override response retains both its UUID and reason after a reload", () => {
  const storage = memory();
  const first = prepareSpoolOperation(storage, { ...intent, materialOverride: "yard stock" });
  const again = prepareSpoolOperation(storage, intent, () => { throw new Error("must not mint another operation"); });
  equal(again.command, first.command);
  equal(again.command.materialOverride, "yard stock");
  assert(acknowledgeSpoolOperation(storage, again));
  equal(storage.getItem(again.key), null);
});
test("another actor and a changed command get separate operations; a late acknowledgement cannot remove a newer one", () => {
  const storage = memory();
  const first = prepareSpoolOperation(storage, intent);
  const changed = prepareSpoolOperation(storage, { ...intent, refNo: "FU-2" });
  assert(changed.command.opId !== first.command.opId);
  equal(acknowledgeSpoolOperation(storage, first), false);
  equal(JSON.parse(storage.getItem(changed.key)).command.opId, changed.command.opId);
  const other = prepareSpoolOperation(storage, { ...intent, actorId: "user-b" });
  assert(other.key !== first.key && other.command.opId !== first.command.opId);
});
test("a definite rejection followed by an explicit new override reason gets a new command", () => {
  const storage = memory(), first = prepareSpoolOperation(storage, intent);
  const override = prepareSpoolOperation(storage, { ...intent, materialOverride: "yard stock" });
  assert(first.command.opId !== override.command.opId);
  const changed = prepareSpoolOperation(storage, { ...intent, materialOverride: "different reason" });
  assert(changed.command.opId !== override.command.opId);
});
test("unavailable or corrupt browser storage refuses submission rather than forgetting an uncertain command", async () => {
  for (const storage of [null, { getItem() { throw new Error("disabled"); } },
    { getItem: () => null, setItem() { throw new Error("quota"); } },
    { getItem: () => "{broken" }]) {
    await throws(() => prepareSpoolOperation(storage, intent), "PENDING_OPERATION_STORAGE");
  }
});

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("web-spool-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const px = await import("../../lib/db/repos/piping-execution.mjs");
const route = await import("../../app/api/piping/execution/route.js");
const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|web-alice" });
const viewer = await projects.ensureUser(db, { subject: "kc|web-viewer" });
const qc = await projects.ensureUser(db, { subject: "kc|web-qc" });
const P = (await projects.createProject(db, { code: "WEB-A", name: "A", ownerUserId: alice.id })).id;
const Q = (await projects.createProject(db, { code: "WEB-B", name: "B", ownerUserId: alice.id })).id;
await projects.addMember(db, { projectId: P, userId: viewer.id, role: "viewer" });
await projects.addMember(db, { projectId: P, userId: qc.id, role: "qc" });
const scoped = (fn, p = P) => withProject(db, p, fn);
let seq = 0;
const spool = (p = P) => scoped(async () => {
  const name = `WEB-${++seq}`;
  const { rows: [doc] } = await db.query(`INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
    VALUES ($1,$2,'0',$3,'local://web-test') RETURNING id`, [p, name, "f".repeat(64)]);
  const r = await runs.createRun(db, { projectId: p, documentId: doc.id, payload: { meta: { drawingNo: name } } });
  const { rows: [s] } = await db.query("INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,$3) RETURNING id", [p, r.id, name]);
  await wh.upsertItem(db, { projectId: p, code: name, description: "pipe", category: "pipe", uom: "m" });
  await db.query("INSERT INTO spool_material (project_id, spool_id, kind, qty, uom, stock_code) VALUES ($1,$2,'pipe',5,'m',$3)", [p, s.id, name]);
  return s.id;
}, p);
const command = (spoolId, projectId = P) => ({ projectId, spoolId, kind: "activity", code: "fit_up", doneAt: "2026-09-10",
  materialOverride: "yard stock", opId: crypto.randomUUID() });
const post = async (body, as = "kc|web-alice") => {
  const r = await route.POST(new Request("http://x/api/piping/execution", { method: "POST",
    headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const effects = (id, p = P) => scoped(async () => ({
  activities: (await db.query("SELECT id, note, recorded_by FROM spool_activity WHERE spool_id = $1", [id])).rows,
  overrides: (await db.query("SELECT id, op_id, reason FROM material_override WHERE spool_id = $1", [id])).rows,
}), p);

test("HTTP: missing and invalid opIds have no effects; authorization still comes first", async () => {
  const id = await spool(), args = command(id);
  for (const opId of [undefined, null, "", 17, "invalid"]) {
    const r = await post({ ...args, opId });
    equal([r.status, r.body.code], [400, "OP_ID_REQUIRED"]);
  }
  equal((await post({ ...args, opId: undefined }, "kc|web-viewer")).status, 403);
  equal((await post(args, "kc|web-qc")).status, 403, "QC may not override missing material");
  equal(await effects(id), { activities: [], overrides: [] });
  equal((await scoped(() => db.query("SELECT op_id FROM web_spool_operation"))).rows, []);
});
test("HTTP: retries return the same result; payload and actor conflicts do not change the step or its audit", async () => {
  const id = await spool(), args = command(id);
  const first = await post(args), again = await post({ ...args, opId: args.opId.toUpperCase() });
  equal([first.status, again.status], [200, 200]);
  equal([first.body.replayed, again.body.replayed], [false, true]);
  assert(isDeepStrictEqual(first.body.activity, again.body.activity), "a replay returns the same JSON values");
  const before = await effects(id);
  equal([before.activities.length, before.overrides.length], [1, 1]);
  for (const [body, actor] of [[{ ...args, refNo: "different" }, "kc|web-alice"], [args, "kc|web-qc"]]) {
    const conflict = await post(body, actor);
    equal([conflict.status, conflict.body.code], [409, "OP_ID_CONFLICT"]);
  }
  equal(await effects(id), before);
});
test("HTTP: a global UUID collision in another project is a safe conflict, with all attempted writes rolled back", async () => {
  const id = await spool(), otherId = await spool(Q), args = command(id);
  equal((await post(args)).status, 200);
  const conflict = await post({ ...command(otherId, Q), opId: args.opId });
  equal([conflict.status, conflict.body.code], [409, "OP_ID_CONFLICT"]);
  assert(!conflict.body.activity, "another project's result is never disclosed");
  equal(await effects(otherId, Q), { activities: [], overrides: [] });
});
test("the committed receipt survives re-derivation and replays without recreating a deleted spool", async () => {
  const id = await spool(), args = command(id);
  const first = await post(args);
  await scoped(() => db.query("DELETE FROM spool WHERE id = $1", [id]));
  const replay = await post(args);
  equal([replay.status, replay.body.replayed], [200, true]);
  assert(isDeepStrictEqual(replay.body.activity, first.body.activity));
  equal((await scoped(() => db.query("SELECT id FROM spool WHERE id = $1", [id]))).rows, []);
});
test("an incomplete receipt cannot be committed", async () => {
  for (const result of [null, [], {}, { id: null }]) {
    await throws(() => scoped(() => db.query(
      "INSERT INTO web_spool_operation (op_id, project_id, user_id, request_hash, result) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [crypto.randomUUID(), P, alice.id, "a".repeat(64), JSON.stringify(result)])));
  }
});

await run();
