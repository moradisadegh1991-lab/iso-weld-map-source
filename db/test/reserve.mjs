#!/usr/bin/env node
/**
 * Reservations (stock set aside for a destination) and stock counts
 * (physical count against the book, decided by a second person).
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { destKey, remaining, freeFor, reservationProblems, variance, accuracy } from "../../lib/warehouse/reserve.mjs";

// ── the rules ────────────────────────────────────────────────────────────

test("free stock for a destination is what nobody else has reserved", async () => {
  equal(destKey({ purpose: "  Hydrotest Blinds " }), "purpose:hydrotest blinds");
  equal(destKey({ spoolId: "s", tagId: "t" }), "spool:s", "a spool is the destination when there is one");
  equal(destKey({}), null);
  equal(remaining({ qty: 10 }, 4), 6);
  equal(remaining({ qty: 10 }, 12), 0, "over-issued is fulfilled, not negative");
  equal(remaining({ qty: 10, releasedAt: "x" }, 0), 0, "released holds nothing");
  const res = [{ key: "tag:a", lotId: null, left: 30 }, { key: "tag:b", lotId: "L1", left: 20 }];
  equal(freeFor({ issuableOnHand: 100, reservations: res, key: "tag:c" }), 50);
  equal(freeFor({ issuableOnHand: 100, reservations: res, key: "tag:a" }), 80, "its own reservation is not in its way");
  equal(freeFor({ issuableOnHand: 40, reservations: res, key: "tag:a", lotId: "L1" }), 20, "on the lot, only lot-pinned reservations of others");
  equal(freeFor({ issuableOnHand: 40, reservations: res, key: "tag:c", lotId: "L2" }), 40);
  equal(reservationProblems({ qty: 5, key: null }, { free: 10, uom: "m" }).length, 1);
  equal(reservationProblems({ qty: 11, key: "tag:a" }, { free: 10, uom: "m" }).length, 1);
  equal(reservationProblems({ qty: 10, key: "tag:a" }, { free: 10, uom: "m" }), []);
});

test("a count is a gain, a loss or a match; accuracy is exact matches", async () => {
  equal(variance(10, 10), { diff: 0, kind: "match" });
  equal(variance(10, 12.5), { diff: 2.5, kind: "gain" });
  equal(variance(10, 7), { diff: -3, kind: "loss" });
  equal(accuracy([{ systemQty: 1, countedQty: 1 }, { systemQty: 2, countedQty: 1 }, { systemQty: 3, countedQty: 3 }]), 66.7);
  equal(accuracy([]), null);
});

// ── against the database ─────────────────────────────────────────────────

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "rsv-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const rsv = await import("../../lib/db/repos/reserve.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const proj = await projects.createProject(db, { code: "RSV", name: "R", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
const D = (k) => `2026-09-${String(k).padStart(2, "0")}`;
let cable, L1, L2, L3, t1, t2;

await inP(async () => {
  cable = await wh.upsertItem(db, { projectId: P, code: "CBL-3C35", description: "Cable 3Cx35", category: "cable", uom: "m" });
  t1 = await spine.upsertTag(db, { projectId: P, tagNo: "P-101", discipline: "equipment", kind: "rotating" });
  t2 = await spine.upsertTag(db, { projectId: P, tagNo: "P-102", discipline: "equipment", kind: "rotating" });
  L1 = await wh.receiveLot(db, { projectId: P, itemId: cable.id, receiptNo: "MRR-1", receivedOn: D(1), qtyReceived: 100 });
  L2 = await wh.receiveLot(db, { projectId: P, itemId: cable.id, receiptNo: "MRR-2", receivedOn: D(2), qtyReceived: 50 });
  L3 = await wh.receiveLot(db, { projectId: P, itemId: cable.id, receiptNo: "MRR-3", receivedOn: D(3), qtyReceived: 500 });
  await wh.inspectLot(db, { projectId: P, lotId: L1.id, qtyAccepted: 100, inspectedOn: D(2) });
  await wh.inspectLot(db, { projectId: P, lotId: L2.id, qtyAccepted: 50, inspectedOn: D(3) });
});
const issue = (lotId, qty, dest) => wh.recordMovement(db, { projectId: P, lotId, kind: "issue", qty, movedOn: D(10), ...dest });

let r1, r2;
test("a reservation cannot promise stock that is quarantined or already promised", async () => {
  await inP(async () => {
    await throws(() => rsv.reserve(db, { projectId: P, itemId: cable.id, qty: 151, tagId: t1.id }), "INVALID_INPUT",
      "150 accepted; the 500 m awaiting inspection is not free");
    r1 = await rsv.reserve(db, { projectId: P, itemId: cable.id, qty: 90, tagId: t1.id, userId: alice.id });
    r2 = await rsv.reserve(db, { projectId: P, itemId: cable.id, lotId: L2.id, qty: 40, tagId: t2.id, userId: alice.id });
    await throws(() => rsv.reserve(db, { projectId: P, itemId: cable.id, qty: 21, purpose: "temporary power" }), "INVALID_INPUT", "20 left");
    await throws(() => rsv.reserve(db, { projectId: P, itemId: cable.id, lotId: L2.id, qty: 11, purpose: "x" }), "INVALID_INPUT", "10 of MRR-2 unpinned");
    await throws(() => rsv.reserve(db, { projectId: P, itemId: cable.id, qty: 5 }), "INVALID_INPUT", "a destination");
  });
});

test("an issue may not take stock reserved for another destination, and fills its own reservation", async () => {
  await inP(async () => {
    await throws(() => issue(L1.id, 21, { purpose: "temporary power" }), "رزرو", "only 20 m are unreserved");
    await issue(L1.id, 20, { purpose: "temporary power" });
    await throws(() => issue(L2.id, 11, { tagId: t1.id }), "رزرو", "P-101 may not dip into the 40 m pinned to P-102 on MRR-2");
    const m = await issue(L1.id, 60, { tagId: t1.id });
    equal(m.reservation_id, r1.id);
    await issue(L2.id, 10, { tagId: t1.id });
    const board = await rsv.reservationBoard(db, { projectId: P });
    const b1 = board.find((r) => r.id === r1.id);
    equal([b1.issued, b1.left, b1.state], [70, 20, "active"]);
    const m2 = await issue(L2.id, 40, { tagId: t2.id });
    equal(m2.reservation_id, r2.id);
    equal(board.length, 2);
    equal((await rsv.reservationBoard(db, { projectId: P })).find((r) => r.id === r2.id).state, "fulfilled");
  });
});

test("releasing a reservation is a person's act with a reason, and frees the stock", async () => {
  await inP(async () => {
    await throws(() => issue(L1.id, 1, { purpose: "temporary power" }), "رزرو", "the last 20 m are P-101's");
    await throws(() => rsv.releaseReservation(db, { projectId: P, reservationId: r1.id, reason: " " }), "INVALID_INPUT");
    await rsv.releaseReservation(db, { projectId: P, reservationId: r1.id, reason: "P-101 cable route changed (RFI-044)", userId: alice.id });
    await issue(L1.id, 5, { purpose: "temporary power" });
    equal((await rsv.reservationBoard(db, { projectId: P })).find((r) => r.id === r1.id).state, "released");
    await throws(() => rsv.releaseReservation(db, { projectId: P, reservationId: r1.id, reason: "again" }), "not found");
  });
});

let count, lineGain, lineLoss;
test("a count is against the book on the count day; quarantine is not counted into the book", async () => {
  await inP(async () => {
    // Book on the 20th: MRR-1 100 − 20 − 60 − 5 = 15; MRR-2 50 − 10 − 40 = 0.
    count = await rsv.openCount(db, { projectId: P, countNo: "sc-2026-09", countedOn: D(20), scope: "Cable yard", userId: alice.id });
    await throws(() => rsv.enterCount(db, { projectId: P, countId: count.id, lotId: L3.id, countedQty: 500 }), "INVALID_INPUT");
    lineLoss = await rsv.enterCount(db, { projectId: P, countId: count.id, lotId: L1.id, countedQty: 12, countedBy: "Storekeeper A", userId: alice.id });
    equal([Number(lineLoss.system_qty), lineLoss.diff, lineLoss.kind], [15, -3, "loss"]);
    lineGain = await rsv.enterCount(db, { projectId: P, countId: count.id, lotId: L2.id, countedQty: 2, userId: alice.id });
    equal(lineGain.kind, "gain");
    await throws(() => rsv.enterCount(db, { projectId: P, countId: count.id, lotId: L1.id, countedQty: 12 }), "duplicate key", "a lot once per count");
    await throws(() => rsv.enterCount(db, { projectId: P, countId: count.id, lotId: L2.id, countedQty: -1 }), "INVALID_INPUT");
  });
});

test("a difference is decided by someone else, with a reason; adjusting moves the book by a count movement", async () => {
  await inP(async () => {
    await throws(() => rsv.closeCount(db, { projectId: P, countId: count.id }), "INVALID_INPUT", "two differences undecided");
    await throws(() => rsv.decideCountLine(db, { projectId: P, lineId: lineLoss.id, decision: "adjust", reason: "short", userId: alice.id }),
      "INVALID_INPUT", "not by who entered the count");
    await throws(() => rsv.decideCountLine(db, { projectId: P, lineId: lineLoss.id, decision: "adjust", reason: "", userId: bob.id }), "INVALID_INPUT");
    await rsv.decideCountLine(db, { projectId: P, lineId: lineLoss.id, decision: "adjust", reason: "3 m offcut scrapped, no MIV", userId: bob.id });
    await rsv.decideCountLine(db, { projectId: P, lineId: lineGain.id, decision: "keep_book", reason: "recount: 2 m belongs to MRR-1 drum", userId: bob.id });
    const lots = await wh.stock(db, { projectId: P });
    equal(lots.find((l) => l.id === L1.id).onHand, 12, "15 − 3 counted loss");
    equal(lots.find((l) => l.id === L1.id).netIssued, 85, "a count loss is not an issue");
    equal(lots.find((l) => l.id === L2.id).onHand, 0, "book kept");
    const dests = await wh.destinations(db, { projectId: P, lotIds: [L1.id] });
    equal(dests.reduce((a, d) => a + d.qty, 0), 85, "the recall list is what was issued, not what the count wrote off");
    await rsv.closeCount(db, { projectId: P, countId: count.id, userId: bob.id });
    const [c] = await rsv.countBoard(db, { projectId: P });
    equal([c.status, c.accuracyPct, c.pending], ["closed", 0, 0]);
    await throws(() => rsv.enterCount(db, { projectId: P, countId: count.id, lotId: L3.id, countedQty: 1 }), "INVALID_INPUT");
    await throws(() => db.query("DELETE FROM material_movement WHERE kind = 'count_loss'"), "permission denied");
  });
});

test("a loss that the book no longer holds is refused: recount", async () => {
  await inP(async () => {
    // A note issued on the 22nd, entered before the count of the 21st is: not in the book of the 21st.
    await wh.recordMovement(db, { projectId: P, lotId: L1.id, kind: "issue", qty: 1, movedOn: D(22), purpose: "temporary power" });
    const c2 = await rsv.openCount(db, { projectId: P, countNo: "SC-2", countedOn: D(21), userId: alice.id });
    const l = await rsv.enterCount(db, { projectId: P, countId: c2.id, lotId: L1.id, countedQty: 2, userId: alice.id });
    equal([Number(l.system_qty), l.diff], [12, -10]);
    await issue(L1.id, 5, { purpose: "temporary power" });                                   // book now 12 − 1 − 5 = 6
    await throws(() => rsv.decideCountLine(db, { projectId: P, lineId: l.id, decision: "adjust", reason: "short", userId: bob.id }), "دوباره بشمارید");
  });
});

test("stock that may not be issued cannot be reserved: a pipe lot without its MTC", async () => {
  await inP(async () => {
    const pipe = await wh.upsertItem(db, { projectId: P, code: "P-8-40", description: "Pipe", category: "pipe", uom: "m" });
    const lot = await wh.receiveLot(db, { projectId: P, itemId: pipe.id, receiptNo: "MRR-9", receivedOn: D(1), qtyReceived: 12 });
    await wh.inspectLot(db, { projectId: P, lotId: lot.id, qtyAccepted: 12, inspectedOn: D(2) });
    await throws(() => rsv.reserve(db, { projectId: P, itemId: pipe.id, qty: 1, tagId: t1.id }), "INVALID_INPUT",
      "accepted by MIR, but no heat number and no MTC: not issuable, so not free");
  });
});

test("reservations and counts belong to one project", async () => {
  const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: alice.id });
  await withProject(db, other.id, async () => {
    for (const t of ["material_reservation", "stock_count", "stock_count_line"]) {
      equal((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0, t);
    }
  });
});

await run();
