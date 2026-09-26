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
import { opProblems, newOp, inCaptureOrder, parseCalPoints, splitReadings } from "../../lib/field/ops.mjs";
import { sniffImage, photoProblems, MAX_PHOTO_BYTES } from "../../lib/quality/photo.mjs";
import { createLocalStore } from "../../lib/storage/content-store.mjs";
import { judgeIr } from "../../lib/electrical/cable.mjs";
import { judgeCalibration } from "../../lib/instrumentation/isa.mjs";
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

test("IR readings and calibration points are read on the phone as the server reads them", async () => {
  equal(splitReadings("2000, >2000  ∞"), ["2000", ">2000", "∞"]);
  equal(parseCalPoints("0:4.01 12.5:12"), [{ applied: 0, output: 4.01 }, { applied: 12.5, output: 12 }]);
  equal([parseCalPoints("0:4 12.5"), parseCalPoints("0:x"), parseCalPoints(":4"), parseCalPoints(""), parseCalPoints("0:4:5")],
    [null, null, null, null, null], "a typo like 0:4:5 is refused, not read as 0:4");
  const ir = { ...base, kind: "cable_ir", payload: { cableId: "c", testVoltageV: 500, readings: "2000 2000 2000", testedOn: "2026-09-20" } };
  equal(opProblems(ir, { today: "2026-09-25" }), []);
  equal(opProblems({ ...ir, payload: { ...ir.payload, testVoltageV: -5 } }).length, 1);
  equal(opProblems({ ...ir, payload: { ...ir.payload, testedOn: "2026-09-26" } }, { today: "2026-09-25" }).length, 1, "a test in the future");
  equal(opProblems({ ...base, kind: "loop_check", payload: { loopNo: "L", checkedOn: "2026-09-26" } }, { today: "2026-09-25" }).length, 1);
  equal(opProblems({ ...ir, payload: { ...ir.payload, readings: " , " } }).length, 1);
  const cal = { ...base, kind: "instrument_cal", payload: { instrumentId: "i", points: "0:4 5:8", calibratedOn: "2026-09-20" } };
  equal(opProblems(cal), []);
  equal(opProblems({ ...cal, payload: { ...cal.payload, points: "0:4 5" } }).length, 1, "a half-typed point");
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

// ── cables and instruments ───────────────────────────────────────────────

const elec = await import("../../lib/db/repos/electrical.mjs");
const inst = await import("../../lib/db/repos/instrumentation.mjs");
const SCHEDULE = "Cable No,From,To,Cable Type,Voltage,Length (m)\nEC-1203A-P,MCC-12,P-1203A,3Cx35 XLPE/SWA,0.6/1kV,85";
const INDEX = "Tag No,Service,Type,Range,Equipment\nPT-1203A,discharge pressure,Smart transmitter,0-25 bar,P-1203A\nPI-1203A,discharge local,Bourdon gauge,0-25 bar,P-1203A";
let cable, pt, pi, pack2;
const TX_OK = "0:4.00 6.25:8.01 12.5:12.00 18.75:15.99 25:20.00";
const GAUGE_OK = "0:0 6.25:6.3 12.5:12.5 18.75:18.7 25:25";

test("the pack carries each cable's and instrument's chain and what its test must meet", async () => {
  await withProject(db, P, async () => {
    await projects.updateProjectProfile(db, { projectId: P, patch: { lv_system_voltage_v: 400, calibration_tolerance_pct: 0.5 } });
    await elec.importCableSchedule(db, { projectId: P, text: SCHEDULE });
    await inst.importInstrumentIndex(db, { projectId: P, text: INDEX });
    pack2 = await fld.fieldPack(db, { projectId: P });
    cable = pack2.cables.find((c) => c.no === "EC-1203A-P");
    pt = pack2.instruments.find((i) => i.no === "PT-1203A");
    pi = pack2.instruments.find((i) => i.no === "PI-1203A");
    equal([cable.cores, cable.irRequirement.testV, cable.irRequirement.minMohm], [3, 500, 1]);
    assert(cable.steps.find((x) => x.code === "ir").derived, "IR is the test's to answer");
    equal([pt.calRequirement.tolerancePct, pt.calRequirement.output, pi.calRequirement.output], [0.5, "mA", "eu"]);
    equal(pack2.loops.map((l) => [l.loopNo, l.signed, l.members.length]), [[pt.loopNo, false, 2]]);
  });
});

test("the phone's provisional verdict is the server's, from the same engine and requirement", async () => {
  const phone = judgeIr({ testVoltageV: 500, readings: splitReadings("0.8 2000 >2000") }, { cores: cable.cores }, cable.irRequirement);
  equal([phone.valid, phone.ok], [true, false]);
  const bad = op("cable_ir", { cableId: cable.id, testVoltageV: 500, readings: "0.8 2000 >2000", testedOn: TODAY });
  const good = op("cable_ir", { cableId: cable.id, testVoltageV: 500, readings: "2000 >2000 1500", testedOn: TODAY }, 1);
  const r = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [bad, good] });
  equal(r.map((x) => [x.status, x.result.ok]), [["applied", false], ["applied", true]],
    "a failed test is a record too — the verdict says it failed");
  const calPhone = judgeCalibration(parseCalPoints(TX_OK), pt.calRequirement);
  const c = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC,
    ops: [op("instrument_cal", { instrumentId: pt.id, points: TX_OK, calibratedOn: TODAY, calibratorRef: "CAL-07" })] });
  equal([calPhone.ok, c[0].status, c[0].result.ok], [true, "applied", true]);
});

test("cable and instrument steps: recorded as at a desk, derived ones refused, the loop signed only when every member is ready", async () => {
  const steps = ["route", "pulled", "terminated", "continuity"].map((code, n) =>
    op("cable_step", { cableId: cable.id, code, doneOn: TODAY }, n));
  const irTick = op("cable_step", { cableId: cable.id, code: "ir", doneOn: TODAY }, 5);
  const calTick = op("instrument_step", { instrumentId: pt.id, code: "calibrated", doneOn: TODAY }, 6);
  const early = op("loop_check", { loopNo: pt.loopNo, checkedOn: TODAY, refNo: "LC-01" }, 7);
  let r = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [...steps, irTick, calTick, early] });
  equal(r.map((x) => x.status), ["applied", "applied", "applied", "applied", "rejected", "rejected", "rejected"]);
  assert(/IR/.test(r[4].error) && /کالیبراسیون/.test(r[5].error), r[4].error + " | " + r[5].error);
  assert(/هنوز آمادهٔ لوپ چک نیست/.test(r[6].error) && r[6].error.includes("PI-1203A"), r[6].error);
  const work = [];
  for (const i of [pt, pi]) for (const code of ["installed", "hookup", "wired"]) work.push(op("instrument_step", { instrumentId: i.id, code, doneOn: TODAY }, work.length));
  work.push(op("instrument_cal", { instrumentId: pi.id, points: GAUGE_OK, calibratedOn: TODAY }, work.length));
  const sign = op("loop_check", { loopNo: pt.loopNo, checkedOn: TODAY, refNo: "LC-01", witnessedBy: "Client" }, 30);
  r = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [...work, sign] });
  assert(r.every((x) => x.status === "applied"), JSON.stringify(r.filter((x) => x.status !== "applied")));
  const after = await withProject(db, P, () => fld.fieldPack(db, { projectId: P }));
  equal(after.loops[0].signed, true);
  equal(after.instruments.find((i) => i.no === "PT-1203A").steps.find((x) => x.code === "loop_check").status, "done",
    "every instrument of the loop takes its step from the one signature");
  equal(after.cables[0].steps.find((x) => x.code === "ir").status, "done", "the latest IR test passed");
});

// ── site photos on punch items ───────────────────────────────────────────

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const storeRoot = await mkdtemp(path.join(tmpdir(), "fld-store-"));
const store = createLocalStore({ root: storeRoot });
const photos = await import("../../lib/db/repos/punch-photos.mjs");

test("a photo is what its bytes say, not what it is called", async () => {
  equal([sniffImage(PNG), sniffImage(JPEG), sniffImage(WEBP)], ["image/png", "image/jpeg", "image/webp"]);
  equal([sniffImage(Buffer.from("<html><script>")), sniffImage(Buffer.from("RIFF\0\0\0\0WAVE")), sniffImage(PNG.subarray(0, 7)), sniffImage(null)],
    [null, null, null, null]);
  equal([sniffImage(Buffer.from([0xff, 0xd8, 0x00, 0xe0])), sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))], [null, null],
    "the whole signature, not its first bytes");
  equal(photoProblems({ bytes: PNG, stage: "raised", punchStatus: "open" }), []);
  equal(photoProblems({ bytes: PNG, stage: "cleared", punchStatus: "cleared" }), []);
  equal(photoProblems({ bytes: PNG, stage: "cleared", punchStatus: "open" }).length, 1, "a fix nobody has claimed");
  equal(photoProblems({ bytes: Buffer.alloc(0), stage: "raised" }).length, 1);
  equal(photoProblems({ bytes: Buffer.from("<html>"), stage: "raised" }).length, 1);
  equal(photoProblems({ bytes: PNG, stage: "later" }).length, 1);
  equal(photoProblems({ bytes: PNG, stage: "other", count: 19 }), []);
  equal(photoProblems({ bytes: PNG, stage: "other", count: 20 }).length, 1);
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_PHOTO_BYTES - PNG.length)]);
  equal(photoProblems({ bytes: big, stage: "other" }), [], "exactly the limit");
  assert(/MB/.test(photoProblems({ bytes: Buffer.concat([big, Buffer.alloc(1)]), stage: "other" })[0]));
  const ph = { ...base, kind: "punch_photo", payload: { punchId: "p", stage: "raised", takenOn: "2026-09-20" } };
  equal(opProblems(ph, { today: "2026-09-25" }), []);
  equal(opProblems({ ...ph, payload: { ...ph.payload, raiseOpId: ID } }).length, 1, "one item, not two");
  equal(opProblems({ ...ph, payload: { stage: "raised", takenOn: "2026-09-20" } }).length, 1, "no item");
  equal(opProblems({ ...ph, payload: { raiseOpId: "7", stage: "raised", takenOn: "2026-09-20" } }).length, 1);
  equal(opProblems({ ...ph, payload: { ...ph.payload, stage: "later" } }).length, 1);
  equal(opProblems({ ...ph, payload: { ...ph.payload, takenOn: "2026-09-26" } }, { today: "2026-09-25" }).length, 1);
});

test("a photo taken with a punch raised offline arrives with it; its bytes are kept once, outside the record", async () => {
  const raise = op("punch_raise", { tagId: pump.id, category: "B", description: "Coupling guard bolt loose", raisedOn: TODAY }, 40);
  const shot = op("punch_photo", { raiseOpId: raise.opId, stage: "raised", takenOn: TODAY, data: PNG.toString("base64") }, 41);
  const r = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [shot, raise], store });
  equal(r.map((x) => [x.opId, x.status]), [[raise.opId, "applied"], [shot.opId, "applied"]]);
  equal(r[1].result.punchId, r[0].result.punchId, "the item the raise became");
  const again = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC,
    ops: [{ ...op("punch_photo", { punchId: r[0].result.punchId, stage: "other", takenOn: TODAY, data: PNG.toString("base64") }) }], store });
  equal([again[0].status, again[0].result.duplicate, again[0].result.photoId], ["applied", true, r[1].result.photoId],
    "the same bytes on the same item are the one photo");
  await withProject(db, P, async () => {
    const { rows: [rec] } = await db.query("SELECT payload FROM field_op WHERE op_id = $1", [shot.opId]);
    equal([rec.payload.data, rec.payload.bytes, rec.payload.stage], [undefined, PNG.length, "raised"], "the record names the photo, it does not hold it");
    const list = await photos.listPhotos(db, { projectId: P, punchId: r[0].result.punchId });
    equal(list.map((f) => [f.stage, f.content_type, f.byte_size]), [["raised", "image/png", PNG.length]]);
    const back = await photos.readPhoto(db, { projectId: P, photoId: list[0].id, store });
    assert(back.bytes.equals(PNG), "the bytes come back as sent");
    const pack = await fld.fieldPack(db, { projectId: P });
    equal(pack.punch.find((x) => x.id === r[0].result.punchId).photos.map((f) => f.stage), ["raised"]);
    assert(pack.punch.filter((x) => x.id !== r[0].result.punchId).every((x) => x.photos.length === 0), "each item carries its own photos only");
    await throws(() => photos.readPhoto(db, { projectId: P, photoId: uuid(), store }), "not found");
    // Twenty photos is the most an item holds — counted by the repository, not trusted from the phone.
    for (let i = 1; i < 20; i++) {
      await photos.attachPhoto(db, { projectId: P, punchId: r[0].result.punchId, bytes: Buffer.concat([PNG, Buffer.from([i])]),
        stage: "other", takenOn: TODAY, store });
    }
    await throws(() => photos.attachPhoto(db, { projectId: P, punchId: r[0].result.punchId, bytes: Buffer.concat([PNG, Buffer.from([99])]),
      stage: "other", takenOn: TODAY, store }), "حداکثر");
    await throws(() => db.query("DELETE FROM punch_photo"), "permission denied");
    await throws(() => db.query("UPDATE punch_photo SET stage = 'other'"), "permission denied");
  });
});

test("a photo that is not a photo, of a fix not yet claimed, or of an item never recorded is refused; one ahead of its item waits", async () => {
  const { rows: [open] } = await withProject(db, P, () => db.query("SELECT id FROM punch_item WHERE status = 'open' ORDER BY punch_no LIMIT 1"));
  const html = op("punch_photo", { punchId: open.id, stage: "raised", takenOn: TODAY, data: Buffer.from("<html><script>alert(1)</script>").toString("base64") }, 50);
  const early = op("punch_photo", { punchId: open.id, stage: "cleared", takenOn: TODAY, data: JPEG.toString("base64") }, 51);
  const refusedRaise = op("punch_raise", { tagId: pump.id, category: "Z", description: "x", raisedOn: TODAY }, 52);
  const orphan = op("punch_photo", { raiseOpId: refusedRaise.opId, stage: "raised", takenOn: TODAY, data: JPEG.toString("base64") }, 53);
  const ahead = op("punch_photo", { raiseOpId: uuid(), stage: "raised", takenOn: TODAY, data: JPEG.toString("base64") }, 54);
  const empty = op("punch_photo", { punchId: open.id, stage: "raised", takenOn: TODAY }, 55);
  const notRaise = op("punch_photo", { raiseOpId: html.opId, stage: "raised", takenOn: TODAY, data: JPEG.toString("base64") }, 56);
  const r = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: QC, ops: [html, early, refusedRaise, orphan, ahead, empty, notRaise], store });
  equal(r.map((x) => x.status), ["rejected", "rejected", "rejected", "rejected", "retry", "rejected", "rejected"]);
  assert(/عکس/.test(r[0].error) && /رفع/.test(r[1].error) && /ثبت نشد/.test(r[3].error) && /نرسیده/.test(r[4].error), JSON.stringify(r));
  assert(/همراه/.test(r[5].error) && /غیر از ثبت Punch/.test(r[6].error), JSON.stringify(r));
  await withProject(db, P, async () => {
    equal((await db.query("SELECT count(*)::int AS n FROM field_op WHERE op_id = $1", [ahead.opId])).rows[0].n, 0, "not recorded: sent again next sync");
    equal((await db.query("SELECT count(*)::int AS n FROM punch_photo WHERE punch_id = $1", [open.id])).rows[0].n, 0);
    const { rows: [rec] } = await db.query("SELECT payload FROM field_op WHERE op_id = $1", [html.opId]);
    assert(rec.payload.data === undefined, "a refused photo's bytes are not kept either");
  });
  const viewer = await fld.applyOps(db, { projectId: P, userId: bob.id, membership: VIEWER,
    ops: [op("punch_photo", { punchId: open.id, stage: "raised", takenOn: TODAY, data: JPEG.toString("base64") })], store });
  assert(/اجازه/.test(viewer[0].error));
});

test("field operations belong to one project", async () => {
  await withProject(db, other.id, async () => {
    equal((await fld.recentOps(db, { projectId: other.id })).length, 0);
    equal((await db.query("SELECT count(*)::int AS n FROM punch_photo")).rows[0].n, 0, "no other project's photos");
  });
});

await run();
