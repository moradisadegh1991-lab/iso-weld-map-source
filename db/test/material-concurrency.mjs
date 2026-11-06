#!/usr/bin/env node
/**
 * Material lifecycle under real concurrency (audit 2026-11-03). Each invariant is proved by what is LEFT in the
 * tables, not by what a call returned.
 *
 *   PG_TEST_URL=postgres://user:pass@host:5432/emptydb  npm run db:test:pg
 *
 * PGlite is one connection and runs scoped blocks one at a time, so it cannot show any of this; without PG_TEST_URL
 * the file says SKIPPED and exits 0 — that is NOT a pass.
 */
import { test, run, assert, equal } from "./harness.mjs";

const URL = process.env.PG_TEST_URL;
if (!URL) { console.log("material-concurrency: SKIPPED — PG_TEST_URL is not set; nothing here ran against PostgreSQL."); process.exit(0); }
process.env.DATABASE_URL = URL;
const { createClient } = await import("../../lib/db/client.mjs");
const { migrate } = await import("../../lib/db/migrate.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const rs = await import("../../lib/db/repos/reserve.mjs");
const prc = await import("../../lib/db/repos/procurement.mjs");
const td = await import("../../lib/db/repos/tender.mjs");

const db = await createClient({ url: URL });
await migrate(db);
const alice = await projects.ensureUser(db, { subject: "kc|matconc" });
const P = (await projects.createProject(db, { code: "MC1", name: "A", ownerUserId: alice.id })).id;
const Q = (await projects.createProject(db, { code: "MC2", name: "B", ownerUserId: alice.id })).id;
const inP = (fn, p = P) => withProject(db, p, fn);
const verdicts = (promises) => Promise.all(promises.map((p) => p.then(() => "ok", (e) => (e?.status === 400 || /^23/.test(e?.code || "") ? "refused" : `ERROR:${e?.message}`))));
const num = async (sql, params = [], p = P) => inP(async () => Number((await db.query(sql, params)).rows[0].n), p);

const lotOf = (code, qty, p = P) => inP(async () => {
  const item = await wh.upsertItem(db, { projectId: p, code, description: code, category: "pipe", uom: "m", spec: "A106" });
  const lot = await wh.receiveLot(db, { projectId: p, itemId: item.id, receiptNo: `MRR-${code}`, receivedOn: "2026-09-01", heatNo: `H-${code}`, mtcRef: `M-${code}`, qtyReceived: qty });
  await wh.inspectLot(db, { projectId: p, lotId: lot.id, qtyAccepted: qty, qtyRejected: 0, mirRef: `MIR-${code}`, inspectedOn: "2026-09-02" });
  await wh.reviewMtc(db, { projectId: p, lotId: lot.id, mtcStatus: "accepted" });
  return { item, lot };
}, p);
const issue = (db2, lotId, qty, i = 0, p = P) => inP(() => wh.recordMovement(db2, { projectId: p, lotId, kind: "issue", qty, movedOn: "2026-09-10", refNo: `MIV-${i}`, purpose: "race" }), p);

test("B1. eight issues of 30 at once against a lot of 100: exactly three go, and the ledger never exceeds the lot", async () => {
  const { lot } = await lotOf("PIPE-B1", 100);
  const v = await verdicts(Array.from({ length: 8 }, (_, i) => issue(db, lot.id, 30, i)));
  equal(v.filter((x) => x === "ok").length, 3, JSON.stringify(v));
  assert(!v.some((x) => x.startsWith("ERROR")), JSON.stringify(v));
  equal(await num("SELECT coalesce(sum(qty),0) AS n FROM material_movement WHERE lot_id = $1 AND kind = 'issue'", [lot.id]), 90);
});

test("B2. six reservations of 40 at once against 100 free: exactly two, never more promised than there is", async () => {
  const { item } = await lotOf("PIPE-B2", 100);
  const v = await verdicts(Array.from({ length: 6 }, (_, i) => inP(() => rs.reserve(db, { projectId: P, itemId: item.id, qty: 40, purpose: `dest-${i}` }))));
  equal(v.filter((x) => x === "ok").length, 2, JSON.stringify(v));
  equal(await num("SELECT coalesce(sum(qty),0) AS n FROM material_reservation WHERE item_id = $1 AND released_at IS NULL", [item.id]), 80);
});

test("B2b. an issue and a reservation of the same stock at once never together exceed it", async () => {
  const { item, lot } = await lotOf("PIPE-B2B", 100);
  const v = await verdicts([issue(db, lot.id, 70, 1), inP(() => rs.reserve(db, { projectId: P, itemId: item.id, qty: 70, purpose: "other" }))]);
  assert(v.filter((x) => x === "ok").length <= 1, `an issue of 70 and a reservation of 70 on 100: ${JSON.stringify(v)}`);
});

let poLine;
const newPoLine = async (no, qty) => inP(async () => {
  const vendor = await prc.upsertVendor(db, { projectId: P, code: `v-${no}`, name: "V" });
  const po = await prc.createPo(db, { projectId: P, poNo: `po-${no}`, vendorId: vendor.id, title: "T", currency: "EUR", placedOn: "2026-08-01", userId: alice.id });
  const item = await wh.upsertItem(db, { projectId: P, code: `PO-${no}`, description: "x", category: "pipe", uom: "m" });
  return { po, line: await prc.addPoLine(db, { projectId: P, poId: po.id, itemId: item.id, qty }) };
});

test("B4. six receipts of 40 at once against a PO line of 100: exactly two, every lot linked to the line", async () => {
  poLine = await newPoLine("B4", 100);
  const v = await verdicts(Array.from({ length: 6 }, (_, i) => inP(() => prc.receiveAgainstPo(db, { projectId: P, poLineId: poLine.line.id, receiptNo: `MRR-B4-${i}`, receivedOn: "2026-09-05", qty: 40, heatNo: "H", mtcRef: "M" }))));
  equal(v.filter((x) => x === "ok").length, 2, JSON.stringify(v));
  equal(await num("SELECT coalesce(sum(qty_received),0) AS n FROM material_lot WHERE po_line_id = $1", [poLine.line.id]), 80);
  equal(await num("SELECT count(*) AS n FROM material_lot WHERE receipt_no LIKE 'MRR-B4-%' AND po_line_id IS NULL"), 0, "no lot without its line");
});

test("B5. six shipments of 40 at once against a PO line of 100: exactly two, each with its line", async () => {
  const { po, line } = await newPoLine("B5", 100);
  const v = await verdicts(Array.from({ length: 6 }, (_, i) => inP(() => prc.createShipment(db, { projectId: P, shipmentNo: `SH-B5-${i}`, poId: po.id, shippedOn: "2026-09-01", lines: [{ poLineId: line.id, qty: 40 }], userId: alice.id }))));
  equal(v.filter((x) => x === "ok").length, 2, JSON.stringify(v));
  equal(await num("SELECT coalesce(sum(qty),0) AS n FROM shipment_line WHERE po_line_id = $1", [line.id]), 80);
  equal(await num("SELECT count(*) AS n FROM shipment s WHERE s.po_id = $1 AND NOT EXISTS (SELECT 1 FROM shipment_line l WHERE l.shipment_id = s.id)", [po.id]), 0, "no shipment without lines");
});

/**
 * An issue that has read the lot as issuable and is held just before it writes (`gate`), while the MTC is rejected and the
 * rejection COMMITS: the issue must not then write. Lock-based, the issue holds the lot, so the rejection waits for it and
 * lands AFTER it (a late rejection, which the recall list is for); unprotected, the issue lands after the rejection.
 */
async function gated(lotId, act) {
  let open; const gate = new Promise((r) => { open = r; });
  const held = { ...db, query: async (sql, p) => { if (/INSERT INTO material_movement/.test(sql)) await gate; return db.query(sql, p); } };
  let issuedAt = null, actAt = null;
  const issuing = issue(held, lotId, 10, 1).then(() => { issuedAt = Date.now(); }, () => { issuedAt = "refused"; });
  await new Promise((r) => setTimeout(r, 150));              // the issue has read the lot and waits at its insert
  const acting = act().then(() => { actAt = Date.now(); }, () => { actAt = "refused"; });   // a refused correction is a right answer too
  await new Promise((r) => setTimeout(r, 300));              // unprotected: the rejection has already committed by now
  open();
  await Promise.all([issuing, acting]);
  return { issuedAt, actAt };
}

test("B6. an issue is never written after the MTC rejection that invalidates it has committed", async () => {
  const { lot } = await lotOf("PIPE-B6", 100);
  const { issuedAt, actAt } = await gated(lot.id, () => inP(() => wh.reviewMtc(db, { projectId: P, lotId: lot.id, mtcStatus: "rejected" })));
  assert(issuedAt === "refused" || actAt === "refused" || issuedAt <= actAt, "the issue was written after the rejection had committed");
  equal(await num("SELECT count(*) AS n FROM material_lot WHERE id = $1 AND mtc_status = 'rejected'", [lot.id]), 1);
  const after = await verdicts([issue(db, lot.id, 5, 2)]);
  equal(after[0], "refused", "and nothing new is issued once it is rejected");
});

test("B6b. an issue is never written after a MIR correction that leaves less accepted than it needs", async () => {
  const { lot } = await lotOf("PIPE-B6B", 100);
  await inP(() => issue(db, lot.id, 85, 0));       // 15 left; a correction to 12 accepted must refuse or wait
  const { issuedAt, actAt } = await gated(lot.id, () => inP(() => wh.inspectLot(db, { projectId: P, lotId: lot.id, qtyAccepted: 90, qtyRejected: 10, mirRef: "MIR-C", inspectedOn: "2026-09-03" })));
  const issued = await num("SELECT coalesce(sum(qty),0) AS n FROM material_movement WHERE lot_id = $1 AND kind = 'issue'", [lot.id]);
  const accepted = await num("SELECT qty_accepted AS n FROM material_lot WHERE id = $1", [lot.id]);
  assert(issued <= accepted, `issued ${issued} of an accepted ${accepted}`);
  assert(issuedAt === "refused" || actAt === "refused" || issuedAt <= actAt, "the issue was written after the correction had committed");
});

test("B8. four awards of one MR at once place exactly one PO with all its lines", async () => {
  const { mr, bid } = await inP(async () => {
    const item = await wh.upsertItem(db, { projectId: P, code: "PIPE-B8", description: "x", category: "pipe", uom: "m" });
    const mr = await td.createMr(db, { projectId: P, mrNo: "mr-b8", title: "B8", userId: alice.id });
    await td.addMrLine(db, { projectId: P, mrId: mr.id, itemId: item.id, qty: 10 });
    await td.addMrLine(db, { projectId: P, mrId: mr.id, itemId: item.id, qty: 5 });
    await td.issueMr(db, { projectId: P, mrId: mr.id, reason: "IFQ", userId: alice.id });
    const v = await prc.upsertVendor(db, { projectId: P, code: "v-b8", name: "V" });
    const bid = await td.recordBid(db, { projectId: P, mrId: mr.id, vendorId: v.id, receivedOn: "2026-09-01", validUntil: "2099-01-01", currency: "EUR", totalPrice: 100 });
    await td.evaluateBid(db, { projectId: P, bidId: bid.id, techStatus: "acceptable", userId: alice.id });
    return { mr, bid };
  });
  const v = await verdicts(Array.from({ length: 4 }, (_, i) => inP(() => td.awardMr(db, { projectId: P, mrId: mr.id, bidId: bid.id, poNo: `PO-B8-${i}`, placedOn: "2026-09-02", userId: alice.id }))));
  equal(v.filter((x) => x === "ok").length, 1, JSON.stringify(v));
  equal(await num("SELECT count(*) AS n FROM purchase_order WHERE mr_id = $1", [mr.id]), 1, "one PO for the MR");
  equal(await num("SELECT count(*) AS n FROM mr_award WHERE mr_id = $1", [mr.id]), 1, "one award record");
  equal(await num("SELECT count(*) AS n FROM po_line l JOIN purchase_order o ON o.id = l.po_id WHERE o.mr_id = $1", [mr.id]), 2, "its two lines");
});

test("B9. four submissions of one vendor document at once: exactly one is recorded", async () => {
  const { po } = await newPoLine("B9", 10);
  const doc = await inP(() => prc.addVendorDoc(db, { projectId: P, poId: po.id, docCode: "dwg-1", title: "GA drawing" }));
  const v = await verdicts(Array.from({ length: 4 }, (_, i) => inP(() => prc.submitDoc(db, { projectId: P, docId: doc.id, revision: `R${i}`, submittedOn: "2026-09-01", userId: alice.id }))));
  equal(v.filter((x) => x === "ok").length, 1, JSON.stringify(v));
  equal(await num("SELECT count(*) AS n FROM vendor_doc_submission WHERE doc_id = $1", [doc.id]), 1);
});

test("B9b. two reviews of one submission at once: exactly one code is recorded", async () => {
  const { po } = await newPoLine("B9B", 10);
  const doc = await inP(() => prc.addVendorDoc(db, { projectId: P, poId: po.id, docCode: "dwg-2", title: "x" }));
  await inP(() => prc.submitDoc(db, { projectId: P, docId: doc.id, revision: "R0", submittedOn: "2026-09-01", userId: alice.id }));
  const v = await verdicts([1, 3, 2, 4].map((code) => inP(() => prc.returnDoc(db, { projectId: P, docId: doc.id, returnedOn: "2026-09-05", code, comment: "c" }))));
  equal(v.filter((x) => x === "ok").length, 1, JSON.stringify(v));
});

test("B10. forecasts set at once leave the line with the latest one in its history", async () => {
  const { line } = await newPoLine("B10", 10);
  await Promise.all(Array.from({ length: 8 }, (_, i) => inP(() => prc.setForecast(db, { projectId: P, poLineId: line.id, forecastOn: `2026-1${i % 3}-0${i + 1}`, source: `s${i}`, userId: alice.id }))));
  const last = await inP(async () => (await db.query("SELECT forecast_on::text AS d FROM po_forecast WHERE po_line_id = $1 ORDER BY at DESC, id DESC LIMIT 1", [line.id])).rows[0].d);
  const now = await inP(async () => (await db.query("SELECT forecast_on::text AS d FROM po_line WHERE id = $1", [line.id])).rows[0].d);
  equal(now, last, "the line's date is the latest recorded");
});

test("B11. a shipment is never written after the FAT failure that withdraws its release has committed", async () => {
  const { po, line } = await inP(async () => {
    const vendor = await prc.upsertVendor(db, { projectId: P, code: "v-b11", name: "V" });
    const po = await prc.createPo(db, { projectId: P, poNo: "po-b11", vendorId: vendor.id, title: "T", currency: "EUR", placedOn: "2026-08-01", userId: alice.id });
    const item = await wh.upsertItem(db, { projectId: P, code: "PO-B11", description: "x", category: "pipe", uom: "m" });
    const line = await prc.addPoLine(db, { projectId: P, poId: po.id, itemId: item.id, qty: 10, fatRequired: true });
    await prc.recordFat(db, { projectId: P, poLineId: line.id, inspectedOn: "2026-09-01", result: "pass", irnNo: "IRN-1", userId: alice.id });
    return { po, line };
  });
  let open; const gate = new Promise((r) => { open = r; });
  const held = { ...db, query: async (sql, p2) => { if (/INSERT INTO shipment /.test(sql)) await gate; return db.query(sql, p2); } };
  let shippedAt = null, failedAt = null;
  const shipping = inP(() => prc.createShipment(held, { projectId: P, shipmentNo: "SH-B11", poId: po.id, shippedOn: "2026-09-02", lines: [{ poLineId: line.id, qty: 5 }], userId: alice.id })).then(() => { shippedAt = Date.now(); }, () => { shippedAt = "refused"; });
  await new Promise((r) => setTimeout(r, 150));
  const failing = inP(() => prc.recordFat(db, { projectId: P, poLineId: line.id, inspectedOn: "2026-09-03", result: "fail", note: "weld defects", userId: alice.id })).then(() => { failedAt = Date.now(); }, () => { failedAt = "refused"; });
  await new Promise((r) => setTimeout(r, 300));
  open();
  await Promise.all([shipping, failing]);
  assert(shippedAt === "refused" || failedAt === "refused" || shippedAt <= failedAt, "the shipment was written after the FAT failure had committed");
});

test("cross-project: another project cannot see, issue from, reserve, receive against or ship against this project's rows", async () => {
  const { lot, item } = await lotOf("PIPE-X", 100);
  const { po, line } = await newPoLine("X", 100);
  const refused = async (fn) => (await verdicts([inP(fn, Q)]))[0] !== "ok";
  assert(await refused(() => wh.recordMovement(db, { projectId: Q, lotId: lot.id, kind: "issue", qty: 1, movedOn: "2026-09-10", purpose: "x" })), "issue");
  assert(await refused(() => rs.reserve(db, { projectId: Q, itemId: item.id, qty: 1, purpose: "x" })), "reserve");
  assert(await refused(() => prc.receiveAgainstPo(db, { projectId: Q, poLineId: line.id, receiptNo: "X", receivedOn: "2026-09-05", qty: 1 })), "receive");
  assert(await refused(() => prc.createShipment(db, { projectId: Q, shipmentNo: "SX", poId: po.id, shippedOn: "2026-09-01", lines: [{ poLineId: line.id, qty: 1 }] })), "ship");
  equal(await num("SELECT count(*) AS n FROM material_movement WHERE lot_id = $1", [lot.id]), 0);
});

test("B12. the same offline override sent twice at once: one step, one audit event (Phase 2d)", async () => {
  const px = await import("../../lib/db/repos/piping-execution.mjs");
  const fld = await import("../../lib/db/repos/field.mjs");
  const runs = await import("../../lib/db/repos/runs.mjs");
  const { DEMO } = await import("../../lib/demo.js");
  const spool = await inP(async () => {
    const { rows: [doc] } = await db.query(`INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-B12','0',$2,'local://b') RETURNING id`, [P, "d".repeat(64)]);
    const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: null, payload: DEMO });
    const { rows: [sp] } = await db.query("INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,'SP-B12') RETURNING id", [P, r.id]);
    await db.query("INSERT INTO spool_material (project_id, spool_id, kind, qty, uom, stock_code) VALUES ($1,$2,'pipe',5,'m','PIPE-B12')", [P, sp.id]);
    await wh.upsertItem(db, { projectId: P, code: "PIPE-B12", description: "x", category: "pipe", uom: "m" });
    return sp;
  });
  const op = { opId: globalThis.crypto.randomUUID(), kind: "spool_step", projectId: P, capturedAt: new Date().toISOString(),
    payload: { spoolId: spool.id, code: "fit_up", doneOn: "2026-09-10", materialOverride: "yard stock" } };
  const send = () => fld.applyOps(db, { projectId: P, userId: alice.id, membership: { role: "engineer", areas: [] }, ops: [op] });
  const out = (await Promise.all(Array.from({ length: 5 }, send))).flat();
  assert(out.every((r) => r.status === "applied"), JSON.stringify(out.map((r) => r.status)));
  equal(out.filter((r) => !r.duplicate).length, 1, "exactly one copy did the work");
  equal(await num("SELECT count(*) AS n FROM material_override WHERE spool_id = $1", [spool.id]), 1);
  equal(await num("SELECT count(*) AS n FROM spool_activity WHERE spool_id = $1 AND code = 'fit_up'", [spool.id]), 1);
  // the application role can neither change nor remove an event
  for (const sql of ["UPDATE material_override SET reason = 'x' WHERE spool_id = $1", "DELETE FROM material_override WHERE spool_id = $1"]) {
    const v = await verdicts([inP(() => db.query(sql, [spool.id]))]);
    assert(v[0] !== "ok", sql);
  }
  equal(await num("SELECT count(*) AS n FROM material_override WHERE spool_id = $1", [spool.id]), 1);
  void px;
});

await run();
await db.close();
