#!/usr/bin/env node
/**
 * Material receipt under the ITP: a warehouse lot is an item an inspection
 * request is raised for, and ACCEPTING it — on the MIR, or its MTC — waits
 * for the request the project's material ITP holds on. Rejecting never
 * waits. A project with no material ITP receives as before.
 *
 * A lot's kind of work is its item's CATEGORY, not one flat "material": a
 * pressure/structural item (pipe, fitting, flange, valve, plate, structural,
 * bolting — lib/warehouse/stock.mjs's TRACEABLE set) is scope
 * "material_pressure"; cable and instrument are "material_electrical";
 * everything else is "material_general". A hold written on one scope's ITP
 * never touches a lot of another.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "matinsp-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const insp = await import("../../lib/db/repos/inspection.mjs");
const qa = await import("../../lib/db/repos/quality.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice", displayName: "Alice (contractor QC)" });
const bob = await projects.ensureUser(db, { subject: "kc|bob", displayName: "Bob (company)" });
const dave = await projects.ensureUser(db, { subject: "kc|dave", displayName: "Dave (engineer)" });
const proj = await projects.createProject(db, { code: "MAT", name: "M", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "MAT2", name: "O", ownerUserId: alice.id });
const P = proj.id;
for (const [u, role, party] of [[alice, "engineer", "contractor"], [bob, "qc", "company"], [dave, "engineer", null]]) {
  await projects.addMember(db, { projectId: P, userId: u.id, role });
  await withProject(db, P, () => projects.setInspectionParty(db, { projectId: P, userId: u.id, party }));
}
const M = async (u) => projects.membershipOf(db, { projectId: P, userId: u.id });
const inP = (fn) => withProject(db, P, fn);
const TODAY = new Date().toISOString().slice(0, 10);
const inHours = (h, from = Date.now()) => new Date(from + h * 3_600_000);

let pipe, before, lotA, lotB, lotC, foreignLot, fdn, itp, mirAct, mtcAct, fdnAct;
const receive = (receiptNo, heatNo, qty = 50) => wh.receiveLot(db, { projectId: P, itemId: pipe.id, receiptNo, receivedOn: TODAY,
  heatNo, mtcRef: `MTC-${heatNo}`, qtyReceived: qty, userId: alice.id });
const lotOf = async (id) => (await wh.stock(db, { projectId: P })).find((l) => l.id === id);

await inP(async () => {
  pipe = await wh.upsertItem(db, { projectId: P, code: "PIPE-6-S40", description: "Pipe 6in Sch40", category: "pipe", uom: "m", spec: "A106 Gr.B" });
  const sub = await spine.upsertSubsystem(db, { projectId: P, code: "12-01", systemCode: "12" });
  fdn = await spine.upsertTag(db, { projectId: P, tagNo: "F-1", discipline: "civil", kind: "foundation", subsystemId: sub.id });
});
await withProject(db, other.id, async () => {
  const it = await wh.upsertItem(db, { projectId: other.id, code: "X", description: "x", category: "pipe", uom: "m" });
  foreignLot = await wh.receiveLot(db, { projectId: other.id, itemId: it.id, receiptNo: "R-X", receivedOn: TODAY, qtyReceived: 1 });
});

test("with no material ITP, a lot is received, accepted and its MTC accepted as before", async () => {
  await inP(async () => {
    before = await receive("MRR-001", "H-1");
    await wh.inspectLot(db, { projectId: P, lotId: before.id, qtyAccepted: 50, mirRef: "MIR-001", inspectedOn: TODAY });
    await wh.reviewMtc(db, { projectId: P, lotId: before.id, mtcStatus: "accepted" });
    const l = await lotOf(before.id);
    equal([l.issuable, l.itpHold], [true, { mir: null, mtc: null }]);
  });
});

test("the material ITP names only the receipt's own two checks, and is approved like any ITP", async () => {
  await inP(async () => {
    itp = await insp.createItp(db, { projectId: P, itpNo: "ITP-MAT-01", revision: "0", title: "Material receiving",
      scope: "material_pressure", userId: alice.id });
    await throws(async () => insp.saveActivity(db, { projectId: P, itpId: itp.id, seq: 5, title: "Fit-up", stepCode: "fit_up",
      points: { contractor: "H" } }), "زنجیرهٔ");
    mirAct = await insp.saveActivity(db, { projectId: P, itpId: itp.id, seq: 10, title: "Visual, dimensional, quantity", stepCode: "mir",
      points: { contractor: "H", company: "W" } });
    mtcAct = await insp.saveActivity(db, { projectId: P, itpId: itp.id, seq: 20, title: "MTC review", stepCode: "mtc_review",
      points: { contractor: "H", company: "R" } });
    await insp.saveActivity(db, { projectId: P, itpId: itp.id, seq: 30, title: "PMI of alloys", points: { contractor: "H", company: "W" } });
    itp = await insp.approveItp(db, { projectId: P, itpId: itp.id, userId: dave.id });
    const civ = await insp.createItp(db, { projectId: P, itpNo: "ITP-CIV-01", revision: "0", title: "Foundations", scope: "foundation", userId: alice.id });
    fdnAct = await insp.saveActivity(db, { projectId: P, itpId: civ.id, seq: 10, title: "Rebar", stepCode: "rebar", points: { contractor: "H" } });
    await insp.approveItp(db, { projectId: P, itpId: civ.id, userId: dave.id });
  });
});

test("accepting a lot on the MIR is held until its inspection is released, and the page is told why", async () => {
  await inP(async () => {
    lotA = await receive("MRR-002", "H-2");
    const e = await throws(async () => wh.inspectLot(db, { projectId: P, lotId: lotA.id, qtyAccepted: 40, qtyRejected: 10, inspectedOn: TODAY }),
      "ITP-MAT-01 ردیف 10");
    equal([e.status, e.code], [409, "INSPECTION_HOLD"]);
    const l = await lotOf(lotA.id);
    equal([l.inspection, l.itpHold.mir?.seq, l.itpHold.mir?.irNo, l.itpHold.mtc?.seq], ["pending", 10, null, 20]);
    // A lot inspected before the ITP came into force keeps its MIR; correcting it is not accepting it again.
    await wh.inspectLot(db, { projectId: P, lotId: before.id, qtyAccepted: 48, qtyRejected: 2, mirRef: "MIR-001/1", inspectedOn: TODAY });
    equal((await lotOf(before.id)).itpHold, { mir: null, mtc: null });
  });
});

test("rejecting is never held — and a lot rejected outright is still held when someone later accepts it", async () => {
  await inP(async () => {
    lotB = await receive("MRR-003", "H-3", 20);
    await wh.inspectLot(db, { projectId: P, lotId: lotB.id, qtyAccepted: 0, qtyRejected: 20, mirRef: "MIR-003", inspectedOn: TODAY });
    equal((await lotOf(lotB.id)).inspection, "rejected");
    await throws(async () => wh.inspectLot(db, { projectId: P, lotId: lotB.id, qtyAccepted: 20, qtyRejected: 0, inspectedOn: TODAY }), "ITP-MAT-01");
    await wh.reviewMtc(db, { projectId: P, lotId: lotB.id, mtcStatus: "rejected" });
    await throws(async () => wh.reviewMtc(db, { projectId: P, lotId: lotB.id, mtcStatus: "accepted" }), "ITP-MAT-01 ردیف 20");
  });
});

test("the request is raised for a lot, against the material ITP only, and names the lot as people do", async () => {
  await inP(async () => {
    const r = { projectId: P, activityId: mirAct.id, itemKind: "lot", itemId: lotA.id, plannedAt: inHours(30), membership: await M(alice), userId: alice.id };
    await throws(async () => insp.raiseIr(db, { ...r, activityId: fdnAct.id }), "نه «فونداسیون»");
    await throws(async () => insp.raiseIr(db, { ...r, itemKind: "tag", itemId: fdn.id }), "نه «دریافت کالا");
    await throws(async () => insp.raiseIr(db, { ...r, itemId: foreignLot.id }), "not found");
    await throws(async () => insp.raiseIr(db, { ...r, membership: await M(bob), userId: bob.id }), "پیمانکار");
    const ir = await insp.raiseIr(db, { ...r, location: "Laydown L-1" });
    const [row] = await insp.requestsFor(db, { projectId: P, itemKind: "lot", itemId: lotA.id });
    equal([row.ir_no, row.itemLabel, row.state.state], [ir.ir_no, "PIPE-6-S40 · MRR-002 · ذوب H-2", "awaiting"]);
    const l = await lotOf(lotA.id);
    equal([l.itpHold.mir.irNo, l.itpHold.mir.state], [ir.ir_no, "awaiting"]);
    const items = await insp.itemsForScope(db, { projectId: P, scope: "material_pressure" });
    equal(items.map((i) => [i.kind, i.label]).sort()[0][0], "lot");
    assert(items.every((i) => !i.label.includes("R-X")), "another project's lots are not offered");
    await throws(async () => wh.inspectLot(db, { projectId: P, lotId: lotA.id, qtyAccepted: 50, inspectedOn: TODAY }), "منتظر نتیجه");
  });
});

test("released by the contractor's Hold and the company's Witness; then the MIR accepts", async () => {
  await inP(async () => {
    await projects.updateProjectProfile(db, { projectId: P, patch: { inspection_notice_hours: 24 } });
    const [ir] = await insp.requestsFor(db, { projectId: P, itemKind: "lot", itemId: lotA.id });
    const at = new Date(ir.planned_at);
    await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted", membership: await M(alice), userId: alice.id, now: at });
    const v = await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "not_attended", aboutParty: "company",
      membership: await M(alice), userId: alice.id, now: inHours(1, at.getTime()) });
    equal(v.state.state, "released", "notified 30 h ahead of a 24 h notice");
    await wh.inspectLot(db, { projectId: P, lotId: lotA.id, qtyAccepted: 48, qtyRejected: 2, mirRef: "MIR-002", inspectedOn: TODAY });
    const l = await lotOf(lotA.id);
    equal([l.inspection, l.itpHold.mir, l.issuable], ["partial", null, false], "the MTC is still held");
  });
});

test("the MTC review: a Review party does not hold it; the contractor's Hold does, until released", async () => {
  await inP(async () => {
    await throws(async () => wh.reviewMtc(db, { projectId: P, lotId: lotA.id, mtcStatus: "accepted" }), "درخواست بازرسی ثبت نشده");
    const ir = await insp.raiseIr(db, { projectId: P, activityId: mtcAct.id, itemKind: "lot", itemId: lotA.id, plannedAt: inHours(2),
      membership: await M(alice), userId: alice.id });
    await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted", membership: await M(alice), userId: alice.id, now: inHours(3) });
    await wh.reviewMtc(db, { projectId: P, lotId: lotA.id, mtcStatus: "accepted" });
    const l = await lotOf(lotA.id);
    equal([l.mtcStatus, l.itpHold, l.issuable], ["accepted", { mir: null, mtc: null }, true]);
    const file = await insp.itemInspections(db, { projectId: P, itemKind: "lot", itemId: lotA.id });
    equal(file.activities.map((a) => [a.seq, a.stepDone, a.latest?.state.state || null]),
      [[10, true, "released"], [20, true, "released"], [30, false, null]]);
  });
});

test("a rejected receipt inspection closes, raises its NCR, and keeps the lot held", async () => {
  await inP(async () => {
    lotC = await receive("MRR-004", "H-4", 30);
    const ir = await insp.raiseIr(db, { projectId: P, activityId: mirAct.id, itemKind: "lot", itemId: lotC.id, plannedAt: inHours(30),
      membership: await M(alice), userId: alice.id });
    await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "rejected", comments: "heat number not stencilled on 4 lengths",
      membership: await M(bob), userId: bob.id, now: inHours(31) });
    const ncr = await insp.ncrFromIr(db, { projectId: P, irId: ir.id, severity: "minor", userId: alice.id, raiseNcr: qa.raiseNcr });
    assert(ncr.ncr_no && ncr.tag_id === null, "an NCR on material names no tag");
    await throws(async () => wh.inspectLot(db, { projectId: P, lotId: lotC.id, qtyAccepted: 30, inspectedOn: TODAY }), "بازرسی دوباره لازم است");
    equal((await lotOf(lotC.id)).itpHold.mir.state, "rejected");
    await wh.inspectLot(db, { projectId: P, lotId: lotC.id, qtyAccepted: 0, qtyRejected: 30, mirRef: "MIR-004", inspectedOn: TODAY });
  });
});

let cableItem, cableLot1, cableLot2, pipeLot2;
test("a pressure ITP does not hold a cable lot, and an electrical ITP holds only its own", async () => {
  await inP(async () => {
    cableItem = await wh.upsertItem(db, { projectId: P, code: "CBL-1", description: "Cable 3Cx35", category: "cable", uom: "m" });
    cableLot1 = await wh.receiveLot(db, { projectId: P, itemId: cableItem.id, receiptNo: "MRR-CBL-01", receivedOn: TODAY, qtyReceived: 500 });
    // No electrical ITP exists yet: the cable receives as before, untouched by the pressure ITP's PMI hold.
    await wh.inspectLot(db, { projectId: P, lotId: cableLot1.id, qtyAccepted: 500, mirRef: "MIR-CBL-01", inspectedOn: TODAY });
    equal((await lotOf(cableLot1.id)).itpHold, { mir: null, mtc: null });

    const cblItp = await insp.createItp(db, { projectId: P, itpNo: "ITP-MAT-CBL", revision: "0",
      title: "Cable receiving", scope: "material_electrical", userId: alice.id });
    const cblMir = await insp.saveActivity(db, { projectId: P, itpId: cblItp.id, seq: 10, title: "Visual and continuity",
      stepCode: "mir", points: { contractor: "H" } });
    await insp.approveItp(db, { projectId: P, itpId: cblItp.id, userId: dave.id });

    cableLot2 = await wh.receiveLot(db, { projectId: P, itemId: cableItem.id, receiptNo: "MRR-CBL-02", receivedOn: TODAY, qtyReceived: 200 });
    await throws(async () => wh.inspectLot(db, { projectId: P, lotId: cableLot2.id, qtyAccepted: 200, inspectedOn: TODAY }), "ITP-MAT-CBL ردیف 10");
    // The pressure ITP still holds a new pipe lot exactly as before; the new electrical ITP changes nothing about it.
    pipeLot2 = await receive("MRR-005", "H-5");
    await throws(async () => wh.inspectLot(db, { projectId: P, lotId: pipeLot2.id, qtyAccepted: 50, inspectedOn: TODAY }), "ITP-MAT-01 ردیف 10");

    const ir = await insp.raiseIr(db, { projectId: P, activityId: cblMir.id, itemKind: "lot", itemId: cableLot2.id,
      plannedAt: inHours(30), membership: await M(alice), userId: alice.id });
    await insp.recordResult(db, { projectId: P, irId: ir.id, outcome: "accepted", membership: await M(alice), userId: alice.id, now: inHours(31) });
    await wh.inspectLot(db, { projectId: P, lotId: cableLot2.id, qtyAccepted: 200, mirRef: "MIR-CBL-02", inspectedOn: TODAY });
    // Releasing the cable's own IR did not touch the pipe lot, which is still held.
    equal((await lotOf(pipeLot2.id)).itpHold.mir?.seq, 10);

    const pressureItems = await insp.itemsForScope(db, { projectId: P, scope: "material_pressure" });
    const electricalItems = await insp.itemsForScope(db, { projectId: P, scope: "material_electrical" });
    assert(!pressureItems.some((i) => i.id === cableLot2.id), "a cable lot is not offered under the pressure scope");
    assert(!electricalItems.some((i) => i.id === pipeLot2.id), "a pipe lot is not offered under the electrical scope");
    assert(electricalItems.some((i) => i.id === cableLot2.id));
  });
});

test("the database knows a lot and the material scope, and nothing it was not told", async () => {
  await inP(async () => {
    await throws(async () => db.query(
      `INSERT INTO inspection_request (project_id, ir_no, activity_id, item_kind, item_id, planned_at)
       VALUES ($1, 'IR-X', $2, 'drum', $3, now())`, [P, mirAct.id, lotA.id]), "ir_item_kind_known");
    await throws(async () => db.query(
      "INSERT INTO itp (project_id, itp_no, revision, title, scope) VALUES ($1, 'X', '0', 'x', 'catering')", [P]), "itp_scope_known");
  });
});

await run();
