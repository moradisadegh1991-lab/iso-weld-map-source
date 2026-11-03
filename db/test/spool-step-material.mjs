#!/usr/bin/env node
/**
 * A spool step that consumes material, recorded with the material not issued (audit 2026-11-03, Phase 2 finding C4).
 * It is RECORDED — site work is real and the platform does not know every way material reaches a spool — but the answer
 * says what is missing (`materialWarnings`), so it is not silent. A spool with no material list says nothing.
 */
import { test, run, assert, equal, scratchDir } from "./harness.mjs";
import { DEMO } from "../../lib/demo.js";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("spool-step-mat-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const px = await import("../../lib/db/repos/piping-execution.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const P = (await projects.createProject(db, { code: "SSM", name: "S", ownerUserId: alice.id })).id;
const inP = (fn) => withProject(db, P, fn);
let withList, noList, item, lot;

await inP(async () => {
  const { rows: [doc] } = await db.query(`INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-S','0',$2,'local://s') RETURNING id`, [P, "b".repeat(64)]);
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: null, payload: DEMO });
  ({ rows: [withList] } = await db.query("INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,'SP-1') RETURNING id", [P, r.id]));
  ({ rows: [noList] } = await db.query("INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,'SP-2') RETURNING id", [P, r.id]));
  await db.query("INSERT INTO spool_material (project_id, spool_id, kind, qty, uom, stock_code) VALUES ($1,$2,'pipe',5,'m','PIPE-S')", [P, withList.id]);
  item = await wh.upsertItem(db, { projectId: P, code: "PIPE-S", description: "pipe", category: "pipe", uom: "m" });
  lot = await wh.receiveLot(db, { projectId: P, itemId: item.id, receiptNo: "MRR-S", receivedOn: "2026-09-01", qtyReceived: 20, heatNo: "H", mtcRef: "M" });
  await wh.inspectLot(db, { projectId: P, lotId: lot.id, qtyAccepted: 20, inspectedOn: "2026-09-02" });
  await wh.reviewMtc(db, { projectId: P, lotId: lot.id, mtcStatus: "accepted" });
});
const step = (spoolId, code) => inP(() => px.recordSpoolActivity(db, { projectId: P, spoolId, code, doneAt: "2026-09-10", userId: alice.id }));

test("a step that consumes material, done with the material not issued, is recorded and says what is missing", async () => {
  const r = await step(withList.id, "fit_up");
  equal(r.status, "done", "the step is recorded");
  assert(Array.isArray(r.materialWarnings) && r.materialWarnings.length === 1, JSON.stringify(r.materialWarnings));
  assert(/PIPE-S/.test(r.materialWarnings[0]), r.materialWarnings[0]);
});

test("a step that does not consume material says nothing", async () => {
  const r = await step(withList.id, "released");
  assert(!r.materialWarnings, JSON.stringify(r.materialWarnings));
});

test("once the material is issued to the spool the step has nothing to warn about", async () => {
  await inP(() => wh.recordMovement(db, { projectId: P, lotId: lot.id, kind: "issue", qty: 5, movedOn: "2026-09-09", spoolId: withList.id }));
  const r = await step(withList.id, "erected");
  assert(!r.materialWarnings, JSON.stringify(r.materialWarnings));
});

test("a spool with no material list: nothing to compare, nothing said", async () => {
  const r = await step(noList.id, "fit_up");
  equal(r.status, "done");
  assert(!r.materialWarnings);
});

await run();
