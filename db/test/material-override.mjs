#!/usr/bin/env node
/**
 * Material override audit trail (Phase 2d, migration 101).
 *
 * A spool step that consumes material is refused while tracked material is not issued; an engineer can record it anyway
 * with a reason. That decision is an event of its own — who, when, why, which step, what was outstanding — in the
 * append-only `material_override` table, written in the same transaction as the step. These tests pin: the refusals, the
 * event's content, atomicity, history surviving later updates, the offline path (once, never twice, never when
 * refused), project isolation, and that nothing else changed.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { DEMO } from "../../lib/demo.js";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("mat-override-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const px = await import("../../lib/db/repos/piping-execution.mjs");
const fld = await import("../../lib/db/repos/field.mjs");

const db = await getDb();
const eng = await projects.ensureUser(db, { subject: "kc|eng" });
const qc = await projects.ensureUser(db, { subject: "kc|qc" });
const P = (await projects.createProject(db, { code: "OVR", name: "O", ownerUserId: eng.id })).id;
const Q = (await projects.createProject(db, { code: "OV2", name: "O2", ownerUserId: eng.id })).id;
const inP = (fn) => withProject(db, P, fn);
const ENG = { role: "engineer", areas: [] };
const QC = { role: "qc", areas: [] };

let run1, item, lot, seq = 0;
await inP(async () => {
  const { rows: [doc] } = await db.query(`INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-O','0',$2,'local://o') RETURNING id`, [P, "c".repeat(64)]);
  run1 = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: null, payload: DEMO });
  item = await wh.upsertItem(db, { projectId: P, code: "PIPE-O", description: "pipe", category: "pipe", uom: "m" });
  lot = await wh.receiveLot(db, { projectId: P, itemId: item.id, receiptNo: "MRR-O", receivedOn: "2026-09-01", qtyReceived: 100, heatNo: "H", mtcRef: "M" });
  await wh.inspectLot(db, { projectId: P, lotId: lot.id, qtyAccepted: 100, inspectedOn: "2026-09-02" });
  await wh.reviewMtc(db, { projectId: P, lotId: lot.id, mtcStatus: "accepted" });
});
/** A fresh spool whose list needs `qty` m of PIPE-O, none of it issued. */
const newSpool = (qty = 5) => inP(async () => {
  const { rows: [s] } = await db.query("INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,$3) RETURNING id", [P, run1.id, `SP-${++seq}`]);
  await db.query("INSERT INTO spool_material (project_id, spool_id, kind, qty, uom, stock_code) VALUES ($1,$2,'pipe',$3,'m','PIPE-O')", [P, s.id, qty]);
  return s;
});
const step = (spoolId, code, extra = {}, scope = db) => inP(() => px.recordSpoolActivity(scope, { projectId: P, spoolId, code, doneAt: "2026-09-10", userId: eng.id, membership: ENG, ...extra }));
const events = (spoolId) => inP(async () => (await db.query("SELECT * FROM material_override WHERE spool_id = $1 ORDER BY authorized_at, id", [spoolId])).rows);
const acts = (spoolId, code) => inP(async () => Number((await db.query("SELECT count(*) AS n FROM spool_activity WHERE spool_id = $1 AND code = $2", [spoolId, code])).rows[0].n));
const failOn = (re, base = db) => ({ ...base, query: async (sql, params) => { if (re.test(sql)) throw Object.assign(new Error("injected failure"), { injected: true }); return base.query(sql, params); } });
/** applyOps runs each operation on the transaction's own handle: fail the statement there. */
const failInTx = (re) => ({ ...db, transaction: (fn) => db.transaction((tx) => fn(failOn(re, tx))) });

test("1–2. no reason, or a blank one, is refused: no step, no event", async () => {
  const s = await newSpool();
  await throws(() => step(s.id, "fit_up"), "INVALID_INPUT");
  for (const blank of ["", "   ", "\n\t "]) await throws(() => step(s.id, "fit_up", { materialOverride: blank }), "INVALID_INPUT");
  equal(await acts(s.id, "fit_up"), 0);
  equal((await events(s.id)).length, 0);
});

test("3–5. a valid override writes the step and exactly one event: project, spool, activity, reason, user, server time", async () => {
  const s = await newSpool();
  const before = Date.now() - 2000;
  // a client that tries to dictate who and when: the repository has no such inputs, extra keys are ignored
  const r = await step(s.id, "fit_up", { materialOverride: "  pipe taken   from the yard,\nMIV to follow ", authorizedBy: qc.id, authorizedAt: "2001-01-01T00:00:00Z" });
  const ev = await events(s.id);
  equal(ev.length, 1);
  const [e] = ev;
  equal([e.project_id, e.spool_id, e.activity_id, e.code], [P, s.id, r.id, "fit_up"]);
  equal(e.reason, "pipe taken from the yard, MIV to follow", "whitespace is normalised");
  equal(e.authorized_by, eng.id);
  equal(e.source, "web");
  assert(e.op_id === null);
  const at = new Date(e.authorized_at).getTime();
  assert(at >= before && at <= Date.now() + 2000, `authorized_at ${e.authorized_at} is the server's clock`);
  assert(Array.isArray(e.warnings) && e.warnings.length === 1 && /PIPE-O/.test(e.warnings[0]), JSON.stringify(e.warnings));
  assert(r.materialWarnings?.length === 1, "the answer still says what was missing");
});

test("6. a failure while writing the event rolls the step back", async () => {
  const s = await newSpool();
  await throws(() => step(s.id, "fit_up", { materialOverride: "yard stock" }, failOn(/INSERT INTO material_override/)), "injected failure");
  equal(await acts(s.id, "fit_up"), 0, "no step without its event");
  equal((await events(s.id)).length, 0);
  // and the other way round: a failure in the step writes no event
  await throws(() => step(s.id, "fit_up", { materialOverride: "yard stock" }, failOn(/INSERT INTO spool_activity/)), "injected failure");
  equal((await events(s.id)).length, 0);
});

test("7. updating the same step keeps every earlier event", async () => {
  const s = await newSpool();
  const first = await step(s.id, "fit_up", { materialOverride: "first reason" });
  const second = await step(s.id, "fit_up", { materialOverride: "second reason", refNo: "FU-7" });
  equal(second.id, first.id, "the same activity row, updated");
  const ev = await events(s.id);
  equal(ev.map((e) => e.reason), ["first reason", "second reason"]);
  equal(ev.map((e) => e.activity_id), [first.id, first.id]);
  // the step's note was overwritten-by-coalesce territory; the events are the record
  await inP(async () => { await db.query("UPDATE spool_activity SET note = 'rewritten' WHERE id = $1", [first.id]); });
  equal((await events(s.id)).map((e) => e.reason), ["first reason", "second reason"]);
});

/** An UPDATE is refused by the trigger (PGlite: one superuser) or, for the application role, by the revoked privilege (PostgreSQL). */
const refused = async (fn) => { try { await fn(); } catch (e) { assert(/append-only|permission denied/.test(String(e.message)), `wrong error: ${e.message}`); return; } throw new Error("expected the change to be refused"); };

test("append-only: the table refuses an UPDATE of an event, and the application role cannot DELETE one", async () => {
  const s = await newSpool();
  await step(s.id, "fit_up", { materialOverride: "r" });
  await refused(() => inP(() => db.query("UPDATE material_override SET reason = 'edited' WHERE spool_id = $1", [s.id])));
  await refused(() => inP(() => db.query("UPDATE material_override SET authorized_by = $2 WHERE spool_id = $1", [s.id, qc.id])));
  // The application role has no DELETE grant. PGlite has no roles to enforce it (one superuser); PostgreSQL does.
  if (process.env.DATABASE_URL) await throws(() => inP(() => db.query("DELETE FROM material_override WHERE spool_id = $1", [s.id])), "permission denied");
  equal((await events(s.id)).map((e) => e.reason), ["r"]);
  await throws(() => inP(() => db.query("INSERT INTO material_override (project_id, spool_id, code, reason, authorized_by, source) VALUES ($1,$2,'fit_up','  ',$3,'web')", [P, s.id, eng.id])), "material_override_reason_not_blank");
});

test("deleting the activity detaches the event; the event keeps its spool and step", async () => {
  const s = await newSpool();
  const r = await step(s.id, "fit_up", { materialOverride: "r" });
  await inP(() => db.query("DELETE FROM spool_activity WHERE id = $1", [r.id]));
  const [e] = await events(s.id);
  equal([e.activity_id, e.code, e.reason], [null, "fit_up", "r"]);
});

test("11. without the override permission: refused, nothing written (online)", async () => {
  const s = await newSpool();
  for (const m of [QC, { role: "viewer", areas: [] }, undefined]) {
    const e = await throws(() => step(s.id, "fit_up", { materialOverride: "I say so", membership: m, userId: qc.id }), "");
    assert(e.status === 403 || e.code === "FORBIDDEN", `${m?.role}: ${e.message}`);
  }
  equal(await acts(s.id, "fit_up"), 0);
  equal((await events(s.id)).length, 0);
  // the refusal for someone who cannot override does not invite them to
  const e = await throws(() => step(s.id, "fit_up", { membership: QC }), "INVALID_INPUT");
  assert(!/materialOverride/.test(e.message), e.message);
  // an admin may
  await step(s.id, "fit_up", { materialOverride: "admin decision", membership: { role: "admin", areas: [] } });
  equal((await events(s.id)).length, 1);
});

test("12. steps that use no material, and a spool with no list, are untouched", async () => {
  const s = await newSpool();
  const r = await step(s.id, "released", { membership: QC, userId: qc.id });
  equal(r.status, "done");
  assert(!r.materialWarnings);
  const none = await inP(async () => (await db.query("INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,'SP-NOLIST') RETURNING id", [P, run1.id])).rows[0]);
  const r2 = await step(none.id, "fit_up", { membership: QC, userId: qc.id });
  equal(r2.status, "done");
  equal((await events(s.id)).length + (await events(none.id)).length, 0);
});

test("13. once the material is issued the step needs no override and writes no event", async () => {
  const s = await newSpool(4);
  await inP(() => wh.recordMovement(db, { projectId: P, lotId: lot.id, kind: "issue", qty: 4, movedOn: "2026-09-09", spoolId: s.id }));
  const r = await step(s.id, "erected", { membership: QC, userId: qc.id });
  equal(r.status, "done");
  assert(!r.materialWarnings);
  equal((await events(s.id)).length, 0);
});

const uuid = () => globalThis.crypto.randomUUID();
const op = (spoolId, payload = {}) => ({ opId: uuid(), kind: "spool_step", projectId: P, capturedAt: new Date().toISOString(), payload: { spoolId, code: "fit_up", doneOn: "2026-09-10", ...payload } });
const sync = (ops, userId = eng.id, membership = ENG) => fld.applyOps(db, { projectId: P, userId, membership, ops });

test("offline: an applied override writes one event naming the syncing user, source offline and the op; a replay adds none", async () => {
  const s = await newSpool();
  const o = op(s.id, { materialOverride: "issued on paper, MIV tomorrow", userId: qc.id, authorizedBy: qc.id });
  const [a] = await sync([o]);
  equal(a.status, "applied");
  let ev = await events(s.id);
  equal(ev.length, 1);
  equal([ev[0].authorized_by, ev[0].source, ev[0].op_id, ev[0].activity_id], [eng.id, "offline", o.opId, a.result.activityId]);
  const [again] = await sync([o]);
  assert(again.duplicate, "the repeat is answered from the record");
  const [fromOther] = await sync([o], qc.id, QC);
  assert(fromOther.duplicate);
  equal((await events(s.id)).length, 1, "replaying does not duplicate the event");
});

test("offline: a rejected operation (no reason / no permission / blank) leaves no event and no step", async () => {
  const s = await newSpool();
  const [noReason] = await sync([op(s.id)]);
  const [blank] = await sync([op(s.id, { materialOverride: "   " })]);
  const [noPerm] = await sync([op(s.id, { materialOverride: "trust me" })], qc.id, QC);
  for (const r of [noReason, blank, noPerm]) equal(r.status, "rejected");
  assert(/PIPE-O/.test(noReason.error), noReason.error);
  equal(await acts(s.id, "fit_up"), 0);
  equal((await events(s.id)).length, 0);
});

test("offline: a failure writing the event rolls the step and the operation record back; the retry then applies once", async () => {
  const s = await newSpool();
  const o = op(s.id, { materialOverride: "yard stock" });
  const broken = failInTx(/INSERT INTO material_override/);
  const [r] = await fld.applyOps(broken, { projectId: P, userId: eng.id, membership: ENG, ops: [o] });
  equal(r.status, "retry");
  equal(await acts(s.id, "fit_up"), 0);
  equal((await events(s.id)).length, 0);
  const [ok] = await sync([o]);
  equal(ok.status, "applied");
  equal((await events(s.id)).length, 1);
});

test("10. another project sees none of it, by repository, by direct query, and by spool id", async () => {
  const s = await newSpool();
  await step(s.id, "fit_up", { materialOverride: "r" });
  const mine = await inP(() => px.materialOverrides(db, { projectId: P, spoolId: s.id }));
  equal(mine.length, 1);
  equal([mine[0].reason, mine[0].authorized_by_name === undefined], ["r", false]);
  const theirs = await withProject(db, Q, async () => ({
    byRepo: await px.materialOverrides(db, { projectId: Q, spoolId: s.id }),
    all: await px.materialOverrides(db, { projectId: Q }),
    direct: Number((await db.query("SELECT count(*) AS n FROM material_override")).rows[0].n),
  }));
  equal([theirs.byRepo.length, theirs.all.length, theirs.direct], [0, 0, 0]);
  // asking project P's rows under project Q's scope, naming P: still nothing
  const forged = await withProject(db, Q, () => px.materialOverrides(db, { projectId: P, spoolId: s.id }));
  equal(forged.length, 0);
  // a row for a spool of P cannot be written under Q's scope
  await throws(() => withProject(db, Q, () => db.query("INSERT INTO material_override (project_id, spool_id, code, reason, authorized_by, source) VALUES ($1,$2,'fit_up','x',$3,'web')", [P, s.id, eng.id])), "row-level security");
});

test("the history is listed newest first with the person's name", async () => {
  const s = await newSpool();
  await step(s.id, "fit_up", { materialOverride: "one" });
  await step(s.id, "erected", { materialOverride: "two" });
  const h = await inP(() => px.materialOverrides(db, { projectId: P, spoolId: s.id }));
  equal(h.map((x) => x.reason), ["two", "one"]);
  equal(h[0].spool_no, `SP-${seq}`);
  assert("authorized_by_name" in h[0]);
});

await run();
