#!/usr/bin/env node
/**
 * Project controls: PV read off the planner's curve, EV from a stated
 * source, no ratio over zero, no money without a currency, and a risk
 * register that sorts by P × I without inventing bands.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkBaseline, plannedPct, earnedFromCounts, evm, rollup, riskScore, riskState, heatMap,
} from "../../lib/controls/evm.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";

// ── the engine ───────────────────────────────────────────────────────────

const curve = [{ date: "2026-01-01", pct: 0 }, { date: "2026-07-01", pct: 50 }, { date: "2026-12-31", pct: 100 }];

test("PV is read off the planner's points, linearly between them", async () => {
  equal(plannedPct(curve, "2026-04-01"), 24.86, "90 of 181 days into the first leg");
  equal(plannedPct(curve, "2026-07-01"), 50);
  equal(plannedPct(curve, "2025-12-01"), 0, "before the first point");
  equal(plannedPct(curve, "2027-03-01"), 100, "after the last");
  equal(plannedPct([{ date: "2026-03-01", pct: 10 }], "2026-02-01"), 0);
});

test("a baseline that falls, overflows or repeats a date is refused", async () => {
  equal(checkBaseline(curve), []);
  assert(checkBaseline([{ date: "2026-01-01", pct: 20 }, { date: "2026-02-01", pct: 10 }]).length === 1);
  assert(checkBaseline([{ date: "2026-01-01", pct: 120 }]).length === 1);
  assert(checkBaseline([{ date: "2026-01-01", pct: 1 }, { date: "2026-01-01", pct: 2 }]).length >= 1);
  equal(plannedPct([{ date: "2026-01-01", pct: 20 }, { date: "2026-02-01", pct: 10 }], "2026-01-15"), null);
});

test("platform EV follows the project's rule of credit, and has none without it", async () => {
  equal(earnedFromCounts({ items: 10, installed: 6, tested: 2 }, 70).pct, 48);
  equal(earnedFromCounts({ items: 10, installed: 6, tested: 2 }, 100).pct, 60, "all at installed");
  equal(earnedFromCounts({ items: 10, installed: 6, tested: 2 }, null).pct, null);
  equal(earnedFromCounts({ items: 0, installed: 0, tested: 0 }, 70).pct, null);
  equal(earnedFromCounts({ items: 10, installed: 2, tested: 3 }, 70).pct, null, "tested beyond installed");
});

test("the indices, and none over a zero denominator", async () => {
  const r = evm({ bac: 1000, pvPct: 40, evPct: 30, ac: 350 });
  equal([r.spi, r.money.pv, r.money.ev, r.money.sv, r.money.cv, r.money.cpi], [0.75, 400, 300, -100, -50, 0.857]);
  equal([r.money.eac, r.money.vac, r.money.tcpi], [1166.67, -166.67, 1.077]);
  equal(evm({ bac: 1000, pvPct: 0, evPct: 0, ac: 0 }).spi, null, "nothing planned yet");
  const z = evm({ bac: 1000, pvPct: 10, evPct: 5, ac: 0 }).money;
  equal([z.cpi, z.eac], [null, null], "no cost yet is not an infinite CPI");
  equal(evm({ bac: 1000, pvPct: 10, evPct: 0, ac: 50 }).money.eac, null, "no EV, no forecast");
  equal(evm({ bac: 1000, pvPct: 10, evPct: 5, ac: 1000 }).money.tcpi, null, "budget spent: TCPI undefined");
  equal(evm({ bac: 1000, pvPct: 10, evPct: 5, ac: 1200 }).money.tcpi, null, "overspent: no efficiency can recover it");
});

test("without a BAC there is no money, but SPI still stands", async () => {
  const r = evm({ bac: null, pvPct: 40, evPct: 30, ac: 350 });
  equal([r.spi, r.money], [0.75, null]);
});

test("the roll-up weights by budget and names what it left out", async () => {
  const a = { code: "A", ...evm({ bac: 1000, pvPct: 50, evPct: 50, ac: 400 }) };
  const b = { code: "B", ...evm({ bac: 3000, pvPct: 50, evPct: 25, ac: 900 }) };
  const c = { code: "C", ...evm({ bac: null, pvPct: 50, evPct: 0, ac: null }) };
  const r = rollup([a, b, c]);
  equal([r.money.bac, r.money.pv, r.money.ev, r.money.ac, r.spi], [4000, 2000, 1250, 1300, 0.625]);
  equal(r.excluded, ["C"]);
  const d = { code: "D", ...evm({ bac: 500, pvPct: 50, evPct: 50, ac: null }) };
  equal(rollup([a, d]).excluded, ["D"], "a budget with no cost figure is not a zero cost");
});

test("risk: P × I on 1–5, overdue past its date, open without a response", async () => {
  equal([riskScore(4, 5), riskScore(0, 3), riskScore(2.5, 2), riskScore(6, 1)], [20, null, null, null]);
  equal(riskState({ status: "open", response: "x", dueOn: "2026-09-01" }, "2026-09-02"), "overdue");
  equal(riskState({ status: "open", response: null }, "2026-09-02"), "no_response");
  equal(riskState({ status: "closed", dueOn: "2020-01-01" }, "2026-09-02"), "closed");
  const g = heatMap([{ status: "open", probability: 4, impact: 5 }, { status: "closed", probability: 4, impact: 5 },
    { status: "open", probability: 4, impact: 5, residualP: 2, residualI: 3 }]);
  equal(g[3][4], 2);
  equal(heatMap([{ status: "open", probability: 4, impact: 5, residualP: 2, residualI: 3 }], "residual")[1][2], 1);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "ctl-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runs = await import("../../lib/db/repos/runs.mjs");
const ctl = await import("../../lib/db/repos/controls.mjs");
const { missingInformation } = await import("../../lib/db/repos/assumptions.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "C130", name: "C130", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "O", ownerUserId: alice.id });
const P = proj.id;
const TODAY = new Date().toISOString().slice(0, 10);
const shift = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
let civ, pip;

await withProject(db, P, async () => {
  const { rows: [line] } = await db.query("INSERT INTO line (project_id, line_no) VALUES ($1,'10-P-101') RETURNING id", [P]);
  const { rows: [doc] } = await db.query(
    `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
     VALUES ($1,'ISO-1','0',$2,'local://x') RETURNING id`, [P, "f".repeat(64)]);
  const model = buildModel(DEMO, {});
  const r = await runs.createRun(db, { projectId: P, documentId: doc.id, lineId: line.id, payload: DEMO, validationChecks: model.checks });
  await runs.saveRegister(db, { projectId: P, runId: r.id, documentId: doc.id, lineId: line.id, model });
});

test("no budget and no cost without a contract currency, and the missing list says so", async () => {
  await withProject(db, P, async () => {
    const e = await throws(() => ctl.upsertAccount(db, { projectId: P, code: "cw-civ", title: "Civil works", bac: 1000 }), "INVALID_INPUT");
    assert(/ارز/.test(e.message));
    civ = await ctl.upsertAccount(db, { projectId: P, code: "cw-civ", title: "Civil works" });
    equal(civ.code, "CW-CIV");
    await throws(() => ctl.postCost(db, { projectId: P, accountId: civ.id, postedOn: TODAY, amount: 5, refNo: "INV-1" }), "INVALID_INPUT");
    assert((await missingInformation(db, { projectId: P })).some((m) => m.key === "ctl-currency"));
    await projects.updateProjectProfile(db, { projectId: P, patch: { contract_currency: "EUR" } });
    civ = await ctl.upsertAccount(db, { projectId: P, code: "CW-CIV", title: "Civil works", bac: 1_000_000 });
  });
});

test("a baseline is issued whole, with a revision and a reason, and the old one stays readable", async () => {
  await withProject(db, P, async () => {
    const pts = [{ date: shift(-100), pct: 0 }, { date: shift(0), pct: 40 }, { date: shift(100), pct: 100 }];
    await throws(() => ctl.setBaseline(db, { projectId: P, accountId: civ.id, points: pts, revision: "A" }), "INVALID_INPUT");
    await throws(() => ctl.setBaseline(db, { projectId: P, accountId: civ.id, revision: "A", reason: "x",
      points: [{ date: shift(-10), pct: 30 }, { date: shift(0), pct: 20 }] }), "INVALID_INPUT");
    await ctl.setBaseline(db, { projectId: P, accountId: civ.id, points: pts, revision: "A", reason: "IFC schedule" });
    await ctl.setBaseline(db, { projectId: P, accountId: civ.id, revision: "B", reason: "Change order CO-3",
      points: [{ date: shift(-100), pct: 0 }, { date: shift(0), pct: 40 }, { date: shift(200), pct: 100 }] });
    const h = await ctl.baselineHistory(db, { projectId: P, accountId: civ.id });
    equal([h.length, h[0].points[2].pct, h[1].revision], [2, 100, "B"]);
    await throws(() => db.query("UPDATE control_baseline_revision SET reason = 'x'"), "permission denied");
  });
});

test("manual EV is the latest report on or before the data date", async () => {
  await withProject(db, P, async () => {
    await ctl.reportProgress(db, { projectId: P, accountId: civ.id, asOf: shift(-20), pct: 25, source: "PR-W30" });
    await ctl.reportProgress(db, { projectId: P, accountId: civ.id, asOf: shift(-5), pct: 30, source: "PR-W32" });
    await ctl.postCost(db, { projectId: P, accountId: civ.id, postedOn: shift(-30), amount: 250_000, refNo: "INV-101" });
    await ctl.postCost(db, { projectId: P, accountId: civ.id, postedOn: shift(-3), amount: 100_000, refNo: "INV-117" });
    let b = await ctl.controlsBoard(db, { projectId: P });
    let a = b.accounts[0];
    equal([a.pvPct, a.ev.pct, a.ev.detail.source, a.ac], [40, 30, "PR-W32", 350_000]);
    equal([a.spi, a.money.cpi, a.money.cv], [0.75, 0.857, -50_000]);
    b = await ctl.controlsBoard(db, { projectId: P, asOf: shift(-10) });
    a = b.accounts[0];
    equal([a.ev.pct, a.ac], [25, 250_000], "a report or invoice after the data date does not count");
    await projects.updateProjectProfile(db, { projectId: P, patch: { contract_currency: "" } });
    a = (await ctl.controlsBoard(db, { projectId: P })).accounts[0];
    equal([a.money, a.spi], [null, 0.75], "the currency withdrawn: the BAC stays stored but is not money");
    await projects.updateProjectProfile(db, { projectId: P, patch: { contract_currency: "EUR" } });
  });
});

test("cost is corrected by a reversal with its reason, never edited, never below zero", async () => {
  await withProject(db, P, async () => {
    await throws(() => ctl.postCost(db, { projectId: P, accountId: civ.id, postedOn: TODAY, amount: -100_000, refNo: "CN-1" }), "INVALID_INPUT");
    await throws(() => ctl.postCost(db, { projectId: P, accountId: civ.id, postedOn: TODAY, amount: -400_000,
      refNo: "CN-1", note: "credit note" }), "INVALID_INPUT");
    await ctl.postCost(db, { projectId: P, accountId: civ.id, postedOn: TODAY, amount: -50_000, refNo: "CN-1", note: "INV-117 billed twice" });
    equal((await ctl.controlsBoard(db, { projectId: P })).accounts[0].ac, 300_000);
    await throws(() => db.query("UPDATE cost_entry SET amount = 1"), "permission denied");
    await throws(() => db.query("DELETE FROM cost_entry"), "permission denied");
  });
});

test("platform EV counts the discipline's items under the rule of credit, and refuses a manual report", async () => {
  await withProject(db, P, async () => {
    pip = await ctl.upsertAccount(db, { projectId: P, code: "CW-PIP", title: "Piping", bac: 2_000_000,
      evMethod: "platform", evDiscipline: "piping" });
    await ctl.setBaseline(db, { projectId: P, accountId: pip.id, revision: "A", reason: "IFC",
      points: [{ date: shift(-50), pct: 0 }, { date: shift(50), pct: 100 }] });
    let a = (await ctl.controlsBoard(db, { projectId: P })).accounts.find((x) => x.code === "CW-PIP");
    equal(a.ev.pct, null);
    assert(/اعتباردهی/.test(a.ev.reason));
    await ctl.upsertAccount(db, { projectId: P, code: "CW-PIP", title: "Piping", bac: 2_000_000,
      evMethod: "platform", evDiscipline: "piping", creditInstalledPct: 70 });
    const c = await ctl.platformCounts(db, { projectId: P, discipline: "piping" });
    assert(c.items > 0, "the demo drawing's welds are counted");
    // Two welds done — the execution rows are what makes a weld "installed".
    await db.query(`INSERT INTO weld_execution (project_id, weld_uid, welded_at)
      SELECT project_id, weld_uid, $2 FROM weld WHERE project_id = $1 ORDER BY weld_no LIMIT 2`, [P, TODAY]);
    const c2 = await ctl.platformCounts(db, { projectId: P, discipline: "piping" });
    a = (await ctl.controlsBoard(db, { projectId: P })).accounts.find((x) => x.code === "CW-PIP");
    equal(c2.installed, 2);
    equal(a.ev.pct, Math.round((2 * 70 / c2.items) * 100) / 100);
    equal(a.ev.detail, c2);
    equal((await ctl.controlsBoard(db, { projectId: P, asOf: shift(-1) })).accounts.find((x) => x.code === "CW-PIP").ev.pct,
      null, "the platform count is today's; it is not back-dated (no snapshot yet)");
    await throws(() => ctl.reportProgress(db, { projectId: P, accountId: pip.id, asOf: TODAY, pct: 50, source: "x" }), "INVALID_INPUT");
    await throws(() => ctl.upsertAccount(db, { projectId: P, code: "X", title: "x", evMethod: "platform", evDiscipline: "equipment" }),
      "INVALID_INPUT", "the platform does not count equipment items as installed/tested");
  });
});

test("the risk register sorts by score, and residual needs a response", async () => {
  await withProject(db, P, async () => {
    await throws(() => ctl.upsertRisk(db, { projectId: P, code: "R-1", title: "x", probability: 6, impact: 1 }), "INVALID_INPUT");
    await throws(() => ctl.upsertRisk(db, { projectId: P, code: "R-1", title: "x", probability: 3, impact: 3,
      residualP: 1, residualI: 1 }), "INVALID_INPUT");
    await ctl.upsertRisk(db, { projectId: P, code: "r-1", title: "Late furnace coils", probability: 3, impact: 5,
      response: "Expedite at mill", dueOn: shift(-2) });
    await ctl.upsertRisk(db, { projectId: P, code: "R-2", title: "Sandstorm season", probability: 4, impact: 2 });
    const r3 = await ctl.upsertRisk(db, { projectId: P, code: "R-3", title: "Crane availability", probability: 5, impact: 4,
      response: "Second crane on call-off", dueOn: shift(10), residualP: 2, residualI: 4 });
    let list = await ctl.listRisks(db, { projectId: P, today: TODAY });
    equal(list.map((r) => [r.code, r.score, r.state]), [["R-3", 20, "open"], ["R-1", 15, "overdue"], ["R-2", 8, "no_response"]]);
    await ctl.closeRisk(db, { projectId: P, riskId: r3.id, closedOn: TODAY });
    list = await ctl.listRisks(db, { projectId: P, today: TODAY });
    equal(list.map((r) => r.code), ["R-1", "R-2", "R-3"], "closed goes last");
    const b = await ctl.controlsBoard(db, { projectId: P });
    equal([b.heat.inherent[2][4], b.heat.inherent[4][3]], [1, 0]);
  });
});

test("controls belong to one project", async () => {
  await withProject(db, other.id, async () => {
    const b = await ctl.controlsBoard(db, { projectId: other.id });
    equal([b.accounts.length, b.risks.length], [0, 0]);
  });
});

await run();
