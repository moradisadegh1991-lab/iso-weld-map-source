#!/usr/bin/env node
/**
 * Receipt against shipment (audit 2026-11-03, Phase 2 finding C2): a PO line is shipped in parts and received in parts.
 * Once shipments are recorded for a line, what is received cannot exceed what was shipped; a line with no shipment
 * recorded (collected by the site, bought locally) is received against the order alone, as before.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("rcpt-ship-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const prc = await import("../../lib/db/repos/procurement.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const P = (await projects.createProject(db, { code: "RS", name: "R", ownerUserId: alice.id })).id;
const inP = (fn) => withProject(db, P, fn);
let po, shipped, bought;

await inP(async () => {
  const vendor = await prc.upsertVendor(db, { projectId: P, code: "v-1", name: "V" });
  po = await prc.createPo(db, { projectId: P, poNo: "po-1", vendorId: vendor.id, title: "T", currency: "EUR", placedOn: "2026-08-01", userId: alice.id });
  const a = await wh.upsertItem(db, { projectId: P, code: "RS-A", description: "A", category: "pipe", uom: "m" });
  const b = await wh.upsertItem(db, { projectId: P, code: "RS-B", description: "B", category: "pipe", uom: "m" });
  shipped = await prc.addPoLine(db, { projectId: P, poId: po.id, itemId: a.id, qty: 100 });
  bought = await prc.addPoLine(db, { projectId: P, poId: po.id, itemId: b.id, qty: 100 });
});
const receive = (line, qty, n) => inP(() => prc.receiveAgainstPo(db, { projectId: P, poLineId: line.id, receiptNo: `MRR-${n}`, receivedOn: "2026-09-05", qty, heatNo: "H", mtcRef: "M" }));

test("a line shipped in part is received only up to what was shipped", async () => {
  await inP(() => prc.createShipment(db, { projectId: P, shipmentNo: "SH-1", poId: po.id, shippedOn: "2026-09-01", lines: [{ poLineId: shipped.id, qty: 30 }], userId: alice.id }));
  const e = await throws(() => receive(shipped, 40, 1), "INVALID_INPUT", "40 received of 30 shipped");
  assert(/حمل/.test(e.message), e.message);
  await receive(shipped, 30, 2);
  await throws(() => receive(shipped, 1, 3), "INVALID_INPUT", "everything shipped is received");
});

test("a second shipment opens the rest; the order is still the ceiling", async () => {
  await inP(() => prc.createShipment(db, { projectId: P, shipmentNo: "SH-2", poId: po.id, shippedOn: "2026-09-10", lines: [{ poLineId: shipped.id, qty: 70 }], userId: alice.id }));
  await receive(shipped, 70, 4);
  await throws(() => receive(shipped, 1, 5), "INVALID_INPUT", "100 of 100");
});

test("a line with no shipment recorded is received against the order alone (as before)", async () => {
  await receive(bought, 60, 6);
  await receive(bought, 40, 7);
  await throws(() => receive(bought, 1, 8), "INVALID_INPUT", "over the order");
});

await run();
