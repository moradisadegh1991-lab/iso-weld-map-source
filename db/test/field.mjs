#!/usr/bin/env node
/**
 * The field: a label decodes to the item it was printed for, a scan that
 * is not ours is not guessed at, and a batch captured offline is applied
 * once, in the order it happened, each operation judged by the same
 * engines as a desk entry — refusals kept, not dropped.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import jsQR from "jsqr";
import { fieldUrl, parseFieldCode, qrMatrix, qrSvg } from "../../lib/field/qr.mjs";
import { opProblems, newOp, inCaptureOrder } from "../../lib/field/ops.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";

// ── labels ───────────────────────────────────────────────────────────────

/** Rasterise a matrix the way a printer would, then decode it with an independent reader. */
function decode(matrix, scale = 4) {
  const n = matrix.length + 8;
  const w = n * scale;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  matrix.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + 4) * scale + y) * w + (c + 4) * scale + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }));
  return jsQR(px, w, w)?.data ?? null;
}

test("a label decodes, with an independent reader, to exactly the URL it was printed for", async () => {
  for (const [kind, no] of [["t", "P-1203A"], ["s", "28-CWR-10-930065A-S03"], ["c", "EC-1203A-P"], ["i", "FT-2101.A"]]) {
    const url = fieldUrl({ origin: "https://epc.example.ir/", projectCode: "DEMO", kind, no });
    equal(decode(qrMatrix(url)), url, `${kind} ${no}`);
    equal(parseFieldCode(url), { kind, no, project: "DEMO" });
  }
  const svg = qrSvg("https://x/field?p=A&k=t&n=B");
  assert(svg.startsWith("<svg") && svg.includes('fill="#fff"'), "a white background, drawn");
  const n = Number(svg.match(/viewBox="0 0 (\d+)/)[1]);
  const xs = [...svg.matchAll(/M(\d+) (\d+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
  equal([Math.min(...xs), Math.max(...xs)], [4, n - 5], "four blank modules on every side — the quiet zone scanners need");
});

test("a scan that is not ours is not guessed at; a typed number is a tag in the current project", async () => {
  equal(parseFieldCode("https://shop.example.com/product?id=7"), null);
  equal(parseFieldCode("https://shop.example.com/product?k=t&n=P-1"), null, "the same parameters on someone else's page");
  equal(parseFieldCode("https://epc.example.ir/field?p=DEMO&k=x&n=P-1"), null, "unknown kind");
  equal(parseFieldCode("https://epc.example.ir/field?p=DEMO&k=t"), null, "no number");
  equal(parseFieldCode("not a url with spaces"), null);
  equal(parseFieldCode(" p-1203a "), { kind: "t", no: "P-1203A", project: null });
  equal(parseFieldCode(""), null);
  assert(!(() => { try { fieldUrl({ origin: "x", projectCode: "D", kind: "z", no: "1" }); return true; } catch { return false; } })());
});

// ── operations ───────────────────────────────────────────────────────────

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const base = { opId: ID, capturedAt: "2026-09-20T08:00:00Z" };

test("an operation is checked on the phone as it will be on the server", async () => {
  equal(opProblems({ ...base, kind: "tag_step", payload: { tagId: "x", code: "set", doneOn: "2026-09-20" } }, { today: "2026-09-25" }), []);
  equal(opProblems({ ...base, kind: "tag_step", payload: { tagId: "x", code: "set", doneOn: "2026-09-26" } }, { today: "2026-09-25" }).length, 1,
    "a site date in the future");
  equal(opProblems({ ...base, kind: "tag_step", payload: { tagId: "x", code: "set", doneOn: "20/09/2026" } }).length, 1);
  equal(opProblems({ ...base, opId: "1", kind: "tag_step", payload: { tagId: "x", code: "set", doneOn: "2026-09-20" } }).length, 1);
  equal(opProblems({ ...base, kind: "punch_raise", payload: { tagId: "x", category: "D", description: "d", raisedOn: "2026-09-20" } }).length, 1);
  equal(opProblems({ ...base, kind: "delete_everything", payload: {} }).length, 1);
  const op = newOp("punch_clear", { punchId: "p", note: "n", clearedOn: "2026-09-20" }, { projectId: "P", id: ID, now: new Date("2026-09-20T09:00:00Z") });
  equal([op.opId, op.capturedAt], [ID, "2026-09-20T09:00:00.000Z"]);
  equal(inCaptureOrder([{ capturedAt: "2026-09-20T10:00Z" }, { capturedAt: "2026-09-20T09:00Z" }]).map((o) => o.capturedAt),
    ["2026-09-20T09:00Z", "2026-09-20T10:00Z"]);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "fld-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const qa = await import("../../lib/db/repos/quality.mjs");
const fld = await import("../../lib/db/repos/field.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const proj = await projects.createProject(db, { code: "FLD", name: "F", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "FLD2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const TODAY = new Date().toISOString().slice(0, 10);
const QC = { role: "qc" }, VIEWER = { role: "viewer" };
let pump, spools, closedPunch;
const uuid = () => globalThis.crypto.randomUUID();
const op = (kind, payload, minutes = 0) => ({ opId: uuid(), kind, projectId: P, payload,
  capturedAt: new Date(Date.now() - 3600_000 + minutes * 60_000).toISOString() });

await withProject(db, P, async () => {
  const sub = await spine.upsertSubsystem(db, { projectId: P, code: "12-01", systemCode: "12" });
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203A", discipline: "equipment", kind: "rotating", subsystemId: sub.id });
  const { rows: [line] } = await db.query("INSERT INTO line (project_id, line_no, subsystem_id) VALUES ($1,'10-P-101',$2) RETURNING id", [P, sub.id]);
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`, [P, "f".repeat(64)]);
  const model = buildModel(DEMO, {});
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: line.id, payload: DEMO, validationChecks: model.checks });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: line.id, model });
  ({ rows: spools } = await db.query("SELECT id, spool_no FROM spool WHERE project_id = $1 ORDER BY spool_no", [P]));
  closedPunch = await qa.raisePunch(db, { projectId: P, tagId: pump.id, category: "B", description: "x", raisedOn: TODAY, userId: alice.id });
  await qa.punchAction(db, { projectId: P, punchId: closedPunch.id, action: "clear", note: "done", userId: alice.id });
  await qa.punchAction(db, { projectId: P, punchId: closedPunch.id, action: "verify", userId: bob.id });
});

test("the pack carries each item's state as the server judged it, and when", async () => {
  await withProject(db, P, async () => {
    const pack = await fld.fieldPack(db, { projectId: P });
    const t = pack.tags.find((x) => x.no === "P-1203A");
    assert(t.steps.length > 0 && t.steps.every((s) => "derived" in s));
    assert(pack.spools.length === spools.length && pack.spools[0].steps.some((s) => s.derived), "shop welding is derived");
    assert(Date.parse(pack.generatedAt) > 0);
    equal(pack.project.code, "FLD");
    equal(pack.punch.length, 0, "the closed punch item is not carried");
  });
});

test("a batch applies in capture order, once — the repeat answers from the record", async () => {
  const set = op("tag_step", { tagId: pump.id, code: "set", doneOn: TODAY }, 5);
  const released = op("spool_step", { spoolId: spools[0].id, code: "released", doneOn: TODAY }, 1);
  const raise = op("punch_raise", { tagId: pump.id, category: "A", description: "Guard missing", raisedOn: TODAY }, 3);
  const r1 = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [set, raise, released] });
  equal(r1.map((r) => [r.opId, r.status]), [[released.opId, "applied"], [raise.opId, "applied"], [set.opId, "applied"]]);
  const r2 = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [set, raise, released] });
  assert(r2.every((r) => r.duplicate && r.status === "applied"), "applied once");
  await withProject(db, P, async () => {
    equal((await db.query("SELECT count(*)::int AS n FROM punch_item WHERE description = 'Guard missing'")).rows[0].n, 1);
    const { rows: [a] } = await db.query("SELECT done_at, note FROM tag_activity WHERE tag_id = $1 AND code = 'set'", [pump.id]);
    equal(a.done_at.toISOString().slice(0, 10), TODAY, "the site date, not the sync date");
    assert(/آفلاین/.test(a.note));
  });
});

test("the engines refuse on sync what they would refuse at a desk, and the refusal is kept", async () => {
  const derived = op("spool_step", { spoolId: spools[0].id, code: "shop_weld", doneOn: TODAY });
  const closed = op("punch_clear", { punchId: closedPunch.id, note: "again", clearedOn: TODAY });
  const future = op("tag_step", { tagId: pump.id, code: "grout", doneOn: "2099-01-01" });
  const foreign = { ...op("tag_step", { tagId: pump.id, code: "grout", doneOn: TODAY }), projectId: other.id };
  const r = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [derived, closed, future, foreign] });
  equal(r.map((x) => x.status), ["rejected", "rejected", "rejected", "rejected"]);
  assert(/رجیستر جوش/.test(r[0].error), r[0].error);
  assert(/رفع‌شده|باز/.test(r[1].error), r[1].error);
  const again = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [derived] });
  equal([again[0].status, again[0].duplicate, again[0].error], ["rejected", true, r[0].error], "the same refusal, from the record");
  await withProject(db, P, async () => {
    const recent = await fld.recentOps(db, { projectId: P });
    equal(recent.filter((x) => x.status === "rejected").length, 4);
    await throws(() => db.query("UPDATE field_op SET status = 'applied'"), "permission denied");
  });
});

test("a role without the right is refused per operation, not per batch", async () => {
  const step = op("tag_step", { tagId: pump.id, code: "grout", doneOn: TODAY });
  const r = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: VIEWER, ops: [step] });
  equal(r[0].status, "rejected");
  assert(/اجازه/.test(r[0].error));
});

test("an error inside an operation's transaction is its refusal, and the batch goes on", async () => {
  // A repository refusal (a tag filed nowhere), and a database error inside
  // the transaction (an id that is not a uuid): each is that operation's
  // answer, and the operation after them applies on a clean connection.
  const loose = await withProject(db, P, () => spine.upsertTag(db, { projectId: P, tagNo: "E-9", discipline: "equipment" }));
  const refused = op("punch_raise", { tagId: loose.id, category: "A", description: "x", raisedOn: TODAY }, 1);
  const malformed = op("spool_step", { spoolId: "not-a-uuid", code: "released", doneOn: TODAY }, 2);
  const good = op("punch_raise", { tagId: pump.id, category: "C", description: "Nameplate", raisedOn: TODAY }, 3);
  const r = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [refused, malformed, good] });
  equal(r.map((x) => x.status), ["rejected", "rejected", "applied"]);
  assert(/قالب/.test(r[1].error), r[1].error);
  const { rows: [who] } = await db.query("SELECT current_user AS u, current_setting('app.project_id', true) AS p");
  equal(who.p || "", "", "no project left bound after the batch");
});

test("field operations belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await fld.recentOps(db, { projectId: other.id })).length, 0);
  });
});

await run();
