#!/usr/bin/env node
/**
 * Procurement: float against the site's need, no shipment without an
 * inspection release, no FAT before the documents it waits for, receipt
 * only against the PO line and never beyond it, and a VDRL that knows
 * overdue from awaiting.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  lineDates, lineStage, fatProblems, shipProblems, receiveProblems, docState, onOrder,
} from "../../lib/procurement/procurement.mjs";

// ── the engine ───────────────────────────────────────────────────────────

test("slip against the promise, float against the need — and no need date is unknown float", async () => {
  const d = lineDates({ promisedOn: "2026-10-01", forecastOn: "2026-10-20", needOn: "2026-10-10" }, "2026-09-25");
  equal([d.slipDays, d.floatDays, d.forecastIsPromise, d.overdue], [19, -10, false, false]);
  const p = lineDates({ promisedOn: "2026-10-01", forecastOn: null, needOn: "2026-11-01" }, "2026-10-05");
  equal([p.forecast, p.forecastIsPromise, p.slipDays, p.floatDays, p.overdue], ["2026-10-01", true, null, 31, true]);
  equal(lineDates({ promisedOn: "2026-10-01" }, "2026-09-01").floatDays, null);
});

test("a line's stage follows what happened to it, and FAT holds a line until released", async () => {
  equal(lineStage({ qty: 1, fatRequired: true, fat: null }), "ordered");
  equal(lineStage({ qty: 1, fatRequired: true, fat: { result: "fail" } }), "fat_pending");
  equal(lineStage({ qty: 1, fatRequired: true, fat: { result: "pass", irnNo: "IRN-1" } }), "released");
  equal(lineStage({ qty: 1, fatRequired: true, fat: { result: "pass", irnNo: " " } }), "fat_pending", "no IRN, no release");
  equal(lineStage({ qty: 10, shippedQty: 4 }), "partly_shipped");
  equal(lineStage({ qty: 10, shippedQty: 10, receivedQty: 3 }), "partly_received");
  equal(lineStage({ qty: 10, shippedQty: 10, receivedQty: 10 }), "received");
});

test("FAT: a release needs an IRN, a waiver and a failure need a reason, and documents come first", async () => {
  equal(fatProblems({ result: "pass", irnNo: "IRN-7" }), []);
  equal(fatProblems({ result: "pass" }).length, 1);
  equal(fatProblems({ result: "waived", irnNo: "IRN-8" }).length, 1);
  equal(fatProblems({ result: "fail" }).length, 1);
  equal(fatProblems({ result: "pass", irnNo: "IRN-7" }, { docsBeforeFat: [{ docCode: "ITP", code: 3 }, { docCode: "DS", code: 2 }] }).length, 1);
  equal(fatProblems({ result: "fail", note: "vibration" }, { docsBeforeFat: [{ docCode: "ITP", code: null }] }), [],
    "a failure can always be recorded");
});

test("shipping and receiving never exceed the order, and a receipt matches item and unit", async () => {
  const line = { qty: 10, uom: "m", itemId: "I1", shippedQty: 6, receivedQty: 6, fatRequired: false };
  equal(shipProblems(line, 4), []);
  equal(shipProblems(line, 4.5).length, 1);
  equal(shipProblems({ ...line, fatRequired: true, fat: null }, 1).length, 1);
  equal(receiveProblems(line, { qty: 4 }), []);
  equal(receiveProblems(line, { qty: 5 }).length, 1);
  equal(receiveProblems(line, { qty: 1, uom: "ft" }).length, 1);
  equal(receiveProblems(line, { qty: 1, itemId: "I2" }).length, 1);
  equal(receiveProblems({ ...line, itemId: null, tagId: "T" }, { qty: 1 }).length, 1, "a pump is not a warehouse lot");
});

test("VDRL: overdue, under review, resubmit — overdue only against a stated period", async () => {
  const t = "2026-09-25";
  equal(docState({ dueOn: "2026-09-20" }, t, 14), { state: "overdue", daysLate: 5 });
  equal(docState({ dueOn: "2026-09-30" }, t, 14).state, "pending");
  equal(docState({ dueOn: "2026-09-01", lastSubmittedOn: "2026-09-02" }, t, 14).state, "under_review");
  equal(docState({ lastSubmittedOn: "2026-08-01", lastCode: 3, lastReturnedOn: "2026-09-01" }, t, 14), { state: "resubmit_overdue", daysLate: 10 });
  equal(docState({ lastSubmittedOn: "2026-08-01", lastCode: 3, lastReturnedOn: "2026-09-01" }, t, null).state, "resubmit");
  equal(docState({ lastSubmittedOn: "2026-08-01", lastCode: 3, lastReturnedOn: "2026-09-11" }, t, 14).state, "resubmit",
    "on the last day of the period it is not yet late");
  equal(docState({ lastSubmittedOn: "2026-08-01", lastCode: 2, lastReturnedOn: "2026-08-10" }, t, 14).state, "accepted");
});

test("on order: open quantity and the earliest date still coming", async () => {
  equal(onOrder([{ qty: 100, receivedQty: 40, forecastOn: "2026-11-01" }, { qty: 50, receivedQty: 50, forecastOn: "2026-10-01" },
    { qty: 20, receivedQty: 0, promisedOn: "2026-10-15" }]), { qty: 80, nextOn: "2026-10-15", lines: 2 });
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "prc-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const prc = await import("../../lib/db/repos/procurement.mjs");
const { missingInformation } = await import("../../lib/db/repos/assumptions.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "PRC", name: "P", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "PRC2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const TODAY = new Date().toISOString().slice(0, 10);
const shift = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let pipe, pump, vendor, po, lPipe, lPump, docITP;

await withProject(db, P, async () => {
  pipe = await wh.upsertItem(db, { projectId: P, code: "P-CS-8-40", description: "Pipe 8\" SCH40 A106B", category: "pipe", uom: "m" });
  await wh.setRequirement(db, { projectId: P, itemId: pipe.id, qty: 300, source: "MTO rev 2" });
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203A", discipline: "equipment", kind: "rotating" });
  vendor = await prc.upsertVendor(db, { projectId: P, code: "v-ksb", name: "Pump Vendor GmbH", country: "DE" });
});

test("a PO line buys an item or a tag, in the item's own unit", async () => {
  await withProject(db, P, async () => {
    po = await prc.createPo(db, { projectId: P, poNo: "po-1001", vendorId: vendor.id, title: "Pumps and pipe", currency: "EUR", placedOn: shift(-60), userId: alice.id });
    await throws(() => prc.addPoLine(db, { projectId: P, poId: po.id, qty: 1 }), "INVALID_INPUT", "neither");
    await throws(() => prc.addPoLine(db, { projectId: P, poId: po.id, itemId: pipe.id, tagId: pump.id, qty: 1 }), "INVALID_INPUT", "both");
    await throws(() => prc.addPoLine(db, { projectId: P, poId: po.id, itemId: pipe.id, qty: 100, uom: "ft" }), "INVALID_INPUT");
    lPipe = await prc.addPoLine(db, { projectId: P, poId: po.id, itemId: pipe.id, qty: 200, promisedOn: shift(-5), needOn: shift(20) });
    lPump = await prc.addPoLine(db, { projectId: P, poId: po.id, tagId: pump.id, qty: 1, promisedOn: shift(10), needOn: shift(15), fatRequired: true });
    equal([lPipe.line_no, lPipe.uom, lPump.line_no, lPump.uom], [1, "m", 2, "EA"]);
    await throws(() => db.query("INSERT INTO po_line (project_id, po_id, line_no, qty, uom) VALUES ($1,$2,9,1,'EA')", [P, po.id]),
      "po_line_item_xor_tag");
  });
});

test("expediting forecasts are kept, and the list puts the line construction waits for first", async () => {
  await withProject(db, P, async () => {
    await throws(() => prc.setForecast(db, { projectId: P, poLineId: lPump.id, forecastOn: shift(25) }), "INVALID_INPUT", "a source");
    await prc.setForecast(db, { projectId: P, poLineId: lPump.id, forecastOn: shift(18), source: "Vendor progress report #6", userId: alice.id });
    await prc.setForecast(db, { projectId: P, poLineId: lPump.id, forecastOn: shift(25), source: "Casting rejected — visit", userId: alice.id });
    equal((await prc.forecastHistory(db, { projectId: P, poLineId: lPump.id })).map((f) => f.source.slice(0, 6)), ["Vendor", "Castin"]);
    const b = await prc.procurementBoard(db, { projectId: P });
    equal(b.expediting.map((l) => [l.lineNo, l.floatDays, l.slipDays]), [[2, -10, 15], [1, 25, null]]);
    equal(b.expediting[1].forecastIsPromise, true, "the pipe line has only its promise");
    await throws(() => db.query("UPDATE po_forecast SET source = 'x'"), "permission denied");
  });
});

test("FAT waits for the documents marked before it, and shipping waits for the release", async () => {
  await withProject(db, P, async () => {
    docITP = await prc.addVendorDoc(db, { projectId: P, poId: po.id, docCode: "itp", title: "Inspection and test plan", dueOn: shift(-30), beforeFat: true });
    await prc.addVendorDoc(db, { projectId: P, poId: po.id, docCode: "IOM", title: "Operation and maintenance manual", dueOn: shift(30) });
    await throws(() => prc.createShipment(db, { projectId: P, shipmentNo: "PL-1", poId: po.id, shippedOn: TODAY,
      lines: [{ poLineId: lPump.id, qty: 1 }] }), "INVALID_INPUT", "no release yet");
    await throws(() => prc.recordFat(db, { projectId: P, poLineId: lPump.id, inspectedOn: TODAY, result: "pass", irnNo: "IRN-01" }),
      "INVALID_INPUT", "the ITP is not approved");
    const noFat = await throws(() => prc.recordFat(db, { projectId: P, poLineId: lPipe.id, inspectedOn: TODAY, result: "pass", irnNo: "x" }),
      "INVALID_INPUT", "the pipe line has no FAT");
    assert(/بازرسی کارخانه ندارد/.test(noFat.message), noFat.message);
    const s1 = await prc.submitDoc(db, { projectId: P, docId: docITP.id, revision: "A", submittedOn: shift(-20), userId: alice.id });
    const busy = await throws(() => prc.submitDoc(db, { projectId: P, docId: docITP.id, revision: "B", submittedOn: shift(-19) }), "INVALID_INPUT");
    assert(/در بررسی/.test(busy.message), "refused because it is under review, not for another reason");
    await throws(() => prc.returnDoc(db, { projectId: P, docId: docITP.id, returnedOn: shift(-15), code: 3 }), "INVALID_INPUT", "code 3 needs a comment");
    await prc.returnDoc(db, { projectId: P, docId: docITP.id, returnedOn: shift(-15), code: 3, comment: "Add NPSH test" });
    let docs = await prc.vendorDocs(db, { projectId: P, poId: po.id });
    equal(docs.find((d) => d.doc_code === "ITP").state, "resubmit", "no resubmission period stated");
    assert((await missingInformation(db, { projectId: P })).some((m) => m.key === "vdrl-resubmit"));
    await projects.updateProjectProfile(db, { projectId: P, patch: { vdrl_resubmit_days: 10 } });
    docs = await prc.vendorDocs(db, { projectId: P, poId: po.id });
    equal(docs.find((d) => d.doc_code === "ITP").state, "resubmit_overdue");
    await prc.submitDoc(db, { projectId: P, docId: docITP.id, revision: "B", submittedOn: shift(-3) });
    await prc.returnDoc(db, { projectId: P, docId: docITP.id, returnedOn: shift(-1), code: 2, comment: "OK" });
    await throws(() => prc.submitDoc(db, { projectId: P, docId: docITP.id, revision: "C", submittedOn: TODAY }), "INVALID_INPUT", "accepted");
    assert(s1.id);
    await prc.recordFat(db, { projectId: P, poLineId: lPump.id, inspectedOn: TODAY, result: "fail", note: "Vibration 7.1 mm/s", userId: alice.id });
    await throws(() => prc.createShipment(db, { projectId: P, shipmentNo: "PL-1", poId: po.id, shippedOn: TODAY,
      lines: [{ poLineId: lPump.id, qty: 1 }] }), "INVALID_INPUT", "a failed FAT is not a release");
    await prc.recordFat(db, { projectId: P, poLineId: lPump.id, inspectedOn: TODAY, result: "pass", irnNo: "IRN-0042", inspector: "TPI", userId: alice.id });
    const s = await prc.createShipment(db, { projectId: P, shipmentNo: "pl-1", poId: po.id, shippedOn: TODAY, etaOn: shift(12),
      lines: [{ poLineId: lPump.id, qty: 1 }, { poLineId: lPipe.id, qty: 120 }] });
    equal(s.shipment_no, "PL-1");
    await throws(() => prc.createShipment(db, { projectId: P, shipmentNo: "PL-2", poId: po.id, shippedOn: TODAY,
      lines: [{ poLineId: lPipe.id, qty: 100 }] }), "INVALID_INPUT", "120 + 100 > 200");
    await throws(() => db.query("DELETE FROM fat_record"), "permission denied");
  });
});

test("receipt goes into the warehouse against the line, and never beyond it", async () => {
  await withProject(db, P, async () => {
    const lot = await prc.receiveAgainstPo(db, { projectId: P, poLineId: lPipe.id, receiptNo: "MRR-501", receivedOn: TODAY,
      qty: 120, heatNo: "H-7781", mtcRef: "MTC-7781", userId: alice.id });
    equal([lot.po_line_id, lot.po_ref, lot.supplier], [lPipe.id, "PO-1001", "Pump Vendor GmbH"]);
    await throws(() => prc.receiveAgainstPo(db, { projectId: P, poLineId: lPipe.id, receiptNo: "MRR-502", receivedOn: TODAY, qty: 81 }),
      "INVALID_INPUT", "201 of 200");
    await throws(() => prc.receiveAgainstPo(db, { projectId: P, poLineId: lPump.id, receiptNo: "MRR-503", receivedOn: TODAY, qty: 1 }),
      "INVALID_INPUT", "a pump arrives by its shipment");
    const st = await prc.lineStatus(db, { projectId: P, poLineId: lPipe.id });
    equal([st.receivedQty, st.stage], [120, "partly_received"]);
    const short = (await wh.shortages(db, { projectId: P })).find((x) => x.code === "P-CS-8-40");
    equal([short.required, short.shortfall, short.onOrder.qty, short.onOrder.lines], [300, 300, 80, 1],
      "the 120 m is on hand but held (no MIR yet); 80 m more is on order");
  });
});

test("a tagged item is received when its shipment arrives", async () => {
  await withProject(db, P, async () => {
    const { rows: [s] } = await db.query("SELECT id FROM shipment WHERE shipment_no = 'PL-1'");
    await throws(() => prc.arriveShipment(db, { projectId: P, shipmentId: s.id, arrivedOn: shift(-1) }), "shipment_arrives_after_leaving");
    await prc.arriveShipment(db, { projectId: P, shipmentId: s.id, arrivedOn: shift(1) });
    const st = await prc.lineStatus(db, { projectId: P, poLineId: lPump.id });
    equal([st.receivedQty, st.stage], [1, "received"]);
    await throws(() => prc.arriveShipment(db, { projectId: P, shipmentId: s.id, arrivedOn: shift(2) }), "INVALID_INPUT");
  });
});

test("procurement belongs to one project", async () => {
  await withProject(db, other.id, async () => {
    const b = await prc.procurementBoard(db, { projectId: other.id });
    equal([b.orders.length, b.vendors.length], [0, 0]);
  });
});

await run();
