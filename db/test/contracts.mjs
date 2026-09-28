#!/usr/bin/env node
/**
 * Contracts, contractors' payment statements, finance, HR and the section
 * logs: a statement measures from the platform's dated work, from design
 * (PDMS) quantities × WBS progress, or from a measurement sheet — never a
 * typed number where the platform has one; four eyes on every step; the
 * money is cumulative with its deductions; approval is actual cost on the
 * WBS; payment never exceeds what was approved.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { statementMoney, lineFlags, transitionProblem } from "../../lib/contracts/statement.mjs";

// ── the engine ───────────────────────────────────────────────────────────

test("a statement's money: cumulative gross less the last approved, deductions on the period, VAT added", async () => {
  const terms = { advance_pct: 10, advance_recovery_pct: 20, retention_pct: 10, insurance_pct: 5, withholding_pct: 3, vat_pct: 9 };
  const m = statementMoney({ lines: [{ rate: 100, cumQty: 30 }, { rate: 50, cumQty: 40 }], grossPrev: 2000, terms, advancePaid: 1000, advanceRecovered: 0 });
  equal([m.grossCum, m.grossThis], [5000, 3000]);
  equal([m.advanceRecovery, m.retention, m.insurance, m.withholding, m.vat], [600, 300, 150, 90, 270]);
  equal(m.net, 3000 - 600 - 300 - 150 - 90 + 270);
  const capped = statementMoney({ lines: [{ rate: 100, cumQty: 50 }], grossPrev: 0, terms, advancePaid: 1000, advanceRecovered: 900 });
  equal(capped.advanceRecovery, 100, "never more advance recovered than is outstanding");
  const none = statementMoney({ lines: [{ rate: 100, cumQty: 10 }], terms: { ...terms, advance_recovery_pct: null }, advancePaid: 0 });
  equal(none.advanceRecovery, 0, "no advance paid, nothing to recover");
  const back = statementMoney({ lines: [{ rate: 100, cumQty: 10 }], grossPrev: 1500, terms });
  equal([back.grossThis, back.retention, back.advanceRecovery], [-500, 0, 0], "a correction downwards holds nothing back");
});

test("an item says what is wrong with it: unmeasured, no sheet, over the contract, beyond the amendment limit", async () => {
  const L = { itemNo: "1", qty: 100, unit: "m³", method: "measured", prevQty: 0 };
  equal(lineFlags({ ...L, cumQty: null })[0].level, "block");
  equal(lineFlags({ ...L, cumQty: 10, sheetRef: "" })[0].level, "block", "a measured quantity has its measurement sheet");
  equal(lineFlags({ ...L, cumQty: 110, sheetRef: "MS-1" }).map((f) => f.level), ["warn"]);
  equal(lineFlags({ ...L, cumQty: 126, sheetRef: "MS-1" }).map((f) => f.level), ["block"], "beyond 25% needs an amendment");
  equal(lineFlags({ ...L, method: "platform", cumQty: 5, prevQty: 8 }).map((f) => f.level), ["warn"], "less than last time is shown");
});

test("four eyes: submitter does not verify, verifier and preparer do not approve", async () => {
  const st = { status: "submitted", prepared_by: "A", submitted_by: "A" };
  assert(/ارسال‌کننده/.test(transitionProblem(st, "verify", { userId: "A" })));
  equal(transitionProblem(st, "verify", { userId: "B" }), null);
  const v = { status: "verified", prepared_by: "A", submitted_by: "A", verified_by: "B" };
  assert(/تأییدکنندهٔ فنی/.test(transitionProblem(v, "approve", { userId: "B" })));
  assert(/تهیه‌کننده/.test(transitionProblem(v, "approve", { userId: "A" })));
  equal(transitionProblem(v, "approve", { userId: "C" }), null);
  assert(/ارسال نمی‌شود/.test(transitionProblem({ status: "draft" }, "submit", { flags: [{ level: "block", text: "x" }] })));
  assert(transitionProblem({ status: "draft" }, "verify", { userId: "B" }), "steps are in order");
});

// ── the database ─────────────────────────────────────────────────────────

process.env.PGLITE_DIR = await scratchDir("ctr-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const contractors = await import("../../lib/db/repos/contractors.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const civil = await import("../../lib/db/repos/civil.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");
const ctl = await import("../../lib/db/repos/controls.mjs");
const ctr = await import("../../lib/db/repos/contracts.mjs");
const fin = await import("../../lib/db/repos/finance.mjs");
const hr = await import("../../lib/db/repos/hr.mjs");
const log = await import("../../lib/db/repos/log.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });   // site engineer: prepares
const bob = await projects.ensureUser(db, { subject: "kc|bob" });       // supervision: verifies
const carol = await projects.ensureUser(db, { subject: "kc|carol" });   // contracts: approves
const dave = await projects.ensureUser(db, { subject: "kc|dave" });     // finance: pays
const proj = await projects.createProject(db, { code: "CTR", name: "C", ownerUserId: alice.id });
const P = proj.id;
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let civ, fdn1, fdn2, pump, acCiv, acEqp, contract, lConcrete, lDesign, lMeasured, lLump, sub;
await withProject(db, P, async () => {
  await projects.updateProjectProfile(db, { projectId: P, patch: { contract_currency: "EUR" } });
  sub = await spine.upsertSubsystem(db, { projectId: P, code: "70-01", systemCode: "70", name: "S" });
  civ = await contractors.upsertContractor(db, { projectId: P, code: "C-CIV", name: "Civil Co", disciplines: ["civil"] });
  pump = await spine.upsertTag(db, { projectId: P, tagNo: "P-7001", discipline: "equipment", kind: "rotating", subsystemId: sub.id });
  fdn1 = await civil.upsertFoundation(db, { projectId: P, tagNo: "FDN-1", subsystemId: sub.id, concreteClass: "C30", fcMpa: 30 });
  fdn2 = await civil.upsertFoundation(db, { projectId: P, tagNo: "FDN-2", subsystemId: sub.id, concreteClass: "C30", fcMpa: 30 });
  await civil.recordPour(db, { projectId: P, tagId: fdn1.id, pourNo: "PC-1", pouredOn: daysAgo(40), volumeM3: 6, concreteClass: "C30", fcMpa: 30 });
  await civil.recordPour(db, { projectId: P, tagId: fdn2.id, pourNo: "PC-2", pouredOn: daysAgo(10), volumeM3: 10, concreteClass: "C30", fcMpa: 30 });
  acCiv = await ctl.upsertAccount(db, { projectId: P, code: "WBS-70-CIV", title: "Civil 70", bac: 100000 });
  acEqp = await ctl.upsertAccount(db, { projectId: P, code: "WBS-70-EQP", title: "Equipment 70", bac: 50000 });
  await ctl.reportProgress(db, { projectId: P, accountId: acEqp.id, asOf: daysAgo(20), pct: 40, source: "PR-1" });
  await ctl.reportProgress(db, { projectId: P, accountId: acCiv.id, asOf: daysAgo(20), pct: 50, source: "PR-1" });
});

test("a subcontract names its contractor, takes the project's currency, and is signed only with items to measure", async () => {
  await withProject(db, P, async () => {
    await throws(() => ctr.upsertContract(db, { projectId: P, contractNo: "SC-01", title: "Civil works", kind: "subcontract" }), "INVALID_INPUT");
    contract = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-01", title: "Civil works", kind: "subcontract", contractorId: civ.id,
      value: 200000, advancePct: 10, advanceRecoveryPct: 20, retentionPct: 10, insurancePct: 5, withholdingPct: 3, vatPct: 9, userId: carol.id });
    equal(contract.currency, "EUR");
    await ctr.setContractStatus(db, { projectId: P, contractId: contract.id, to: "in_review", userId: carol.id });
    const e = await throws(() => ctr.setContractStatus(db, { projectId: P, contractId: contract.id, to: "signed", userId: bob.id }), "INVALID_INPUT");
    assert(/بدون ردیف/.test(e.message), e.message);
  });
});

test("items on the WBS: measured by the platform, by the design model × progress, by a sheet, or lump sum", async () => {
  await withProject(db, P, async () => {
    // A design item that is not in the imported model is refused, not left dangling.
    await throws(() => ctr.upsertLine(db, { projectId: P, contractId: contract.id, itemNo: "2", description: "Rebar", unit: "t", qty: 5, rate: 900,
      accountId: acCiv.id, method: "design", designCode: "RB-70" }), "INVALID_INPUT");
    const imp = await ctr.importDesignQuantities(db, { projectId: P, modelRev: "B", source: "PDMS", userId: alice.id, rows: [
      { code: "RB-70", description: "Rebar unit 70", unit: "t", qty: "4.8", wbs: "WBS-70-CIV" },
      { code: "GR-70", description: "Grout", unit: "m³", qty: 1.2, wbs: "WBS-NOPE" },
      { code: "", unit: "t", qty: 1 },
    ] });
    equal([imp.imported, imp.problems.length, imp.noWbs.length], [2, 1, 1], "an unmatched WBS is named, not guessed");
    lConcrete = await ctr.upsertLine(db, { projectId: P, contractId: contract.id, itemNo: "1", description: "Concrete C30", unit: "x", qty: 20, rate: 120,
      accountId: acCiv.id, method: "platform", metric: "civil_concrete_m3", subsystemId: sub.id });
    equal(lConcrete.unit, "m³", "the unit is the metric's own");
    lDesign = await ctr.upsertLine(db, { projectId: P, contractId: contract.id, itemNo: "2", description: "Rebar", unit: "", qty: 5, rate: 900,
      accountId: acCiv.id, method: "design", designCode: "RB-70" });
    equal(lDesign.unit, "t");
    lMeasured = await ctr.upsertLine(db, { projectId: P, contractId: contract.id, itemNo: "3", description: "Excavation", unit: "m³", qty: 100, rate: 15,
      accountId: acCiv.id, method: "measured" });
    lLump = await ctr.upsertLine(db, { projectId: P, contractId: contract.id, itemNo: "4", description: "Mobilisation", unit: "LS", qty: 1, rate: 4000,
      accountId: acEqp.id, method: "lump_sum" });
    const e = await throws(() => ctr.setContractStatus(db, { projectId: P, contractId: contract.id, to: "signed", userId: carol.id }), "INVALID_INPUT");
    assert(/فرستاده/.test(e.message), "the one who sent it for review does not sign it");
    await ctr.setContractStatus(db, { projectId: P, contractId: contract.id, to: "signed", userId: bob.id });
    await throws(() => ctr.upsertLine(db, { projectId: P, contractId: contract.id, itemNo: "5", description: "x", unit: "m", qty: 1, rate: 1, method: "measured" }),
      "INVALID_INPUT", "a signed contract's items change by amendment");
  });
});

let st1;
test("statement 1 measures each item as of its period end, from where each number lives", async () => {
  await withProject(db, P, async () => {
    await throws(() => ctr.createStatement(db, { projectId: P, contractId: contract.id, periodTo: daysAgo(-3), userId: alice.id }), "INVALID_INPUT");
    st1 = await ctr.createStatement(db, { projectId: P, contractId: contract.id, periodTo: daysAgo(15), userId: alice.id });
    const d = await ctr.statementDetail(db, { projectId: P, statementId: st1.id });
    const by = Object.fromEntries(d.lines.map((l) => [l.itemNo, l]));
    equal(by["1"].cumQty, 6, "only the pour done by the period end: 6 m³, not the 10 m³ poured after it");
    equal(by["2"].cumQty, 2.4, "design 4.8 t × WBS 50%");
    equal(by["2"].evidence.design.rev, "B");
    equal(by["4"].cumQty, 0.4, "lump sum × WBS 40%");
    equal(by["3"].cumQty, null, "a measured item has no quantity until its sheet is entered");
    await throws(() => ctr.statementTransition(db, { projectId: P, statementId: st1.id, action: "submit", userId: alice.id }), "INVALID_INPUT");
    await throws(() => ctr.setMeasured(db, { projectId: P, statementId: st1.id, lineId: lConcrete.id, cumQty: 99, sheetRef: "X" }),
      "INVALID_INPUT", "a platform-measured quantity is not typed");
    await throws(() => ctr.setMeasured(db, { projectId: P, statementId: st1.id, lineId: lMeasured.id, cumQty: 40, sheetRef: "" }), "INVALID_INPUT");
    await ctr.setMeasured(db, { projectId: P, statementId: st1.id, lineId: lMeasured.id, cumQty: 40, sheetRef: "MS-70-01", userId: alice.id });
  });
});

test("submitted, verified by someone else, approved by a third — and the approval is actual cost on the WBS", async () => {
  await withProject(db, P, async () => {
    const s = await ctr.statementTransition(db, { projectId: P, statementId: st1.id, action: "submit", userId: alice.id });
    // gross = 6×120 + 2.4×900 + 40×15 + 0.4×4000 = 720 + 2160 + 600 + 1600 = 5080
    equal(s.money.grossThis, 5080);
    equal(s.money.advanceRecovery, 0, "no advance paid yet");
    equal(s.money.net, 5080 - 508 - 254 - 152.4 + 457.2);
    await throws(() => ctr.statementTransition(db, { projectId: P, statementId: st1.id, action: "verify", userId: alice.id }), "INVALID_INPUT");
    await ctr.statementTransition(db, { projectId: P, statementId: st1.id, action: "verify", userId: bob.id });
    await throws(() => ctr.statementTransition(db, { projectId: P, statementId: st1.id, action: "approve", userId: bob.id }), "INVALID_INPUT");
    await ctr.statementTransition(db, { projectId: P, statementId: st1.id, action: "approve", userId: carol.id });
    const { rows } = await db.query("SELECT a.code, sum(e.amount)::float8 AS amt FROM cost_entry e JOIN control_account a ON a.id = e.account_id GROUP BY a.code ORDER BY a.code");
    equal(rows.map((r) => [r.code, r.amt]), [["WBS-70-CIV", 3480], ["WBS-70-EQP", 1600]]);
  });
});

test("payment: never more than approved; the statement is paid when it is paid in full", async () => {
  await withProject(db, P, async () => {
    const net = 4622.8;
    await throws(() => ctr.recordPayment(db, { projectId: P, contractId: contract.id, statementId: st1.id, kind: "statement", paidOn: daysAgo(1), amount: net + 1, refNo: "TR-1", userId: dave.id }), "INVALID_INPUT");
    await ctr.recordPayment(db, { projectId: P, contractId: contract.id, statementId: st1.id, kind: "statement", paidOn: daysAgo(1), amount: 3000, refNo: "TR-1", userId: dave.id });
    let d = await ctr.statementDetail(db, { projectId: P, statementId: st1.id });
    equal(d.status, "approved");
    await ctr.recordPayment(db, { projectId: P, contractId: contract.id, statementId: st1.id, kind: "statement", paidOn: daysAgo(0), amount: net - 3000, refNo: "TR-2", userId: dave.id });
    d = await ctr.statementDetail(db, { projectId: P, statementId: st1.id });
    equal(d.status, "paid");
    await throws(() => ctr.recordPayment(db, { projectId: P, contractId: contract.id, kind: "advance", paidOn: daysAgo(0), amount: 20001, refNo: "ADV", userId: dave.id }),
      "INVALID_INPUT", "advance is capped at its percentage of the contract");
    await ctr.recordPayment(db, { projectId: P, contractId: contract.id, kind: "advance", paidOn: daysAgo(0), amount: 20000, refNo: "ADV", userId: dave.id });
  });
});

test("statement 2 is measured from statement 1, recovers the advance, and can be returned with a reason", async () => {
  await withProject(db, P, async () => {
    await throws(() => ctr.createStatement(db, { projectId: P, contractId: contract.id, periodTo: daysAgo(15), userId: alice.id }), "INVALID_INPUT",
      "a period after the last");
    const st2 = await ctr.createStatement(db, { projectId: P, contractId: contract.id, periodTo: daysAgo(0), userId: alice.id });
    const d = await ctr.statementDetail(db, { projectId: P, statementId: st2.id });
    const by = Object.fromEntries(d.lines.map((l) => [l.itemNo, l]));
    equal([by["1"].prevQty, by["1"].cumQty, by["1"].thisQty], [6, 16, 10], "the second pour is this period's");
    equal([by["3"].cumQty, by["3"].sheetRef], [40, "MS-70-01"], "a measured item carries its last sheet until a new one");
    equal(d.money.grossThis, 1200);
    equal(d.money.advanceRecovery, 240, "20% of the period, against the advance now paid");
    await ctr.statementTransition(db, { projectId: P, statementId: st2.id, action: "submit", userId: alice.id });
    await throws(() => ctr.statementTransition(db, { projectId: P, statementId: st2.id, action: "return", userId: bob.id }), "INVALID_INPUT");
    const back = await ctr.statementTransition(db, { projectId: P, statementId: st2.id, action: "return", comment: "Pour PC-2 cubes not yet broken", userId: bob.id });
    equal(back.status, "draft");
  });
});

test("finance: per contract, per WBS element and per month — certified, paid, due", async () => {
  await withProject(db, P, async () => {
    const f = await fin.financeBoard(db, { projectId: P });
    const c = f.contracts.find((x) => x.no === "SC-01");
    equal([c.certified, c.netApproved, c.advancePaid, c.due], [5080, 4622.8, 20000, 0]);
    equal(f.wbs.find((w) => w.code === "WBS-70-CIV").actual, 3480);
    assert(f.cash.some((x) => x.kind === "advance" && x.amount === 20000));
    equal(f.queue.length, 0, "the returned statement is back with its preparer, not in finance's queue");
  });
});

test("HR: one person, one row with HSE; hours only while mobilised, never over 24 a day", async () => {
  await withProject(db, P, async () => {
    const p = await hr.upsertPersonnel(db, { projectId: P, idNo: "0012345678", fullName: "Ali Rezaei", employer: "contractor", contractorId: civ.id,
      position: "Foreman", department: "Civil", mobilizedOn: daysAgo(30), userId: alice.id });
    const { rows: [same] } = await db.query("SELECT count(*)::int AS n FROM hse_person WHERE id_no = '0012345678'");
    equal(same.n, 1);
    await throws(() => hr.recordTimesheet(db, { projectId: P, personId: p.id, workDate: daysAgo(40), hours: 8 }), "INVALID_INPUT", "before mobilisation");
    await hr.recordTimesheet(db, { projectId: P, personId: p.id, workDate: daysAgo(5), hours: 10, overtime: 2, accountId: acCiv.id, userId: alice.id });
    await throws(() => hr.recordTimesheet(db, { projectId: P, personId: p.id, workDate: daysAgo(5), hours: 13, accountId: acEqp.id }), "INVALID_INPUT",
      "12 + 13 hours is more than a day");
    const b = await hr.hrBoard(db, { projectId: P });
    equal(b.headcount.total, 1);
    equal(b.byWbs.find((w) => w.wbs === "WBS-70-CIV").hours, 12);
  });
});

test("each section's log: its steps with who took them, and comments; the older sections' own signatures read in place", async () => {
  await withProject(db, P, async () => {
    const lg = await log.sectionLog(db, { projectId: P, section: "contracts" });
    const acts2 = lg.filter((e) => e.entityType === "statement").map((e) => e.action);
    for (const a of ["created", "measured", "submitted", "verified", "approved", "paid", "returned"]) assert(acts2.includes(a), `${a} is logged`);
    const approved = lg.find((e) => e.action === "approved");
    equal(approved.userId, carol.id);
    await throws(() => log.addComment(db, { projectId: P, section: "contracts", entityType: "statement", entityId: st1.id, label: "x", comment: " ", userId: bob.id }), "INVALID_INPUT");
    await log.addComment(db, { projectId: P, section: "contracts", entityType: "statement", entityId: st1.id, label: "صورت وضعیت 1", comment: "OK for payment", userId: dave.id });
    const trail = await log.sectionLog(db, { projectId: P, section: "contracts", entityId: st1.id });
    equal([trail[0].action, trail[0].userId, trail[0].comment], ["commented", dave.id, "OK for payment"]);
    const people = log.peopleOf(trail);
    assert(people.some((p) => p.comments === 1), "the commenter is among the people of the trail");
    // An older section: a pour recorded in civil is in civil's log without anyone writing it twice.
    await acts.recordActivity(db, { projectId: P, tagId: pump.id, code: "set", doneAt: daysAgo(3), userId: bob.id });
    const eq = await log.sectionLog(db, { projectId: P, section: "equipment" });
    assert(eq.some((e) => e.label.includes("P-7001") && e.userId === bob.id), "the equipment step is in its log with who recorded it");
  });
});

test("every section's derived log query runs against the schema", async () => {
  await withProject(db, P, async () => {
    for (const s of Object.keys(log.SECTION_FA)) await log.sectionLog(db, { projectId: P, section: s });
  });
});

test("the log is append-only for the application", async () => {
  await withProject(db, P, async () => {
    await db.query("SET ROLE app_rw");
    try {
      const e = await throws(() => db.query("UPDATE workflow_event SET comment = 'x'"));
      assert(/permission/i.test(e.message), e.message);
    } finally { await db.query("RESET ROLE"); }
  });
});

await run();
