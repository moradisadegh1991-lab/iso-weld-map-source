#!/usr/bin/env node
/**
 * The material lifecycle end to end, on the real repositories and schema (audit 2026-11-03, C5): an isometric's register
 * → the spool's material → MTO → MR → bid → award → PO → partial shipment → partial receipt → MIR → MTC → reservation →
 * issue → return → stock, reservation and spool state → a late MTC rejection and its recall → another project sees none.
 * Each step is checked in the tables, with the arithmetic done here, not read back from the code under test.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("mat-life-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const spm = await import("../../lib/db/repos/spool-material.mjs");
const rsv = await import("../../lib/db/repos/reserve.mjs");
const prc = await import("../../lib/db/repos/procurement.mjs");
const td = await import("../../lib/db/repos/tender.mjs");
const wf = await import("../../lib/db/repos/workfront.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const P = (await projects.createProject(db, { code: "LIFE", name: "Lifecycle", ownerUserId: alice.id })).id;
const Q = (await projects.createProject(db, { code: "LIFE2", name: "Other", ownerUserId: alice.id })).id;
const inP = (fn) => withProject(db, P, fn);
const one = async (sql, params = []) => inP(async () => (await db.query(sql, params)).rows[0]);
const TODAY = "2026-09-20";
const r3 = (x) => Math.round(x * 1000) / 1000;      // the ledger keeps three decimals; so does the arithmetic here

const PIPE = "PC06TSS00AB", E90 = "AC03C95J0AB", E45 = "AC03C45J0AB";
const S = {};                                  // what the scenario carries between steps

test("1-2. the isometric's register writes each spool's material in stock codes; the codes become items", async () => {
  await inP(async () => {
    const { rows: [line] } = await db.query("INSERT INTO line (project_id, line_no) VALUES ($1,'36-CW-1') RETURNING id", [P]);
    const { rows: [doc] } = await db.query(`INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`, [P, "c".repeat(64)]);
    const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: line.id, payload: DEMO });
    await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: line.id, model: buildModel(DEMO, {}) });
    S.spools = (await db.query("SELECT id, spool_no FROM spool WHERE project_id = $1 ORDER BY spool_no", [P])).rows;
    assert(S.spools.length >= 2, "the sheet has spools");
    const m = await spm.spoolMaterial(db, { projectId: P, spoolId: S.spools[0].id });
    assert(m.lines.length >= 2 && m.lines.every((l) => l.state === "no_item"), "before the codes are items, nothing can be reserved");
    S.items = {};
    for (const [code, category, uom] of [[PIPE, "pipe", "m"], [E90, "fitting", "EA"], [E45, "fitting", "EA"]])
      S.items[code] = await wh.upsertItem(db, { projectId: P, code, description: code, category, uom });
    S.need = {};     // what the spools need, summed here from the table
    for (const sp of S.spools) for (const l of (await spm.spoolMaterial(db, { projectId: P, spoolId: sp.id })).lines)
      if (l.itemId) { S.need[l.stockCode] = r3((S.need[l.stockCode] || 0) + l.qty); }
    S.sp1 = (await spm.spoolMaterial(db, { projectId: P, spoolId: S.spools[0].id })).lines.filter((l) => l.itemId);
    assert(S.sp1.length >= 2 && Object.keys(S.need).length >= 2);
  });
});

test("3. the MTO is the requirement; a later revision replaces the earlier, it does not add", async () => {
  await inP(async () => {
    const code = Object.keys(S.need)[0], item = S.items[code];
    await wh.setRequirement(db, { projectId: P, itemId: item.id, qty: 10, source: "Piping MTO rev 0" });
    await wh.setRequirement(db, { projectId: P, itemId: item.id, qty: r3(S.need[code] + 4), source: "Piping MTO rev 1" });
    const row = (await wh.shortages(db, { projectId: P })).find((x) => x.itemId === item.id);
    equal(row.required, r3(S.need[code] + 4));
    assert(row.supersededSources.some((x) => /rev 0/.test(x)));
    for (const c of Object.keys(S.need)) if (c !== code) await wh.setRequirement(db, { projectId: P, itemId: S.items[c].id, qty: r3(S.need[c] + 4), source: "Piping MTO rev 1" });
  });
});

test("4-5. MR → bid → award places the PO from the issued lines", async () => {
  await inP(async () => {
    const mr = await td.createMr(db, { projectId: P, mrNo: "mr-1", title: "Spool material", userId: alice.id });
    for (const c of Object.keys(S.need)) await td.addMrLine(db, { projectId: P, mrId: mr.id, itemId: S.items[c].id, qty: r3(S.need[c] + 4) });
    await td.issueMr(db, { projectId: P, mrId: mr.id, reason: "IFQ", userId: alice.id });
    const v = await prc.upsertVendor(db, { projectId: P, code: "v-life", name: "Vendor" });
    const bid = await td.recordBid(db, { projectId: P, mrId: mr.id, vendorId: v.id, receivedOn: TODAY, validUntil: "2099-01-01", currency: "EUR", totalPrice: 5000 });
    await td.evaluateBid(db, { projectId: P, bidId: bid.id, techStatus: "acceptable", userId: alice.id });
    const aw = await td.awardMr(db, { projectId: P, mrId: mr.id, bidId: bid.id, poNo: "po-life-1", placedOn: TODAY, userId: alice.id });
    S.po = aw.po;
    S.lines = (await db.query("SELECT id, item_id, qty::float8 AS qty FROM po_line WHERE po_id = $1 ORDER BY line_no", [aw.po.id])).rows;
    equal(S.lines.length, Object.keys(S.need).length, "a PO line per item");
    for (const l of S.lines) equal(l.qty, r3(S.need[Object.keys(S.items).find((c) => S.items[c].id === l.item_id)] + 4), "the line's quantity is the MR's");
  });
});

test("6-7. a partial shipment, then a partial receipt — never more than shipped", async () => {
  await inP(async () => {
    S.byCode = Object.fromEntries(Object.keys(S.need).map((c) => [c, S.lines.find((l) => l.item_id === S.items[c].id)]));
    S.shipped = Object.fromEntries(Object.keys(S.need).map((c) => [c, r3(S.need[c] + 2)]));       // 2 short of the order: the rest comes later
    await prc.createShipment(db, { projectId: P, shipmentNo: "sh-life-1", poId: S.po.id, shippedOn: TODAY,
      lines: Object.keys(S.need).map((c) => ({ poLineId: S.byCode[c].id, qty: S.shipped[c] })), userId: alice.id });
    const c0 = Object.keys(S.need)[0];
    await throws(() => prc.receiveAgainstPo(db, { projectId: P, poLineId: S.byCode[c0].id, receiptNo: "MRR-X", receivedOn: TODAY, qty: r3(S.shipped[c0] + 1), heatNo: "H", mtcRef: "M" }), "INVALID_INPUT", "more than shipped");
    S.lots = {};
    for (const c of Object.keys(S.need))
      S.lots[c] = await prc.receiveAgainstPo(db, { projectId: P, poLineId: S.byCode[c].id, receiptNo: `MRR-${c}`, receivedOn: TODAY, qty: S.shipped[c], heatNo: `H-${c}`, mtcRef: `MTC-${c}` });
    for (const c of Object.keys(S.need)) equal(Number(S.lots[c].qty_received), S.shipped[c]);
    const l = (await prc.lineStatus(db, { projectId: P, poLineId: S.byCode[c0].id }));
    equal([l.receivedQty, l.shippedQty, r3(l.qty - l.receivedQty)], [S.shipped[c0], S.shipped[c0], 2], "2 still to come");
  });
});

test("8-9. a lot is quarantine until the MIR and the MTC; then it is issuable", async () => {
  await inP(async () => {
    const c0 = Object.keys(S.need)[0];
    await throws(() => wh.recordMovement(db, { projectId: P, lotId: S.lots[c0].id, kind: "issue", qty: 1, movedOn: TODAY, spoolId: S.spools[0].id }), "INVALID_INPUT", "no MIR yet");
    for (const c of Object.keys(S.need)) {
      await wh.inspectLot(db, { projectId: P, lotId: S.lots[c].id, qtyAccepted: S.shipped[c], qtyRejected: 0, mirRef: `MIR-${c}`, inspectedOn: TODAY });
      await wh.reviewMtc(db, { projectId: P, lotId: S.lots[c].id, mtcStatus: "accepted" });
    }
    const stock = await wh.stock(db, { projectId: P });
    assert(stock.every((l) => l.issuable), "all accepted and certified");
  });
});

test("10-11. reserve the spool's material, then issue it to that spool: the issue fills the reservation", async () => {
  await inP(async () => {
    const r = await spm.reserveSpoolMaterial(db, { projectId: P, spoolId: S.spools[0].id, needBy: "2026-10-01", userId: alice.id });
    equal(r.reserved, S.sp1.length);
    const held = (await db.query("SELECT coalesce(sum(qty),0)::float8 AS n FROM material_reservation WHERE spool_id = $1 AND released_at IS NULL", [S.spools[0].id])).rows[0].n;
    equal(r3(held), r3(S.sp1.reduce((a, l) => a + l.qty, 0)), "the reservation is exactly the spool's need");
    for (const l of S.sp1) {
      const mv = await wh.recordMovement(db, { projectId: P, lotId: S.lots[l.stockCode].id, kind: "issue", qty: l.qty, movedOn: TODAY, spoolId: S.spools[0].id, refNo: "MIV-1" });
      assert(mv.reservation_id, `${l.stockCode}: the issue filled the spool's reservation`);
    }
    const m = await spm.spoolMaterial(db, { projectId: P, spoolId: S.spools[0].id });
    assert(m.lines.every((l) => l.state === "issued"), JSON.stringify(m.lines.map((l) => l.state)));
  });
});

test("12-13. a return gives stock back and re-opens the spool's need; stock, reservation and shortage agree with the ledger", async () => {
  await inP(async () => {
    const back = S.sp1[0], q = Math.min(1, back.qty);
    await wh.recordMovement(db, { projectId: P, lotId: S.lots[back.stockCode].id, kind: "return", qty: q, movedOn: TODAY, spoolId: S.spools[0].id, refNo: "RET-1" });
    const lot = (await wh.stock(db, { projectId: P })).find((l) => l.id === S.lots[back.stockCode].id);
    const issuedOnSp1 = S.sp1.find((l) => l.stockCode === back.stockCode).qty;
    equal([r3(lot.issued), r3(lot.returned), r3(lot.netIssued), r3(lot.onHand)], [issuedOnSp1, q, r3(issuedOnSp1 - q), r3(S.shipped[back.stockCode] - (issuedOnSp1 - q))], "stock = accepted − issued + returned");
    const m = await spm.spoolMaterial(db, { projectId: P, spoolId: S.spools[0].id });
    const line = m.lines.find((l) => l.stockCode === back.stockCode);
    assert(line.state !== "issued", `the returned ${q} re-opens the line (${line.state})`);
    const short = (await wh.shortages(db, { projectId: P })).find((x) => x.itemId === S.items[back.stockCode].id);
    equal(r3(short.required), r3(S.need[back.stockCode] + 4), "the requirement is the MTO's, unchanged by the return");
    equal(r3(short.issued), r3(issuedOnSp1 - q), "the shortage counts net issued");
    const reservedLeft = (await rsv.reservationBoard(db, { projectId: P })).filter((r) => r.itemCode === back.stockCode).reduce((a, r) => a + r.left, 0);
    equal(reservedLeft, 0, "what was reserved was issued; a return does not re-reserve");
    const w = await wf.workFront(db, { projectId: P, today: TODAY });
    assert(w, "the workfront still reads");
  });
});

test("14. an MTC rejected after issue: nothing new is issued, and the recall names where it went", async () => {
  await inP(async () => {
    const c = S.sp1[0].stockCode;
    const out = await wh.reviewMtc(db, { projectId: P, lotId: S.lots[c].id, mtcStatus: "rejected" });
    equal(out.lot.mtc_status, "rejected");
    const dest = out.recall.filter((d) => d.lot_id === S.lots[c].id || d.lotId === S.lots[c].id);
    assert(dest.length >= 1, JSON.stringify(out.recall));
    assert(dest.some((d) => (d.spool_no || d.spoolNo) === S.spools[0].spool_no), "the recall names the spool it went to");
    const netOut = r3(S.sp1.find((l) => l.stockCode === c).qty - Math.min(1, S.sp1[0].qty));
    equal(r3(Number(dest.find((d) => (d.spool_no || d.spoolNo) === S.spools[0].spool_no).qty)), netOut, "the quantity at that destination is net of the return");
    await throws(() => wh.recordMovement(db, { projectId: P, lotId: S.lots[c].id, kind: "issue", qty: 1, movedOn: TODAY, spoolId: S.spools[1].id }), "INVALID_INPUT", "no new issue from a rejected lot");
  });
});

test("15. another project sees none of it", async () => {
  await withProject(db, Q, async () => {
    equal((await wh.stock(db, { projectId: Q })).length, 0);
    equal((await wh.shortages(db, { projectId: Q })).length, 0);
    const c = S.sp1[0].stockCode;
    await throws(() => wh.recordMovement(db, { projectId: Q, lotId: S.lots[c].id, kind: "issue", qty: 1, movedOn: TODAY, purpose: "x" }), "not found");
    await throws(() => spm.reserveSpoolMaterial(db, { projectId: Q, spoolId: S.spools[0].id, userId: alice.id }));
  });
});

await run();
