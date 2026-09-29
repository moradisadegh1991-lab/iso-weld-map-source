#!/usr/bin/env node
/**
 * Work outside the contract and the changes behind it (lib/db/repos/changes.mjs):
 * a TQ answered by the designer and closed by the engineer; a site-run
 * change approved by someone else, put on the drawing by the designer and
 * closed only once that revision is in the MDR; a work order prepared,
 * issued by someone else, and paid as a variation item of the contract.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.PGLITE_DIR = await scratchDir("changes-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const contractors = await import("../../lib/db/repos/contractors.mjs");
const dcr = await import("../../lib/db/repos/doc-control.mjs");
const ctl = await import("../../lib/db/repos/controls.mjs");
const ct = await import("../../lib/db/repos/contracts.mjs");
const ch = await import("../../lib/db/repos/changes.mjs");

const db = await getDb();
const site = await projects.ensureUser(db, { subject: "kc|site" });       // site engineer: raises
const eng = await projects.ensureUser(db, { subject: "kc|eng" });         // EPC engineer: approves, closes
const designer = await projects.ensureUser(db, { subject: "kc|des" });    // design consultant: answers, as-built
const cm = await projects.ensureUser(db, { subject: "kc|cm" });           // construction manager: issues work orders
const proj = await projects.createProject(db, { code: "CHG", name: "C", ownerUserId: site.id });
const P = proj.id;
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let iso, contract, acc, tq, fcr, wo;
await withProject(db, P, async () => {
  await projects.updateProjectProfile(db, { projectId: P, patch: { contract_currency: "EUR" } });
  iso = await dcr.upsertMdr(db, { projectId: P, docNo: "DMW-ISO-7001", title: "Iso", discipline: "piping", docType: "ISO" });
  await dcr.issueRevision(db, { projectId: P, mdrId: iso.id, revision: "0", purpose: "IFC", issuedOn: daysAgo(40), userId: designer.id });
  const mec = await contractors.upsertContractor(db, { projectId: P, code: "C-MEC", name: "Mech", disciplines: ["piping"] });
  acc = await ctl.upsertAccount(db, { projectId: P, code: "WBS-70-PIP", title: "Piping", bac: 20000 });
  contract = await ct.upsertContract(db, { projectId: P, title: "Mechanical", kind: "subcontract", contractorId: mec.id, value: 50000, userId: cm.id });
  await ct.upsertLine(db, { projectId: P, contractId: contract.id, itemNo: "01", description: "Supports", unit: "EA", qty: 4, rate: 180,
    accountId: acc.id, method: "measured", userId: cm.id });
  await ct.setContractStatus(db, { projectId: P, contractId: contract.id, to: "in_review", userId: cm.id });
  await ct.setContractStatus(db, { projectId: P, contractId: contract.id, to: "signed", userId: eng.id });
});

test("a TQ: the designer answers, the engineer closes it — not the one who answered", async () => {
  await withProject(db, P, async () => {
    tq = await ch.raiseTq(db, { projectId: P, subject: "Drain at low point", question: "Line sags 150 mm at grid B; add a drain?",
      mdrDocumentId: iso.id, raisedOn: daysAgo(20), replyDue: daysAgo(10), userId: site.id });
    equal(tq.tq_no, "TQ-0001", "numbered by its form");
    await throws(() => ch.closeTq(db, { projectId: P, tqId: tq.id, outcome: "no_change", userId: eng.id }), "INVALID_INPUT");
    await ch.answerTq(db, { projectId: P, tqId: tq.id, answer: "Add 3/4\" drain with valve; route in field.", answeredOn: daysAgo(15), userId: designer.id });
    await throws(() => ch.closeTq(db, { projectId: P, tqId: tq.id, outcome: "change_required", userId: designer.id }), "INVALID_INPUT");
    const c = await ch.closeTq(db, { projectId: P, tqId: tq.id, outcome: "change_required", userId: eng.id });
    equal([c.status, c.outcome], ["closed", "change_required"]);
  });
});

test("a site-run change: approved by another, as-built by the designer, closed only when the revision is in the MDR", async () => {
  await withProject(db, P, async () => {
    fcr = await ch.raiseSiteChange(db, { projectId: P, kind: "site_run", title: "Drain D-01 routed in field", description: "3/4\" drain + valve at grid B",
      tqId: tq.id, mdrDocumentId: iso.id, raisedOn: daysAgo(14), userId: site.id });
    equal(fcr.fcr_no, "FCR-0001");
    await throws(() => ch.decideSiteChange(db, { projectId: P, changeId: fcr.id, decision: "approve", userId: site.id }), "INVALID_INPUT");
    await throws(() => ch.submitAsBuilt(db, { projectId: P, changeId: fcr.id, revision: "1", submittedOn: daysAgo(5), userId: designer.id }), "INVALID_INPUT");
    await ch.decideSiteChange(db, { projectId: P, changeId: fcr.id, decision: "approve", userId: eng.id });
    await ch.submitAsBuilt(db, { projectId: P, changeId: fcr.id, revision: "1", note: "Drain shown", submittedOn: daysAgo(5), userId: designer.id });
    const e = await throws(() => ch.closeSiteChange(db, { projectId: P, changeId: fcr.id, userId: eng.id }), "INVALID_INPUT");
    assert(/هنوز در رجیستر مدارک نیست/.test(e.message), e.message);
    await dcr.issueRevision(db, { projectId: P, mdrId: iso.id, revision: "1", purpose: "AB", issuedOn: daysAgo(4), userId: designer.id });
    equal((await ch.closeSiteChange(db, { projectId: P, changeId: fcr.id, userId: eng.id })).status, "closed");
  });
});

test("a work order: prepared, issued by someone else, and the contract gains a measured variation item", async () => {
  await withProject(db, P, async () => {
    await throws(() => ch.createWorkOrder(db, { projectId: P, contractId: contract.id, title: "Drain", description: "x", origin: "tq",
      unit: "EA", qty: 1, rate: 350, userId: site.id }), "INVALID_INPUT", "a TQ origin names its TQ");
    wo = await ch.createWorkOrder(db, { projectId: P, contractId: contract.id, title: "Field drain D-01", description: "Fabricate and install 3/4\" drain with valve",
      origin: "site_change", siteChangeId: fcr.id, accountId: acc.id, unit: "EA", qty: 1, rate: 350, userId: site.id });
    equal([wo.wo_no, wo.status], ["WO-0001", "draft"]);
    await throws(() => ch.issueWorkOrder(db, { projectId: P, workOrderId: wo.id, issuedOn: daysAgo(3), userId: site.id }), "INVALID_INPUT");
    const issued = await ch.issueWorkOrder(db, { projectId: P, workOrderId: wo.id, issuedOn: daysAgo(3), userId: cm.id });
    equal(issued.status, "issued");
    const { rows: [line] } = await db.query("SELECT * FROM contract_line WHERE id = $1", [issued.line_id]);
    equal([line.item_no, line.method, Number(line.qty), Number(line.rate), line.work_order_id], ["WO-0001", "measured", 1, 350, wo.id],
      "a variation item on the signed contract");
  });
});

test("the variation is measured and paid through the next statement, on the work order's WBS element", async () => {
  await withProject(db, P, async () => {
    const st = await ct.createStatement(db, { projectId: P, contractId: contract.id, periodTo: daysAgo(1), userId: site.id });
    const d = await ct.statementDetail(db, { projectId: P, statementId: st.id });
    const woLine = d.lines.find((l) => l.itemNo === "WO-0001");
    assert(woLine && woLine.cumQty === null, "the work order's item is in the statement, waiting for its sheet");
    await ct.setMeasured(db, { projectId: P, statementId: st.id, lineId: woLine.lineId, cumQty: 1, sheetRef: "MS-WO-0001", userId: site.id });
    const supports = d.lines.find((l) => l.itemNo === "01");
    await ct.setMeasured(db, { projectId: P, statementId: st.id, lineId: supports.lineId, cumQty: 0, sheetRef: "MS-01", userId: site.id });
    await ct.statementTransition(db, { projectId: P, statementId: st.id, action: "submit", userId: site.id });
    await ct.statementTransition(db, { projectId: P, statementId: st.id, action: "verify", userId: eng.id });
    await ct.statementTransition(db, { projectId: P, statementId: st.id, action: "approve", userId: cm.id });
    const { rows: [cost] } = await db.query("SELECT sum(amount)::float8 AS ac FROM cost_entry WHERE account_id = $1", [acc.id]);
    equal(cost.ac, 350, "actual cost of the variation on its WBS element");
    await ch.completeWorkOrder(db, { projectId: P, workOrderId: wo.id, completedOn: daysAgo(1), userId: site.id });
    const b = await ch.changesBoard(db, { projectId: P });
    equal([b.workOrders[0].status, b.workOrders[0].certified_qty], ["completed", 1]);
  });
});

await run();
