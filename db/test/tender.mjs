#!/usr/bin/env node
/**
 * Procurement before and after the PO: MR revisions, bid evaluation and
 * ranking, award, and the Vendor Data Template into the asset master.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bidProblems, rankBids, awardProblems, templateProblems, submissionProblems, masterFromSubmission } from "../../lib/procurement/tender.mjs";

// ── the rules ────────────────────────────────────────────────────────────

const ctx0 = { currentRev: 1, today: "2026-09-20" };
const B = (o) => ({ id: o.id, mrRev: 1, techStatus: "acceptable", validUntil: "2026-10-30", currency: "EUR", totalPrice: 100, ...o });

test("a bid is evaluated only against the current revision, when acceptable, valid and priced", async () => {
  equal(bidProblems(B({ id: "a" }), ctx0), []);
  assert(/Rev 0/.test(bidProblems(B({ id: "a", mrRev: 0 }), ctx0)[0]), "quoted a superseded revision");
  equal(bidProblems(B({ id: "a", techStatus: "pending" }), ctx0).length, 1);
  equal(bidProblems(B({ id: "a", techStatus: "not_acceptable" }), ctx0).length, 1);
  assert(/تمام شده/.test(bidProblems(B({ id: "a", validUntil: "2026-09-19" }), ctx0)[0]), "expired the day before");
  equal(bidProblems(B({ id: "a", validUntil: "2026-09-20" }), ctx0), [], "valid through its last day");
  equal(bidProblems(B({ id: "a", validUntil: null }), ctx0).length, 1, "unknown validity is not assumed");
  equal(bidProblems(B({ id: "a", currency: null }), ctx0).length, 1);
  equal(bidProblems(B({ id: "a", totalPrice: null }), ctx0).length, 1);
});

test("ranking is by price among evaluable bids, ties share a rank, and two currencies are not ranked", async () => {
  const bids = [B({ id: "a", totalPrice: 120 }), B({ id: "b", totalPrice: 90 }), B({ id: "c", totalPrice: 90 }),
    B({ id: "d", totalPrice: 50, techStatus: "not_acceptable" })];
  const r = rankBids(bids, ctx0);
  equal(r.ranked.map((x) => [x.id, x.rank]), [["b", 1], ["c", 1], ["a", 3]]);
  equal(r.lowestIds, ["b", "c"], "the cheaper bid that failed technically is not the lowest");
  const mixed = rankBids([B({ id: "a" }), B({ id: "b", currency: "usd" })], ctx0);
  equal([mixed.ranked, mixed.lowestIds], [null, []]);
  assert(/نرخ تبدیل/.test(mixed.reason));
  equal(rankBids([B({ id: "a", currency: "eur" }), B({ id: "b", currency: " EUR" })], ctx0).ranked.length, 2, "case and spaces are one currency");
});

test("awarding anything but the lowest, or without a ranking, needs a justification", async () => {
  const bids = [B({ id: "a", totalPrice: 120 }), B({ id: "b", totalPrice: 90 })];
  const ctx = { ...ctx0, bids };
  equal(awardProblems(bids[1], ctx), []);
  equal(awardProblems(bids[0], ctx).length, 1);
  equal(awardProblems(bids[0], ctx, { justification: "shorter delivery on critical path" }), []);
  const mixed = [B({ id: "a" }), B({ id: "b", currency: "USD" })];
  equal(awardProblems(mixed[0], { ...ctx0, bids: mixed }).length, 1, "no ranking: no default winner");
  const rejected = B({ id: "x", techStatus: "not_acceptable" });
  equal(awardProblems(rejected, { ...ctx0, bids: [rejected] }, { justification: "any" }).length, 1, "no justification rescues a failed bid");
});

test("the template and the vendor's values are checked, and nameplate data flows only where it agrees", async () => {
  const attrs = [{ key: "manufacturer", label: "Manufacturer", type: "text", required: true },
    { key: "rated_power", label: "Rated power", unit: "kW", type: "number", required: true },
    { key: "year_built", label: "Year", type: "number", required: false }];
  equal(templateProblems(attrs), []);
  equal(templateProblems([...attrs, { key: "manufacturer", label: "x", type: "text" }]).length, 1, "duplicate key");
  equal(templateProblems([{ key: "Rated Power", label: "x", type: "text" }]).length, 1);
  equal(templateProblems([{ key: "year_built", label: "Year", type: "text" }]).length, 1);
  equal(templateProblems([]).length, 1);
  equal(submissionProblems(attrs, { manufacturer: "Sulzer", rated_power: "1,250" }), []);
  equal(submissionProblems(attrs, { manufacturer: "Sulzer" }).length, 1, "a required value is missing");
  equal(submissionProblems(attrs, { manufacturer: "Sulzer", rated_power: "about 1 MW" }).length, 1);
  equal(submissionProblems(attrs, { manufacturer: "S", rated_power: "5", colour: "red" }).length, 1, "not in the template");
  equal(masterFromSubmission({ manufacturer: "Sulzer", year_built: "2026" }, { manufacturer: "Sulzer" }),
    { patch: { manufacturer: "Sulzer", yearBuilt: 2026 }, differences: [] });
  equal(masterFromSubmission({ manufacturer: "KSB" }, { manufacturer: "Sulzer" }).differences,
    [{ field: "manufacturer", current: "Sulzer", submitted: "KSB" }]);
});

// ── against the database ─────────────────────────────────────────────────

process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "tender-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const wh = await import("../../lib/db/repos/warehouse.mjs");
const prc = await import("../../lib/db/repos/procurement.mjs");
const hov = await import("../../lib/db/repos/handover.mjs");
const td = await import("../../lib/db/repos/tender.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "TND", name: "T", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
const TODAY = new Date().toISOString().slice(0, 10);
const shift = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let pipe, pump, v1, v2, v3, mr;

await inP(async () => {
  pipe = await wh.upsertItem(db, { projectId: P, code: "P-CS-8-40", description: "Pipe 8\" SCH40", category: "pipe", uom: "m" });
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-1203A", discipline: "equipment", kind: "rotating" });
  v1 = await prc.upsertVendor(db, { projectId: P, code: "SUL", name: "Sulzer" });
  v2 = await prc.upsertVendor(db, { projectId: P, code: "KSB", name: "KSB" });
  v3 = await prc.upsertVendor(db, { projectId: P, code: "FLS", name: "Flowserve" });
});

test("an MR is edited in draft and frozen when issued; a change is a new revision", async () => {
  await inP(async () => {
    mr = await td.createMr(db, { projectId: P, mrNo: "mr-pu-001", title: "Cooling water pumps", userId: alice.id });
    equal(mr.mr_no, "MR-PU-001");
    await throws(() => td.issueMr(db, { projectId: P, mrId: mr.id, reason: "IFQ" }), "INVALID_INPUT", "no lines, no issue");
    await td.addMrLine(db, { projectId: P, mrId: mr.id, tagId: pump.id, qty: 1, needOn: shift(200) });
    await throws(() => td.addMrLine(db, { projectId: P, mrId: mr.id, itemId: pipe.id, qty: 12, uom: "EA" }), "INVALID_INPUT", "the item's unit");
    await td.addMrLine(db, { projectId: P, mrId: mr.id, itemId: pipe.id, qty: 12 });
    await throws(() => td.issueMr(db, { projectId: P, mrId: mr.id, reason: " " }), "INVALID_INPUT");
    equal((await td.issueMr(db, { projectId: P, mrId: mr.id, reason: "Issued for enquiry", userId: alice.id })).current_rev, 0);
    await throws(() => td.addMrLine(db, { projectId: P, mrId: mr.id, itemId: pipe.id, qty: 1 }), "INVALID_INPUT", "issued lines are frozen");
    await throws(() => db.query("UPDATE mr_revision SET reason = 'x'"), "permission denied");
  });
});

let b1, b2, b3;
test("bids quote the issued revision; a bid on a superseded revision drops out of the ranking", async () => {
  await inP(async () => {
    b1 = await td.recordBid(db, { projectId: P, mrId: mr.id, vendorId: v1.id, receivedOn: TODAY, validUntil: shift(60), currency: "eur", totalPrice: 410000 });
    equal([b1.mr_rev, b1.currency], [0, "EUR"]);
    await throws(() => td.recordBid(db, { projectId: P, mrId: mr.id, vendorId: v2.id, receivedOn: TODAY, totalPrice: 5 }), "INVALID_INPUT", "a price needs a currency");
    // The pipe quantity changes: revision 1.
    await td.reviseMr(db, { projectId: P, mrId: mr.id });
    await td.addMrLine(db, { projectId: P, mrId: mr.id, itemId: pipe.id, qty: 6, description: "spare lengths" });
    equal((await td.issueMr(db, { projectId: P, mrId: mr.id, reason: "Rev 1: spare pipe added", userId: alice.id })).current_rev, 1);
    b2 = await td.recordBid(db, { projectId: P, mrId: mr.id, vendorId: v2.id, receivedOn: TODAY, validUntil: shift(60), currency: "EUR", totalPrice: 395000 });
    b3 = await td.recordBid(db, { projectId: P, mrId: mr.id, vendorId: v3.id, receivedOn: TODAY, validUntil: shift(60), currency: "EUR", totalPrice: 380000 });
    await throws(() => td.evaluateBid(db, { projectId: P, bidId: b3.id, techStatus: "not_acceptable" }), "INVALID_INPUT", "a rejection says why");
    await td.evaluateBid(db, { projectId: P, bidId: b3.id, techStatus: "not_acceptable", note: "API 610 casing rating not met", userId: alice.id });
    for (const b of [b1, b2]) await td.evaluateBid(db, { projectId: P, bidId: b.id, techStatus: "acceptable", userId: alice.id });
    const t = await td.tenderOf(db, { projectId: P, mrId: mr.id });
    const by = Object.fromEntries(t.bids.map((b) => [b.id, b]));
    assert(/Rev 0/.test(by[b1.id].problems[0]), "Sulzer quoted Rev 0");
    equal(by[b3.id].problems, ["فنی مردود"]);
    equal([t.ranking.lowestIds, by[b2.id].rank], [[b2.id], 1], "KSB is the only evaluable bid");
  });
});

test("the award refuses a bid that is not evaluable, places the PO from the issued lines, and keeps the ranking", async () => {
  await inP(async () => {
    await throws(() => td.awardMr(db, { projectId: P, mrId: mr.id, bidId: b3.id, poNo: "PO-1", placedOn: TODAY, justification: "cheapest", userId: alice.id }),
      "INVALID_INPUT", "a technically rejected bid cannot win");
    await throws(() => td.awardMr(db, { projectId: P, mrId: mr.id, bidId: b2.id, poNo: "PO-1", placedOn: TODAY }), "INVALID_INPUT", "a person awards");
    const r = await td.awardMr(db, { projectId: P, mrId: mr.id, bidId: b2.id, poNo: "po-pu-001", placedOn: TODAY, userId: alice.id });
    equal(r.lines, 3);
    const { rows: [po] } = await db.query("SELECT po_no, vendor_id, currency, mr_id FROM purchase_order WHERE id = $1", [r.po.id]);
    equal([po.po_no, po.vendor_id, po.currency, po.mr_id], ["PO-PU-001", v2.id, "EUR", mr.id]);
    const { rows: lines } = await db.query("SELECT tag_id, item_id, qty::float8 AS qty, uom FROM po_line WHERE po_id = $1 ORDER BY line_no", [r.po.id]);
    equal(lines.map((l) => [!!l.tag_id, l.qty, l.uom]), [[true, 1, "EA"], [false, 12, "m"], [false, 6, "m"]]);
    const { rows: [aw] } = await db.query("SELECT ranking FROM mr_award WHERE mr_id = $1", [mr.id]);
    equal(aw.ranking.lowestIds, [b2.id]);
    await throws(() => td.awardMr(db, { projectId: P, mrId: mr.id, bidId: b2.id, poNo: "PO-2", placedOn: TODAY, userId: alice.id }), "INVALID_INPUT");
    await throws(() => td.evaluateBid(db, { projectId: P, bidId: b1.id, techStatus: "acceptable", userId: alice.id }), "INVALID_INPUT");
    await throws(() => db.query("DELETE FROM mr_award"), "permission denied");
  });
});

test("an award that is not the lowest is refused without a reason and kept with one", async () => {
  await inP(async () => {
    const m2 = await td.createMr(db, { projectId: P, mrNo: "MR-PI-002", title: "Pipe" });
    await td.addMrLine(db, { projectId: P, mrId: m2.id, itemId: pipe.id, qty: 100 });
    await td.issueMr(db, { projectId: P, mrId: m2.id, reason: "IFQ" });
    const cheap = await td.recordBid(db, { projectId: P, mrId: m2.id, vendorId: v1.id, receivedOn: TODAY, validUntil: shift(30), currency: "EUR", totalPrice: 9000 });
    const dear = await td.recordBid(db, { projectId: P, mrId: m2.id, vendorId: v2.id, receivedOn: TODAY, validUntil: shift(30), currency: "EUR", totalPrice: 9900 });
    for (const b of [cheap, dear]) await td.evaluateBid(db, { projectId: P, bidId: b.id, techStatus: "acceptable", userId: alice.id });
    await throws(() => td.awardMr(db, { projectId: P, mrId: m2.id, bidId: dear.id, poNo: "PO-PI-2", placedOn: TODAY, userId: alice.id }), "INVALID_INPUT");
    await td.awardMr(db, { projectId: P, mrId: m2.id, bidId: dear.id, poNo: "PO-PI-2", placedOn: TODAY, userId: alice.id,
      justification: "Mill in stock; the cheaper bid is 14 weeks later on the critical path" });
    const { rows: [aw] } = await db.query("SELECT justification FROM mr_award WHERE mr_id = $1", [m2.id]);
    assert(/critical path/.test(aw.justification));
  });
});

test("VDT: no class, no template; incomplete data is recorded but not accepted; accepted data reaches the asset master", async () => {
  await inP(async () => {
    await throws(() => td.submitVdt(db, { projectId: P, tagId: pump.id, values: {}, submittedOn: TODAY }), "INVALID_INPUT", "no ISO class yet");
    await projects.updateProjectProfile(db, { projectId: P, patch: { criticality_levels: "A, B, C" } });
    await hov.setAssetMaster(db, { projectId: P, tagId: pump.id, isoClass: "PU", criticality: "A", criticalityBasis: "RBI", manufacturer: "KSB", userId: alice.id });
    let board = await td.vdtBoard(db, { projectId: P });
    equal(board.tags.find((t) => t.id === pump.id).state.code, "no_template");
    await throws(() => td.submitVdt(db, { projectId: P, tagId: pump.id, values: {}, submittedOn: TODAY }), "INVALID_INPUT");
    await td.setTemplate(db, { projectId: P, isoClass: "pu", reason: "Company VDT for centrifugal pumps", userId: alice.id, attributes: [
      { key: "manufacturer", label: "Manufacturer", type: "text", required: true },
      { key: "serial_no", label: "Serial no.", type: "text", required: true },
      { key: "rated_flow", label: "Rated flow", unit: "m³/h", type: "number", required: true },
      { key: "year_built", label: "Year built", type: "number" }] });
    const s1 = await td.submitVdt(db, { projectId: P, tagId: pump.id, submittedOn: TODAY, vendorRef: "KSB-TR-014",
      values: { manufacturer: "KSB", serial_no: "9981-A", rated_flow: "tbc" } });
    equal(s1.problems.length, 1, "rated flow is not a number");
    board = await td.vdtBoard(db, { projectId: P });
    equal(board.tags.find((t) => t.id === pump.id).state.code, "incomplete");
    await throws(() => td.reviewVdt(db, { projectId: P, submissionId: s1.id, decision: "accepted", userId: alice.id }), "INVALID_INPUT");
    await throws(() => td.reviewVdt(db, { projectId: P, submissionId: s1.id, decision: "returned", userId: alice.id }), "INVALID_INPUT", "a return says why");
    await td.reviewVdt(db, { projectId: P, submissionId: s1.id, decision: "returned", note: "rated flow missing", userId: alice.id });
    const s2 = await td.submitVdt(db, { projectId: P, tagId: pump.id, submittedOn: TODAY,
      values: { manufacturer: "KSB SE", serial_no: "9981-A", rated_flow: "450", year_built: "2026" } });
    equal(s2.problems, []);
    const e = await throws(() => td.reviewVdt(db, { projectId: P, submissionId: s2.id, decision: "accepted", userId: alice.id }), "VDT_DIFFERS",
      "KSB vs KSB SE is shown, not overwritten");
    equal(e.differences, [{ field: "manufacturer", current: "KSB", submitted: "KSB SE" }]);
    await td.reviewVdt(db, { projectId: P, submissionId: s2.id, decision: "accepted", confirmDifferences: true, userId: alice.id });
    const { rows: [am] } = await db.query("SELECT iso_class, criticality, manufacturer, serial_no, year_built FROM asset_master WHERE tag_id = $1", [pump.id]);
    equal([am.iso_class, am.criticality, am.manufacturer, am.serial_no, am.year_built], ["PU", "A", "KSB SE", "9981-A", 2026],
      "nameplate values arrive; class and criticality stay");
    equal((await hov.assetMasterHistory(db, { projectId: P, tagId: pump.id })).length, 2, "the change is a revision of the asset master");
    board = await td.vdtBoard(db, { projectId: P });
    equal(board.tags.find((t) => t.id === pump.id).state.code, "accepted");
    equal(board.tags.find((t) => t.id === pump.id).po_no, "PO-PU-001", "the PO that bought the pump");
  });
});

test("a template change is a revision; an older submission is judged by the template it answered", async () => {
  await inP(async () => {
    // A correction the vendor sent under Rev 0, still awaiting review.
    await td.submitVdt(db, { projectId: P, tagId: pump.id, submittedOn: TODAY,
      values: { manufacturer: "KSB SE", serial_no: "9981-A", rated_flow: "455" } });
    const t1 = await td.setTemplate(db, { projectId: P, isoClass: "PU", reason: "NPSHr added", userId: alice.id, attributes: [
      { key: "manufacturer", label: "Manufacturer", type: "text", required: true },
      { key: "npshr", label: "NPSHr", unit: "m", type: "number", required: true }] });
    equal(t1.rev, 1);
    const row = (await td.vdtBoard(db, { projectId: P })).tags.find((t) => t.id === pump.id);
    equal([row.state.code, row.outdated, row.templateRev], ["review", true, 1],
      "complete against Rev 0, which it answered — not 'incomplete' against Rev 1, which it never saw");
    await throws(() => db.query("UPDATE vdt_template SET reason = 'x'"), "permission denied");
  });
});

test("tender and VDT records belong to one project", async () => {
  const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: alice.id });
  await withProject(db, other.id, async () => {
    for (const t of ["material_requisition", "bid", "mr_award", "vdt_template", "vdt_submission"]) {
      equal((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0, t);
    }
    await throws(() => td.issueMr(db, { projectId: other.id, mrId: mr.id, reason: "x" }), "not found");
  });
});

await run();
