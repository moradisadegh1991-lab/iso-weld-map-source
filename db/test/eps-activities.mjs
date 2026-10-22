#!/usr/bin/env node
/**
 * EPS round 2 (owner's «PMS» document, 2026-10-16): PMS type and the one
 * master plan, template changes pushed onto the WBS, relations without
 * loops, free float, activity codes, roles and their cost, the delay claim
 * against the master plan, and the work done each day entered into the
 * contract's daily report through its workflow.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import * as ea from "../../lib/eps/activities.mjs";
import * as w from "../../lib/eps/wbs.mjs";

// ── the rules ────────────────────────────────────────────────────────────

test("relations: a loop is refused however long; free float from the planned dates by relation type", async () => {
  const rels = [{ pred_id: "a", succ_id: "b" }, { pred_id: "b", succ_id: "c" }];
  equal([ea.closesLoop(rels, "c", "a"), ea.closesLoop(rels, "a", "c"), ea.closesLoop(rels, "x", "x")], [true, false, true]);
  const act = { plan_start: "2026-01-01", plan_end: "2026-01-10" };
  equal(ea.freeFloat(act, [{ rel_type: "FS", lag: 0, succ: { plan_start: "2026-01-14", plan_end: "2026-01-20" } }]), 3, "11, 12, 13 free before the 14th");
  equal(ea.freeFloat(act, [{ rel_type: "FS", lag: 2, succ: { plan_start: "2026-01-14" } }, { rel_type: "SS", lag: 0, succ: { plan_start: "2026-01-03" } }]), 1, "the least of them");
  equal(ea.freeFloat(act, [{ rel_type: "FF", lag: 0, succ: { plan_end: "2026-01-12" } }]), 2);
  equal([ea.freeFloat(act, []), ea.freeFloat({ plan_start: null, plan_end: null }, [{ rel_type: "FS", succ: { plan_start: "2026-01-01" } }])], [null, null],
    "no successor, or a missing date: unknown");
});

test("quantity done: a number, the remaining work or a percentage of the volume — never past the volume, never from an unknown one", async () => {
  equal(ea.qtyFrom("number", "12.5", { volume: 100, done: 10 }), { qty: 12.5 });
  equal(ea.qtyFrom("percent", 25, { volume: 80, done: 0 }), { qty: 20 });
  equal(ea.qtyFrom("remain", null, { volume: 80, done: 50 }), { qty: 30 });
  assert(ea.qtyFrom("number", 31, { volume: 80, done: 50, code: "A1" }).problem.includes("بیش از حجم"));
  assert(ea.qtyFrom("percent", 10, { volume: null }).problem.includes("حجم واقعی"), "a percentage of an unknown volume is not guessed");
  assert(ea.qtyFrom("remain", null, { volume: 80, done: 80 }).problem.includes("باقی نمانده"));
  assert(ea.qtyFrom("number", 0, { volume: 80 }).problem);
  equal(ea.qtyFrom("number", 500, { volume: null }), { qty: 500 }, "a number with no volume to hold it against is taken as typed");
  equal(ea.progressOf({ volumeActual: 200 }, 50), { done: 50, remain: 150, pct: 25 });
  equal(ea.progressOf({ volumeActual: null }, 50), { done: 50, remain: null, pct: null });
});

test("work front: the plan spread over the planned days, the work done each day, both cumulative as quantity, % and cost", async () => {
  const act = { plan_start: "2026-03-01", plan_end: "2026-03-04", volumePlan: 40, volumeActual: 40, budgetPlan: 1000 };
  const f = ea.workFront(act, { "2026-03-02": 10, "2026-03-03": 6, "2026-03-07": 4 });
  equal([f.days, f.perDay, f.rows.length], [4, 10, 5], "a day of work outside the plan is shown too");
  const r = Object.fromEntries(f.rows.map((x) => [x.date, x]));
  equal([r["2026-03-03"].planCum, r["2026-03-03"].planPct, r["2026-03-03"].doneCum, r["2026-03-03"].doneCumPct, r["2026-03-03"].cost, r["2026-03-03"].costCum],
    [30, 75, 16, 40, 150, 400]);
  equal([r["2026-03-07"].inPlan, r["2026-03-07"].plan, r["2026-03-07"].doneCum], [false, 0, 20]);
});

test("the planned curve of a WBS node: each activity's plan spread over its days, rolled up by W.F; nothing planned → unknown, not zero", async () => {
  const node = { activities: [{ wf: 60, plan_start: "2026-03-01", plan_end: "2026-03-10" }, { wf: 40, plan_start: "2026-03-06", plan_end: "2026-03-15" }] };
  equal([ea.plannedPctAt(node, "2026-02-28"), ea.plannedPctAt(node, "2026-03-05"), ea.plannedPctAt(node, "2026-03-10"), ea.plannedPctAt(node, "2026-03-20")],
    [0, 30, 80, 100], "5 of 10 days of the first (60 × 0.5); then 60 + 40 × 0.5");
  equal(ea.plannedPctAt({ children: [{ wf: 50, ...node }, { wf: 50, activities: [{ wf: 100 }] }] }, "2026-03-10"), 40, "a child with no dates adds nothing");
  equal(ea.plannedPctAt({ activities: [{ wf: 100 }] }, "2026-03-10"), null);
  equal(ea.plannedCurve(node).map((p) => [p.date, p.pct]), [["2026-02-28", 0], ["2026-03-05", 30], ["2026-03-10", 80], ["2026-03-15", 100]]);
});

test("roles, delays, the tree filter and the code summary", async () => {
  equal(ea.roleCost({ budget_unit: "hour", per_day: 8, rate: 50, actual_time: 30 }, { planDays: 5 }), { totalTime: 40, totalPrice: 2000, actualTime: 30, actualPrice: 1500 });
  equal(ea.roleCost({ budget_unit: "unit", per_day: 3, rate: 10 }, { planDays: 5 }).totalPrice, 30, "a lump quantity is not spread over the days");
  const d = ea.delayRow({ accept_finish: "2026-02-15" }, { actual_start: "2026-01-05", actual_end: "2026-02-20" }, { plan_start: "2026-01-01", plan_end: "2026-02-10", planDays: 41 });
  equal([d.startDelay, d.finishDelay, d.delay, d.acceptDelay], [4, 10, 10, 5]);
  equal([ea.delayRow({}, { actual_start: "2026-01-05" }, null).startDelay], [null], "no master plan: no baseline, no delay figure");
  const f = ea.filterTree([{ id: "r", text: "PM01" }, { id: "n", parentId: "r", text: "Civil" }, { id: "a", parentId: "n", text: "Excavation" }, { id: "b", parentId: "r", text: "Piping" }], "exca");
  equal([[...f.matches], [...f.visible].sort()], [["a"], ["a", "n", "r"]], "a match keeps every row above it");
  const g = ea.filterTree([{ id: "r", text: "PM01" }, { id: "n", parentId: "r", text: "Civil" }, { id: "a", parentId: "n", text: "Excavation" },
    { id: "a2", parentId: "a", text: "Trench" }, { id: "b", parentId: "r", text: "Piping" }], "civil");
  equal([...g.visible].sort(), ["a", "a2", "n", "r"], "and every row under it: a matched branch shows whole (owner's requirements 2026-10-18, item 10)");
  equal(ea.splitHits("Excavation & excavation", "exca").filter((x) => x.hit).length, 2);
  const s = ea.codeSummary([{ id: "c1", code: "EX" }], [{ id: "a", codeIds: ["c1"], volumePlan: 100, volumeActual: 120 }, { id: "b", codeIds: [], volumeActual: 5 }],
    [{ activityId: "a", qty: 30, areaId: "k1" }, { activityId: "a", qty: 6, areaId: "k2" }, { activityId: "b", qty: 5, areaId: "k1" }]);
  equal([s[0].plan, s[0].actual, s[0].done, s[0].remain, s[0].pct, s[0].byArea], [100, 120, 36, 84, 30, { k1: 30, k2: 6 }]);
  const m = ea.daysMatrix([{ activityId: "a", date: "2026-01-01", qty: 2 }, { activityId: "a", date: "2026-01-02", qty: 3 }, { activityId: "a", date: "2026-01-03", qty: 9 }], ["2026-01-01", "2026-01-02"]);
  equal(m.get("a"), { byDay: { "2026-01-01": 2, "2026-01-02": 3 }, total: 5 });
});

test("the multi-day columns: before, to date and current, planned and done, SPI as done ÷ planned and VAR as planned − done", () => {
  // worked by hand from the owner's definitions (requirements 2026-10-18, item 6), not from this code:
  //   a: plan 1–10 Jan, 100 units, 10 a day, W.F 60 · done 12 on the 3rd, 8 on the 4th, 5 on the 6th
  //   b: plan 1–5 Jan, 50 units, 10 a day, W.F 40 · done 20 on the 4th
  //   chosen days: the 4th and 5th → to date = up to the 5th; current = the 4th and 5th; before = the rest
  const a = { id: "a", wf: 60, plan_start: "2026-01-01", plan_end: "2026-01-10", volumePlan: 100, volumeActual: 100 };
  const b = { id: "b", wf: 40, plan_start: "2026-01-01", plan_end: "2026-01-05", volumePlan: 50, volumeActual: 50 };
  const c = { id: "c", wf: 0, plan_start: "2026-01-01", plan_end: "2026-01-05", volumePlan: 5, volumeActual: 5, scope: { discipline: "piping" } };
  const lines = [{ activityId: "a", date: "2026-01-03", qty: 12 }, { activityId: "a", date: "2026-01-04", qty: 8 }, { activityId: "a", date: "2026-01-06", qty: 5 },
    { activityId: "b", date: "2026-01-04", qty: 20 }];
  const p = ea.periodColumns([{ id: "n", activities: [a, b, c], children: [] }], lines, ["2026-01-05", "2026-01-04"]);
  const pick = (x, ks) => ks.map((k) => x[k]);
  const K = ["LWP", "LWA", "TWP", "TWA", "LPP", "LPA", "TPP", "TPA", "TSPI", "VAR", "CPP", "CPA", "CWP", "CWA", "CSPI"];
  equal(pick(p.get("a"), K), [30, 12, 50, 20, 30, 12, 50, 20, 40, 30, 20, 8, 20, 8, 40]);
  equal(p.get("a").byDay, { "2026-01-04": { p: 10, ac: 8 }, "2026-01-05": { p: 10, ac: 0 } }, "the plan puts 10 on each day; 8 done on the 4th, none on the 5th");
  equal(pick(p.get("b"), K), [30, 0, 50, 20, 60, 0, 100, 40, 40, 60, 40, 40, 20, 20, 100]);
  equal(pick(p.get("n"), ["LPP", "LPA", "TPP", "TPA", "TSPI", "VAR", "CPP", "CPA", "CSPI"]), [42, 7.2, 70, 28, 40, 42, 28, 20.8, 74.29],
    "the node rolls the percentages up by W.F; quantities in different units are not added");
  equal(pick(p.get("c"), ["TWP", "TWA", "TPA", "TSPI"]), [5, null, null, null], "done from the platform's records has no day: unknown, not zero");
  equal(ea.periodColumns([{ id: "n", activities: [{ id: "d", wf: 100 }], children: [] }], [], ["2026-01-04"]).get("d").TSPI, null, "no planned dates: no SPI");
});

test("the daily report's work-done section: an activity of the contract, a company of the contract, a quantity above zero", async () => {
  const cd = await import("../../lib/reports/contract-daily.mjs");
  const ok = { activityIds: new Set(["a1"]), areaIds: new Set(["k1"]) };
  const p = (row) => cd.checkContent({ activities: [{ base: row }] }, ok).problems;
  equal(p({ activityId: "a1", areaId: "k1", qty: 3 }), []);
  assert(p({ activityId: "zz", qty: 3 }).some((x) => x.includes("WBS این قرارداد")));
  assert(p({ activityId: "a1", areaId: "k9", qty: 3 }).some((x) => x.includes("شرکت‌های این قرارداد")));
  assert(p({ activityId: "a1", qty: 0 }).some((x) => x.includes("بزرگ‌تر از صفر")));
  equal(cd.copyFrom({ activities: [{ id: "x", base: { activityId: "a1", qty: 3 }, stages: {} }] }).activities, [], "a day's work is not copied into the next day's report");
});

test("an activity's own dates and volumes stand over its node's; blank, it reads the node", async () => {
  const t = w.computeTree({ version: { budget_plan: 100 }, settings: w.DEFAULT_SETTINGS,
    nodes: [{ id: "N", code: "N", seq: 1, wf: 100, volume_actual: 50, plan_start: "2026-01-01", plan_end: "2026-01-31" }],
    activities: [{ id: "x", node_id: "N", code: "N.01", wf: 50, plan_start: "2026-01-10", plan_end: "2026-01-12", volume_actual: 7 }, { id: "y", node_id: "N", code: "N.02", wf: 50 }] });
  const [x, y] = t.byId.get("N").activities;
  equal([x.plan_start, x.planDays, x.volumeActual, x.own.plan_start], ["2026-01-10", 3, 7, "2026-01-10"]);
  equal([y.plan_start, y.planDays, y.volumeActual, y.own.plan_start], ["2026-01-01", 31, 50, null]);
});

// ── in the database ──────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("eps-act-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const ctr = await import("../../lib/db/repos/contracts.mjs");
const eps = await import("../../lib/db/repos/eps.mjs");
const act = await import("../../lib/db/repos/eps-activities.mjs");
const rp = await import("../../lib/db/repos/reports.mjs");
const cr = await import("../../lib/db/repos/contract-reports.mjs");
const res = await import("../../lib/db/repos/resources.mjs");
const db = await getDb();
const U = {};
for (const k of ["planner", "sup", "client", "outsider"]) U[k] = await projects.ensureUser(db, { subject: `kc|ea-${k}`, displayName: k });
const P = (await projects.createProject(db, { code: "EA1", name: "E", ownerUserId: U.planner.id })).id;
for (const k of ["sup", "client", "outsider"]) await projects.addMember(db, { projectId: P, userId: U[k].id, role: "engineer" });
const inP = (fn) => withProject(db, P, fn);
const today = new Date().toISOString().slice(0, 10);
let C, C2, PM, PM2, V1, V2, VB, N, ACTS, T, TA, K1, K2, R;

const view = (versionId = V1.id) => inP(() => act.activityView(db, { projectId: P, versionId }));
const plan = await import("../../lib/db/repos/planning.mjs");
const flat = (v) => { const out = []; const walk = (n) => { out.push(...n.activities); n.children.forEach(walk); }; v.roots.forEach(walk); return out; };

await inP(async () => {
  const { rows: [k] } = await db.query("INSERT INTO contractor (project_id, code, name) VALUES ($1, 'K', 'K') RETURNING id", [P]);
  C = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-1", title: "x", kind: "subcontract", contractorId: k.id, currency: "USD", userId: U.planner.id });
  C2 = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-2", title: "y", kind: "subcontract", contractorId: k.id, currency: "USD", userId: U.planner.id });
  ({ rows: [K1] } = await db.query("INSERT INTO company (code, name) VALUES ('AZM', 'آزمون فلز') RETURNING *"));
  ({ rows: [K2] } = await db.query("INSERT INTO company (code, name) VALUES ('OMR', 'عمران سازه') RETURNING *"));
  await db.query("INSERT INTO contract_stakeholder (project_id, contract_id, company_id, role) VALUES ($1,$2,$3,'subcontractor')", [P, C.id, K1.id]);
  T = await eps.saveTemplate(db, { projectId: P, code: "T-EX", name: "خاکبرداری" });
  TA = [await eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, name: "خاکبرداری", wf: 60 }),
    await eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, name: "تسطیح", wf: 30 })];
});

test("a PMS has a type and a description; one version of a PMS is its master plan — choosing another moves it", async () => {
  await inP(async () => {
    PM = await eps.savePms(db, { projectId: P, contractId: C.id, code: "PM01", title: "اجرا", pmsType: "Level 3", description: "برنامهٔ اجرایی", userId: U.planner.id });
    equal([PM.pms_type, PM.description], ["Level 3", "برنامهٔ اجرایی"]);
    V1 = await eps.saveVersion(db, { projectId: P, pmsId: PM.id, code: "PM01-R0", title: "پایه", budgetPlan: 1000, userId: U.planner.id });
    V2 = await eps.saveVersion(db, { projectId: P, pmsId: PM.id, code: "PM01-R1", title: "بازنگری", budgetPlan: 1000, userId: U.planner.id });
    await eps.setMaster(db, { projectId: P, id: V1.id, userId: U.planner.id });
    await eps.setMaster(db, { projectId: P, id: V2.id, userId: U.planner.id });
    const board = await eps.epsBoard(db, { projectId: P, contractId: C.id });
    equal(board[0].versions.map((v) => [v.code, v.master]), [["PM01-R0", false], ["PM01-R1", true]]);
    await throws(() => db.query("UPDATE eps_version SET master = true WHERE id = $1", [V1.id]), "eps_version_one_master", "the database holds it too");
    await eps.setMaster(db, { projectId: P, id: V1.id, userId: U.planner.id });
    // a second PMS of the contract: a tree of its own (the WBS is the PMS's, 083)
    PM2 = await eps.savePms(db, { projectId: P, contractId: C.id, code: "PM02", title: "دوم", userId: U.planner.id });
    VB = await eps.saveVersion(db, { projectId: P, pmsId: PM2.id, code: "PM02-R0", title: "پایه", userId: U.planner.id });
  });
});

test("template changes pushed onto the WBS: names, W.F and numbers follow; new template activities reach the nodes that took the template; a push that breaks 100% is refused whole", async () => {
  await inP(async () => {
    N = await eps.saveNode(db, { projectId: P, versionId: V1.id, name: "سیویل", wf: 100, volumeActual: 200, volumePlan: 180, unit: "m3",
      planStart: "2026-01-01", planEnd: "2026-01-20", budgetPlan: 1000 });
    const N2 = await eps.saveNode(db, { projectId: P, pmsId: PM2.id, name: "سیویل", wf: 100, volumeActual: 200, planStart: "2026-01-01", planEnd: "2026-01-15" });
    await eps.attachTemplate(db, { projectId: P, nodeId: N.id, templateId: T.id });
    await eps.attachTemplate(db, { projectId: P, nodeId: N2.id, templateId: T.id });
    await eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, id: TA[0].id, number: 5, name: "خاکبرداری با بیل", wf: 55 });
    await eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, name: "حمل", wf: 10 });
    const dry = await eps.syncTemplate(db, { projectId: P, templateId: T.id, dryRun: true, userId: U.planner.id });
    equal([dry.updated, dry.added], [2, 2]);
    equal(flat(await view()).map((a) => a.name).sort(), ["تسطیح", "خاکبرداری"].sort(), "a dry run writes nothing");
    await eps.syncTemplate(db, { projectId: P, templateId: T.id, userId: U.planner.id });
    equal(flat(await view()).map((a) => [a.code, a.name, a.wf]).sort(),
      [["PM01.C.01.02", "تسطیح", 30], ["PM01.C.01.05", "خاکبرداری با بیل", 55], ["PM01.C.01.06", "حمل", 10]]);
    equal(flat(await view(V2.id)).map((a) => a.id).sort(), flat(await view()).map((a) => a.id).sort(), "the PMS's two versions read one tree");
    const hand = await eps.saveActivity(db, { projectId: P, nodeId: N.id, name: "دستی", wf: 5 });
    await eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, id: TA[1].id, name: "تسطیح", wf: 35 });
    await throws(() => eps.syncTemplate(db, { projectId: P, templateId: T.id, userId: U.planner.id }), "بیش از ۱۰۰٪", "55 + 35 + 10 and the 5 by hand");
    equal(flat(await view(VB.id)).find((a) => a.name === "تسطیح").wf, 30, "refused whole: not even the other PMS's tree, which would hold, was written");
    await eps.removeActivity(db, { projectId: P, id: hand.id });
    await eps.syncTemplate(db, { projectId: P, templateId: T.id, userId: U.planner.id });
    ACTS = Object.fromEntries(flat(await view()).map((a) => [a.name, a]));
    equal(ACTS["تسطیح"].wf, 35);
  });
});

test("relations: within one PMS, no loops; free float shows in the view", async () => {
  await inP(async () => {
    const [a, b, c] = [ACTS["خاکبرداری با بیل"], ACTS["حمل"], ACTS["تسطیح"]];
    await eps.saveActivity(db, { projectId: P, nodeId: N.id, id: a.id, name: a.name, wf: a.wf, planStart: "2026-01-01", planEnd: "2026-01-05" });
    await eps.saveActivity(db, { projectId: P, nodeId: N.id, id: b.id, name: b.name, wf: b.wf, planStart: "2026-01-09", planEnd: "2026-01-12" });
    await act.saveRelation(db, { projectId: P, predId: a.id, succId: b.id, relType: "FS", lag: 1, userId: U.planner.id });
    await act.saveRelation(db, { projectId: P, predId: b.id, succId: c.id, relType: "SS", userId: U.planner.id });
    await throws(() => act.saveRelation(db, { projectId: P, predId: c.id, succId: a.id, userId: U.planner.id }), "حلقه");
    await throws(() => act.saveRelation(db, { projectId: P, predId: a.id, succId: b.id, userId: U.planner.id }), "هست");
    const other = flat(await view(VB.id))[0];
    await throws(() => act.saveRelation(db, { projectId: P, predId: a.id, succId: other.id, userId: U.planner.id }), "یک PMS");
    const v = flat(await view());
    equal(v.find((x) => x.id === a.id).freeFloat, 2, "6, 7 free: the 8th is the lag, the 9th the successor's start");
    equal((await view()).relations.length, 2);
  });
});

test("activity codes of the contract: given to activities of the same contract only; an invalid code is not given; one in use is not deleted", async () => {
  await inP(async () => {
    const ex = await act.saveCode(db, { projectId: P, contractId: C.id, code: "6002/0101/0001", name: "Excavation", categories: ["Construction", "Civil", "", "Excavation"], unit: "m3" });
    equal(ex.categories, ["Construction", "Civil", "", "Excavation"]);
    const dead = await act.saveCode(db, { projectId: P, contractId: C.id, code: "OLD", name: "x", valid: false });
    const foreign = await act.saveCode(db, { projectId: P, contractId: C2.id, code: "F", name: "y" });
    await throws(() => act.saveCode(db, { projectId: P, contractId: C.id, code: "6002/0101/0001", name: "z" }), "هست");
    await act.assignCode(db, { projectId: P, activityIds: [ACTS["خاکبرداری با بیل"].id, ACTS["حمل"].id], codeId: ex.id });
    await throws(() => act.assignCode(db, { projectId: P, activityIds: [ACTS["حمل"].id], codeId: dead.id }), "معتبر نیست");
    await throws(() => act.assignCode(db, { projectId: P, activityIds: [ACTS["حمل"].id], codeId: foreign.id }), "قرارداد دیگری");
    await throws(() => act.removeCode(db, { projectId: P, id: ex.id }), "2 فعالیت");
    equal(flat(await view()).filter((a) => a.codeIds.includes(ex.id)).length, 2);
  });
});

test("roles: a resource of the activity's contract, cost over the activity's planned days", async () => {
  await inP(async () => {
    const welder = await res.upsertResource(db, { projectId: P, contractId: C.id, kind: "person", name: "کارگر" });
    const alien = await res.upsertResource(db, { projectId: P, contractId: C2.id, kind: "person", name: "بنا" });
    const a = ACTS["خاکبرداری با بیل"];
    await throws(() => act.saveRole(db, { projectId: P, activityId: a.id, resourceId: alien.id }), "همین قرارداد");
    await act.saveRole(db, { projectId: P, activityId: a.id, resourceId: welder.id, budgetUnit: "hour", perDay: 8, rate: 100, actualTime: 20 });
    const d = await act.activityDetail(db, { projectId: P, activityId: a.id });
    equal([d.roles[0].totalTime, d.roles[0].totalPrice, d.roles[0].actualPrice], [40, 4000, 2000], "8 h × 5 days × 100");
  });
});

test("work done enters the contract's daily report through its workflow: number, % or remaining; never past the volume; a later stage writes its own row", async () => {
  await inP(async () => {
    const type = await cr.ensureType(db, { projectId: P });
    const wfl = await rp.workflowOf(db, { projectId: P, reportTypeId: type.id });
    const g = (seq) => wfl.find((s) => s.seq === seq).groups[0].id;
    await rp.setGroupMember(db, { projectId: P, groupId: g(1), userId: U.planner.id, permissions: ["view", "create", "add_content", "edit", "delete_content", "sign"] });
    await rp.setGroupMember(db, { projectId: P, groupId: g(2), userId: U.sup.id, permissions: ["view", "edit", "add_content", "delete_content", "sign", "return"] });
    await rp.setGroupMember(db, { projectId: P, groupId: g(3), userId: U.client.id, permissions: ["view", "sign"] });
    for (const [seq, who] of [[1, U.planner], [2, U.sup], [3, U.client]]) await rp.setStageApprover(db, { projectId: P, stageId: wfl.find((s) => s.seq === seq).id, approverId: who.id });
    R = await cr.createContractReport(db, { projectId: P, contractId: C.id, reportDate: today, title: "روزانه", userId: U.planner.id });
    const day = await act.reportsOn(db, { projectId: P, contractId: C.id, day: today, userId: U.planner.id });
    equal([day.length, day[0].may.edit], [1, true]);
    equal((await act.reportsOn(db, { projectId: P, contractId: C.id, day: today, userId: U.outsider.id }))[0].may.edit, false, "not in its workflow");
    const [a, b, c] = [ACTS["خاکبرداری با بیل"], ACTS["حمل"], ACTS["تسطیح"]];
    await act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [a.id], mode: "number", value: 50, areaId: K1.id, mark: "Z1", userId: U.planner.id });
    await act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [b.id, c.id], mode: "percent", value: 10, userId: U.planner.id });
    await throws(() => act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [a.id], mode: "number", value: 151, userId: U.planner.id }), "بیش از حجم");
    await throws(() => act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [a.id], mode: "number", value: 1, areaId: K2.id, userId: U.planner.id }),
      "شرکت‌های این قرارداد", "an area / contractor that is not the contract's");
    const other = flat(await view(VB.id))[0];
    await act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [other.id], mode: "number", value: 1, userId: U.planner.id });
    equal(flat(await view(VB.id))[0].done, 1, "an activity of the contract's other PMS is the contract's too");
    const v = flat(await view());
    equal([v.find((x) => x.id === a.id).done, v.find((x) => x.id === a.id).pct, v.find((x) => x.id === b.id).done], [50, 25, 20]);
    await act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [a.id], mode: "remain", userId: U.planner.id });
    equal(flat(await view()).find((x) => x.id === a.id).pct, 100, "the remaining work brings it to its volume");
    // signed: read-only for the signer
    await rp.signReport(db, { projectId: P, reportId: R.id, userId: U.planner.id });
    await throws(() => act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [c.id], mode: "number", value: 1, userId: U.planner.id }), "امضا کرده‌اید");
    await rp.approveStage(db, { projectId: P, reportId: R.id, userId: U.planner.id });
    // stage 2: the supervisor lowers a line and removes another — as the stage's own values
    const s2 = (await rp.snapshotOf(db, { projectId: P, reportId: R.id })).content.activities;
    const lineA = s2.find((r) => r.base.activityId === a.id && r.base.qty === 50);
    await act.editProgress(db, { projectId: P, reportId: R.id, rowId: lineA.id, qty: 40, userId: U.sup.id });
    const lineB = s2.find((r) => r.base.activityId === b.id);
    await act.editProgress(db, { projectId: P, reportId: R.id, rowId: lineB.id, remove: true, userId: U.sup.id });
    await act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [c.id], mode: "number", value: 2, userId: U.sup.id });
    const after = (await rp.snapshotOf(db, { projectId: P, reportId: R.id })).content.activities;
    const a2 = after.find((r) => r.id === lineA.id);
    equal([a2.base.qty, a2.stages["2"].qty], [50, 40], "the first stage's number stays; the stage writes its own");
    equal(after.find((r) => r.id === lineB.id).stages["2"].removed, true);
    equal(after.filter((r) => r.addedAt === 2).length, 1);
    const v2 = flat(await view());
    equal([v2.find((x) => x.id === a.id).done, v2.find((x) => x.id === b.id).done, v2.find((x) => x.id === c.id).done], [190, 0, 22],
      "done is each line as it stands now");
    await throws(() => act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [c.id], mode: "number", value: 1, userId: U.client.id }), "حق");
  });
});

test("the detail: work front from the report's day, the versions planning the activity, the delay against the master plan, the report lines", async () => {
  await inP(async () => {
    const a = ACTS["خاکبرداری با بیل"];
    await plan.addToPlan(db, { projectId: P, versionId: V1.id, activityIds: [a.id], userId: U.planner.id });
    await plan.addToPlan(db, { projectId: P, versionId: V2.id, activityIds: [a.id], startOn: "2026-01-02", days: 3, userId: U.planner.id });
    await eps.saveActivity(db, { projectId: P, nodeId: N.id, id: a.id, name: a.name, wf: a.wf, actualStart: "2026-01-03", actualEnd: "2026-01-09" });
    await act.saveDelay(db, { projectId: P, activityId: a.id, description: "تأخیر تحویل زمین", delayCode: "D-01", acceptFinish: "2026-01-08", critical: true, userId: U.planner.id });
    const d = await act.activityDetail(db, { projectId: P, activityId: a.id });
    equal(d.workFront.rows.find((r) => r.date === today)?.done ?? null, 190, "the day's work in the work front");
    equal(d.groups.map((g) => [g.code, g.current, g.master, g.plan_start, g.plan_end]),
      [["PM01-R0", true, true, "2026-01-01", "2026-01-05"], ["PM01-R1", false, false, "2026-01-02", "2026-01-04"]], "each version that plans it, with its own dates; read under the master plan");
    equal([d.baseline.version, d.delays[0].finishDelay, d.delays[0].startDelay, d.delays[0].acceptDelay, d.delays[0].critical], ["PM01-R0", 4, 2, 3, true]);
    equal(d.reports.map((l) => [l.qty, l.areaName, l.mark]).sort(), [[150, null, null], [40, "آزمون فلز", "Z1"]].sort());
    await eps.setMaster(db, { projectId: P, id: V1.id, master: false, userId: U.planner.id });
    equal((await act.activityDetail(db, { projectId: P, activityId: a.id })).delays[0].finishDelay, null, "no master plan: no baseline, no delay");
    await eps.setMaster(db, { projectId: P, id: V1.id, userId: U.planner.id });
  });
});

test("the days as columns: activities with work on the chosen days, one column a day and the total", async () => {
  await inP(async () => {
    const d = await act.daysView(db, { projectId: P, versionId: V1.id, days: [today] });
    equal([d.allDays, d.days], [[today], [today]]);
    equal(d.matrix[ACTS["خاکبرداری با بیل"].id], { byDay: { [today]: 190 }, total: 190 });
    equal(d.matrix[ACTS["حمل"].id], undefined, "a line removed at stage 2 is not work done");
  });
});

test("a node's child nodes and its activities share one numbering: no code is both a WBS node and an activity", async () => {
  await inP(async () => {
    const own = flat(await view()).filter((a) => a.node_id === N.id).map((a) => a.code);
    const kid = await eps.saveNode(db, { projectId: P, versionId: V1.id, parentId: N.id, name: "زیرگره" });
    equal(own.includes(kid.code), false, `${kid.code} is not one of ${own.join(", ")}`);
    const lowest = (await import("../../lib/eps/wbs.mjs")).activityCode(N.code, 1);
    const kid1 = own.includes(lowest) ? null : await eps.saveNode(db, { projectId: P, versionId: V1.id, parentId: N.id, code: lowest, name: "زیرگره ۱" });
    const hand = await eps.saveActivity(db, { projectId: P, nodeId: N.id, name: "دستی", wf: 0 });
    equal([hand.code === kid.code, hand.code === kid1?.code], [false, false], `the activity took ${hand.code}`);
    await eps.removeActivity(db, { projectId: P, id: hand.id });
    for (const k of [kid1, kid].filter(Boolean)) await eps.removeNode(db, { projectId: P, versionId: V1.id, id: k.id });
  });
});

test("one WBS: a control account is a node of the master plan — code, title and BAC from the node, PV from its dates and weights, EV from its progress", async () => {
  const controls = await import("../../lib/db/repos/controls.mjs");
  await inP(async () => {
    await projects.updateProjectProfile(db, { projectId: P, patch: { contract_currency: "USD" } });
    const v = await view();
    const node = v.roots.find((n) => n.id === N.id);
    const a = await controls.upsertAccount(db, { projectId: P, wbsNodeId: N.id, code: "TYPED", title: "ignored", bac: 5 });
    equal([a.code, a.ev_method, a.bac], [N.code, "wbs", null], "nothing typed beside the node is kept");
    const row = (await controls.controlsBoard(db, { projectId: P })).accounts.find((x) => x.id === a.id);
    equal([row.title, row.bac, row.ev.pct, row.pvPct], [node.name, node.budgetPlan, node.pct, ea.plannedPctAt(node, today)]);
    assert(node.pct != null && row.points.length > 0, `the node has progress (${node.pct}) and a planned curve`);
    // the node renamed in the WBS is renamed as the account, read on every use
    await eps.saveNode(db, { projectId: P, versionId: V1.id, id: N.id, name: "سیویل — بازنامیده", wf: node.wf_typed, budgetPlan: node.budget_plan });
    equal((await controls.controlsBoard(db, { projectId: P })).accounts.find((x) => x.id === a.id).title, "سیویل — بازنامیده");
    await throws(() => controls.setBaseline(db, { projectId: P, accountId: a.id, points: [{ date: today, pct: 0 }], revision: "1", reason: "x" }), "برنامهٔ اصلی");
    await throws(() => controls.reportProgress(db, { projectId: P, accountId: a.id, asOf: today, pct: 5, source: "x" }), "پلتفرم");
    const { rows: [other] } = await db.query("SELECT id FROM wbs_node WHERE pms_id = $1 LIMIT 1", [PM2.id]);
    await throws(() => controls.upsertAccount(db, { projectId: P, wbsNodeId: other.id }), "Master", "a node of a PMS with no master plan is refused");
    await throws(() => eps.removeNode(db, { projectId: P, versionId: V1.id, id: N.id }), "حساب کنترلی", "a node an account stands on is not deleted under it");
    await db.query("DELETE FROM control_account WHERE id = $1", [a.id]);
  });
});

test("through the routes: contract access decides; a member without it reads and writes nothing", async () => {
  const route = await import("../../app/api/eps/activities/route.js");
  const users = await import("../../lib/db/repos/users.mjs");
  const req = (url, as, body) => new Request(`http://x${url}`, { method: body ? "POST" : "GET",
    headers: { authorization: `Bearer kc|ea-${as}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  equal((await route.GET(req(`/api/eps/activities?projectId=${P}&versionId=${V1.id}`, "outsider"))).status, 404, "a contract they are not on is not there for them");
  equal((await route.POST(req("/api/eps/activities", "outsider", { projectId: P, kind: "code", contractId: C.id, code: "X", name: "x" }))).status, 404);
  await users.updateProfile(db, { userId: U.outsider.id, companyId: K1.id });
  await inP(() => users.setContractMember(db, { projectId: P, contractId: C.id, userId: U.outsider.id, position: "ناظر", access: "view" }));
  const ok = await route.GET(req(`/api/eps/activities?projectId=${P}&versionId=${V1.id}`, "outsider"));
  equal([ok.status, (await ok.json()).may.edit], [200, false]);
  equal((await route.POST(req("/api/eps/activities", "outsider", { projectId: P, kind: "delay", activityId: ACTS["حمل"].id, description: "x" }))).status, 403, "view access writes nothing");
  const det = await route.GET(req(`/api/eps/activities?projectId=${P}&activityId=${ACTS["حمل"].id}`, "planner"));
  equal(det.status, 200);
});

await run();
