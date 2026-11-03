#!/usr/bin/env node
/**
 * Material lifecycle (audit 2026-11-03): units that must be all-or-nothing, and the ledger's invariants.
 *
 * A multi-statement operation that fails half way must leave nothing: a spool's reservations, a shipment with its
 * lines, a received lot with its link to the PO line. The failure is injected at the Nth matching statement
 * (`failOn`), so these are deterministic — and run on PGlite and on PostgreSQL alike (the races are in
 * material-concurrency.mjs, which needs a real server).
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { DEMO } from "../../lib/demo.js";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("mat-atomic-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const spm = await import("../../lib/db/repos/spool-material.mjs");
const prc = await import("../../lib/db/repos/procurement.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const P = (await projects.createProject(db, { code: "MAT", name: "M", ownerUserId: alice.id })).id;
const inP = (fn) => withProject(db, P, fn);
const count = async (sql, params = []) => inP(async () => Number((await db.query(sql, params)).rows[0].n));

/** The same db, but the Nth statement matching `re` fails (what the statement before it did must not survive). */
const failOn = (re, nth = 1) => {
  let seen = 0;
  return { ...db, query: async (sql, params) => { if (re.test(sql) && ++seen === nth) throw Object.assign(new Error("injected failure"), { injected: true }); return db.query(sql, params); } };
};

const accepted = async (code, category, uom, qty) => inP(async () => {
  const item = await wh.upsertItem(db, { projectId: P, code, description: code, category, uom });
  const lot = await wh.receiveLot(db, { projectId: P, itemId: item.id, receiptNo: `MRR-${code}`, receivedOn: "2026-09-01", qtyReceived: qty, heatNo: `H-${code}`, mtcRef: `M-${code}` });
  await wh.inspectLot(db, { projectId: P, lotId: lot.id, qtyAccepted: qty, inspectedOn: "2026-09-02" });
  await wh.reviewMtc(db, { projectId: P, lotId: lot.id, mtcStatus: "accepted" });
  return { item, lot };
});

let spool;
await inP(async () => {
  const { rows: [doc] } = await db.query(`INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-A','0',$2,'local://a') RETURNING id`, [P, "a".repeat(64)]);
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: null, payload: DEMO });
  ({ rows: [spool] } = await db.query("INSERT INTO spool (project_id, extraction_run_id, spool_no) VALUES ($1,$2,'SP-A') RETURNING id", [P, r.id]));
  for (const [kind, code, qty, uom] of [["pipe", "PIPE-A", 5, "m"], ["fitting", "ELB-A", 2, "EA"], ["fitting", "TEE-A", 1, "EA"]])
    await db.query("INSERT INTO spool_material (project_id, spool_id, kind, qty, uom, stock_code) VALUES ($1,$2,$3,$4,$5,$6)", [P, spool.id, kind, qty, uom, code]);
});
await accepted("PIPE-A", "pipe", "m", 50); await accepted("ELB-A", "fitting", "EA", 10); await accepted("TEE-A", "fitting", "EA", 10);

test("a spool's material is reserved all or nothing: a failure on the last line leaves no reservation on the first", async () => {
  const e = await throws(() => spm.reserveSpoolMaterial(failOn(/INSERT INTO material_reservation/, 3), { projectId: P, spoolId: spool.id, userId: alice.id }), "injected failure");
  assert(e.injected);
  equal(await count("SELECT count(*) AS n FROM material_reservation"), 0, "no reservation survives a failed reserve of the whole spool");
  const ok = await inP(() => spm.reserveSpoolMaterial(db, { projectId: P, spoolId: spool.id, userId: alice.id }));
  equal(ok.reserved, 3, "and the same call without the failure reserves all three");
});

let poLines;
await inP(async () => {
  const vendor = await prc.upsertVendor(db, { projectId: P, code: "v-1", name: "V" });
  const po = await prc.createPo(db, { projectId: P, poNo: "po-1", vendorId: vendor.id, title: "T", currency: "EUR", placedOn: "2026-08-01", userId: alice.id });
  const a = await wh.upsertItem(db, { projectId: P, code: "PO-A", description: "A", category: "pipe", uom: "m" });
  const b = await wh.upsertItem(db, { projectId: P, code: "PO-B", description: "B", category: "pipe", uom: "m" });
  poLines = { po, l1: await prc.addPoLine(db, { projectId: P, poId: po.id, itemId: a.id, qty: 100 }), l2: await prc.addPoLine(db, { projectId: P, poId: po.id, itemId: b.id, qty: 100 }) };
});

test("a shipment is its header and all its lines, or nothing", async () => {
  await throws(() => inP(() => prc.createShipment(failOn(/INSERT INTO shipment_line/, 2), { projectId: P, shipmentNo: "SH-1", poId: poLines.po.id, shippedOn: "2026-09-01",
    lines: [{ poLineId: poLines.l1.id, qty: 10 }, { poLineId: poLines.l2.id, qty: 10 }], userId: alice.id })), "injected failure");
  equal(await count("SELECT count(*) AS n FROM shipment"), 0, "no shipment header without its lines");
  equal(await count("SELECT count(*) AS n FROM shipment_line"), 0);
});

test("a receipt against a PO is the lot and its link to the line, or nothing", async () => {
  await throws(() => inP(() => prc.receiveAgainstPo(failOn(/UPDATE material_lot SET po_line_id/), { projectId: P, poLineId: poLines.l1.id, receiptNo: "MRR-PO-1", receivedOn: "2026-09-05", qty: 10, heatNo: "H", mtcRef: "M" })), "injected failure");
  equal(await count("SELECT count(*) AS n FROM material_lot WHERE receipt_no = 'MRR-PO-1'"), 0, "no lot left unlinked to the line it came against");
});

await run();
