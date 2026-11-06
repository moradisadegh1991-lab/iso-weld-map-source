#!/usr/bin/env node
/**
 * A spool step that consumes material (fit-up, erection) is REFUSED while the spool's material list is not all issued
 * (owner's decision after the Phase 2 audit: warn → block). Site work is real and material can reach a spool in ways the
 * platform does not know, so the refusal has a way through that leaves a trace: `materialOverride`, a reason in words,
 * records the step anyway, keeps the reason in its note, and the answer still says what was missing. A step that
 * consumes no material, and a spool with no material list, are not affected.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
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
const step = (spoolId, code, extra = {}) => inP(() => px.recordSpoolActivity(db, { projectId: P, spoolId, code, doneAt: "2026-09-10", userId: alice.id, membership: { role: "engineer", areas: [] }, ...extra }));
const recorded = (spoolId, code) => inP(async () => Number((await db.query("SELECT count(*) AS n FROM spool_activity WHERE spool_id = $1 AND code = $2", [spoolId, code])).rows[0].n));

test("a step that consumes material is refused while the spool's material is not issued, and says what is missing", async () => {
  const e = await throws(() => step(withList.id, "fit_up"), "INVALID_INPUT");
  assert(/PIPE-S/.test(e.message), e.message);
  equal(await recorded(withList.id, "fit_up"), 0, "nothing is recorded by a refused step");
});

test("with an override reason it is recorded, the reason stays in its note, and the answer still says what was missing", async () => {
  await throws(() => step(withList.id, "fit_up", { materialOverride: "  " }), "INVALID_INPUT", "a blank reason is not a reason");
  const r = await step(withList.id, "fit_up", { materialOverride: "pipe taken from the yard, MIV to follow" });
  equal(r.status, "done");
  assert(r.materialWarnings?.length === 1 && /PIPE-S/.test(r.materialWarnings[0]), JSON.stringify(r.materialWarnings));
  assert(/MIV to follow/.test(r.note), r.note);
  equal(await recorded(withList.id, "fit_up"), 1);
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

test("on site (offline sync): the same refusal, and the same way through", async () => {
  const fld = await import("../../lib/db/repos/field.mjs");
  const third = await inP(async () => {
    const { rows: [sp] } = await db.query("SELECT extraction_run_id FROM spool WHERE id = $1", [withList.id]);
    const { rows: [t] } = await db.query("INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,'SP-3') RETURNING id", [P, sp.extraction_run_id]);
    await db.query("INSERT INTO spool_material (project_id, spool_id, kind, qty, uom, stock_code) VALUES ($1,$2,'pipe',3,'m','PIPE-S')", [P, t.id]);
    return t;
  });
  const uuid = () => globalThis.crypto.randomUUID();
  const op = (payload) => ({ opId: uuid(), kind: "spool_step", projectId: P, capturedAt: new Date().toISOString(), payload: { spoolId: third.id, code: "fit_up", doneOn: "2026-09-10", ...payload } });
  const admin = { role: "admin", areas: [] };
  const [refused] = await fld.applyOps(db, { projectId: P, userId: alice.id, membership: admin, ops: [op({})] });
  equal(refused.status, "rejected");
  assert(/PIPE-S/.test(refused.error), refused.error);
  const [ok] = await fld.applyOps(db, { projectId: P, userId: alice.id, membership: admin, ops: [op({ materialOverride: "issued on paper, MIV tomorrow" })] });
  equal(ok.status, "applied");
  assert(ok.result.materialWarnings?.length === 1, JSON.stringify(ok.result));
});

test("a spool with no material list: nothing to compare, nothing said", async () => {
  const r = await step(noList.id, "fit_up");
  equal(r.status, "done");
  assert(!r.materialWarnings);
});

await run();
