#!/usr/bin/env node
/**
 * The owner's requirements of 2026-10-26 (migration 091):
 *   1  the EPS Excel template carries the activity table's fields and the
 *      project's own columns of it, and the import reads them back
 *   2  the activity's code edited from the detail form
 *   3  the activity table's cost and float, as P6 names them
 *   4  the same in a version's plan, the two percentages worked out by the
 *      database — never typed, never guessed
 *   5  a PMS set active or aside; a version or a PMS deleted with all under
 *      it — planning rows, daily-report lines, activities, WBS — only when
 *      asked to, and refused whole when a report may not be written
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import * as XLSX from "xlsx";
import { COST_FIELDS, PLAN_COST_FIELDS, costPercents } from "../../lib/eps/costs.mjs";
import { fromSheet, SHEET_HEAD } from "../../lib/eps/import.mjs";
import { pickable, checkPick, templateOf } from "../../lib/import-templates.mjs";

// ── the rules ────────────────────────────────────────────────────────────

test("the two percentages as P6 defines them: actual over the at completion total, actual over the budget; empty while a side is empty or a divisor is 0", () => {
  equal(costPercents({ targetCost: 800, actCost: 300, totalCost: 1000 }), { costCompletePct: 30, actPctSpent: 37.5 });
  equal(costPercents({ targetCost: 3, actCost: 2, totalCost: 3 }), { costCompletePct: 66.6667, actPctSpent: 66.6667 });
  equal(costPercents({ targetCost: 800, actCost: null, totalCost: 1000 }), { costCompletePct: null, actPctSpent: null }, "an actual nobody gave is not zero");
  equal(costPercents({ targetCost: 800, actCost: 300, totalCost: "" }), { costCompletePct: null, actPctSpent: 37.5 }, "each percentage needs only its own divisor");
  equal(costPercents({ targetCost: 0, actCost: 300, totalCost: 0 }), { costCompletePct: null, actPctSpent: null }, "no division by zero");
  equal(COST_FIELDS.map((f) => f.col), ["target_cost", "act_cost", "remain_cost", "total_cost", "free_float_hr_cnt", "total_float_hr_cnt", "cost_complete_pct", "act_pct_spent"]);
  equal(PLAN_COST_FIELDS.length, 6, "in a plan the two percentages are not typed");
});

test("an EPS sheet: the activity table's fields and the project's own column read by heading; a figure that is not one named and left empty", () => {
  const head = [...SHEET_HEAD, "Crew"];
  const at = (h) => head.indexOf(h);
  const row = (vals) => { const r = new Array(head.length).fill(""); for (const [h, v] of Object.entries(vals)) r[at(h)] = v; return r; };
  const r = fromSheet([head,
    row({ Type: "WBS", Code: "01", Name: "Piping", "W.F": 100 }),
    row({ Type: "Activity", "Parent code": "01", Code: "A-1", Name: "Erect", "W.F": 100, Volume: 10, "Activity type": "Task Dependent", "Activity ID": "A1000",
      "WF rate": "1,5", Description: "rack", "Budgeted Total Cost($)": 1000, "Actual Total Cost($)": 200, "Free Float(h)": -8, Crew: "4 welders" }),
    row({ Type: "Activity", "Parent code": "01", Code: "A-2", Name: "Test", "Actual Total Cost($)": -5, "Remaining Total Cost($)": "lots" }),
  ], { custom: [{ id: "f1", label: "crew" }, { id: "f2", label: "Not in the file" }] });
  const [a, b] = r.activities;
  equal([a.code, a.fields.act_type, a.fields.activity_no, a.fields.wf_rate, a.fields.description, a.fields.target_cost, a.fields.act_cost, a.fields.free_float_hr_cnt, a.custom],
    ["A-1", "Task Dependent", "A1000", 15, "rack", 1000, 200, -8, { f1: "4 welders" }], "Code and Activity ID apart; a float may be negative");
  equal([b.fields.act_cost, b.fields.remain_cost, b.custom], [null, null, {}]);
  assert(r.problems.some((p) => p.includes("منفی")) && r.problems.some((p) => p.includes("«lots»")), r.problems.join(" | "));
  const x = fromSheet([["Activity ID", "Type", "Parent code", "Code", "Name"], ["", "WBS", "", "01", "N"], ["A1000", "Activity", "01", "A-1", "x"]]);
  equal(x.activities.map((y) => [y.code, y.fields.activity_no]), [["A-1", "A1000"]], "an Activity ID column before the Code does not take its place");
  equal(fromSheet([["Type", "Parent code", "Activity ID", "Name"], ["WBS", "", "01", "N"], ["Activity", "01", "A-1", "x"]]).activities.map((y) => y.code), ["A-1"],
    "with no Code column the Activity ID is the code, as before");
});

test("the EPS template offers the project's own columns after its own; a saved choice may keep them; the sheet is headed with them", () => {
  equal(pickable("eps").columns.includes("Budgeted Total Cost($)") && pickable("eps").columns.includes("Activity ID"), true);
  const p = pickable("eps", ["Crew", "Name"]);
  equal(p.columns.slice(-1), ["Crew"], "a project's column named like the template's own is not offered twice");
  assert(checkPick("eps", ["Parent code", "Code", "Name", "Crew"]).problem, "without the project's columns, Crew is unknown");
  equal(checkPick("eps", ["Parent code", "Code", "Name", "Crew"], ["Crew"]).columns, ["Parent code", "Code", "Name", "Crew"]);
  const t = templateOf("eps", ["Parent code", "Code", "Name", "Free Float(h)", "Crew"], ["Crew"]);
  equal(t.sheets[0].rows[0], ["Parent code", "Code", "Name", "Free Float(h)", "Crew"]);
  equal(t.sheets[0].rows[3], ["01.01", "A-010", "Erect spools — area 1", 16, ""]);
  assert(t.guide.some((g) => g[0] === "Crew") && t.guide.some((g) => g[0] === "Free Float(h)"));
  equal(pickable("planning", ["Crew"]).columns.includes("Crew"), false, "only a template that names a table offers its columns");
});

// ── in the database ──────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("eps-costs-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const ctr = await import("../../lib/db/repos/contracts.mjs");
const eps = await import("../../lib/db/repos/eps.mjs");
const act = await import("../../lib/db/repos/eps-activities.mjs");
const plan = await import("../../lib/db/repos/planning.mjs");
const imp = await import("../../lib/db/repos/eps-import.mjs");
const tpl = await import("../../lib/db/repos/import-templates.mjs");
const rp = await import("../../lib/db/repos/reports.mjs");
const cr = await import("../../lib/db/repos/contract-reports.mjs");
const db = await getDb();
const U = {};
for (const k of ["planner", "outsider"]) U[k] = await projects.ensureUser(db, { subject: `kc|ec-${k}`, displayName: k });
const P = (await projects.createProject(db, { code: "EC1", name: "E", ownerUserId: U.planner.id })).id;
await projects.addMember(db, { projectId: P, userId: U.outsider.id, role: "engineer" });
const inP = (fn) => withProject(db, P, fn);
const today = new Date().toISOString().slice(0, 10);
let C, PM, V, N, A, B;

await inP(async () => {
  const { rows: [k] } = await db.query("INSERT INTO contractor (project_id, code, name) VALUES ($1, 'K', 'K') RETURNING id", [P]);
  C = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-1", title: "x", kind: "subcontract", contractorId: k.id, currency: "USD", userId: U.planner.id });
  PM = await eps.savePms(db, { projectId: P, contractId: C.id, code: "PM01", title: "اجرا", userId: U.planner.id });
  V = await eps.saveVersion(db, { projectId: P, pmsId: PM.id, code: "PM01-R0", title: "پایه", userId: U.planner.id });
  N = await eps.saveNode(db, { projectId: P, pmsId: PM.id, name: "سیویل", wf: 100, volumeActual: 200, planStart: "2026-01-01", planEnd: "2026-01-20" });
  A = await eps.saveActivity(db, { projectId: P, nodeId: N.id, name: "خاکبرداری", wf: 60 });
  B = await eps.saveActivity(db, { projectId: P, nodeId: N.id, name: "حمل", wf: 40 });
});

test("the activity table keeps the cost and float as typed; a field left out is kept; a cost below zero is refused; the code is edited from the detail form", async () => {
  await inP(async () => {
    await eps.saveActivity(db, { projectId: P, nodeId: N.id, id: A.id, name: A.name, wf: 60, code: "PM01.C.01.10", activityNo: "A1000",
      targetCost: 1000, actCost: 250, remainCost: 750, totalCost: 1000, freeFloatH: -4, totalFloatH: 12, costCompletePct: 25, actPctSpent: 25 });
    await eps.saveActivity(db, { projectId: P, nodeId: N.id, id: A.id, name: A.name, wf: 60, actCost: 300 });
    const { rows: [a] } = await db.query(`SELECT code, activity_no, ${COST_FIELDS.map((f) => f.col).join(", ")} FROM wbs_activity WHERE id = $1`, [A.id]);
    equal([a.code, a.activity_no, ...COST_FIELDS.map((f) => (a[f.col] == null ? null : Number(a[f.col])))],
      ["PM01.C.01.10", "A1000", 1000, 300, 750, 1000, -4, 12, 25, 25]);
    await throws(() => eps.saveActivity(db, { projectId: P, nodeId: N.id, id: A.id, name: A.name, wf: 60, remainCost: -1 }), "منفی");
    await throws(() => db.query("UPDATE wbs_activity SET target_cost = -1 WHERE id = $1", [A.id]), "check", "the database holds it too");
    const d = await act.activityDetail(db, { projectId: P, activityId: A.id });
    equal(Number(d.activity.target_cost), 1000, "the detail form reads them");
  });
});

test("a version's plan: six typed, the two percentages worked out by the database — and not written by hand", async () => {
  await inP(async () => {
    await plan.addToPlan(db, { projectId: P, versionId: V.id, activityIds: [A.id, B.id], userId: U.planner.id });
    const row = (await plan.planRows(db, { projectId: P, versionId: V.id })).rows.find((r) => r.activity_id === A.id);
    equal([row.cost_complete_pct, row.act_pct_spent], [null, null], "nothing typed, nothing worked out");
    await plan.savePlanRow(db, { projectId: P, id: row.id, targetCost: 800, actCost: 300, remainCost: 700, totalCost: 1000, freeFloatH: 6, totalFloatH: -2,
      costCompletePct: 99, actPctSpent: 99, userId: U.planner.id });
    let r = (await plan.planRows(db, { projectId: P, versionId: V.id })).rows.find((x) => x.id === row.id);
    equal([r.target_cost, r.act_cost, r.remain_cost, r.total_cost, r.free_float_hr_cnt, r.total_float_hr_cnt, r.cost_complete_pct, r.act_pct_spent],
      [800, 300, 700, 1000, 6, -2, 30, 37.5], "300 ÷ 1000 and 300 ÷ 800; the 99 typed is not taken");
    await plan.savePlanRow(db, { projectId: P, id: row.id, totalCost: "", userId: U.planner.id });
    r = (await plan.planRows(db, { projectId: P, versionId: V.id })).rows.find((x) => x.id === row.id);
    equal([r.target_cost, r.cost_complete_pct, r.act_pct_spent], [800, null, 37.5], "the total emptied: no Cost % Complete; Cost % of Budget stands on the budget");
    await throws(() => plan.savePlanRow(db, { projectId: P, id: row.id, actCost: -3, userId: U.planner.id }), "منفی");
    await throws(() => db.query("UPDATE activity_plan SET cost_complete_pct = 5 WHERE id = $1", [row.id]), "428C9", "a percentage is never written by hand (a generated column)");
    // under the version the activity carries its plan's figures; the activity table keeps its own
    const tree = await act.activityView(db, { projectId: P, versionId: V.id });
    const a = tree.roots[0].activities.find((x) => x.id === A.id);
    equal([a.plan.target_cost, Number(a.target_cost)], [800, 1000]);
    // a copy of the plan carries what was typed; the percentages follow again
    const V2 = await eps.saveVersion(db, { projectId: P, pmsId: PM.id, code: "PM01-R1", title: "دوم", userId: U.planner.id });
    await plan.savePlanRow(db, { projectId: P, id: row.id, totalCost: 1000, userId: U.planner.id });
    await plan.copyPlan(db, { projectId: P, fromVersionId: V.id, toVersionId: V2.id, userId: U.planner.id });
    const c = (await plan.planRows(db, { projectId: P, versionId: V2.id })).rows.find((x) => x.activity_id === A.id);
    equal([c.target_cost, c.total_cost, c.cost_complete_pct, c.act_pct_spent], [800, 1000, 30, 37.5]);
  });
});

test("a template's activity carries the cost and float onto the activity made from it", async () => {
  await inP(async () => {
    const T = await eps.saveTemplate(db, { projectId: P, code: "T-C", name: "هزینه" });
    await eps.saveTemplateActivity(db, { projectId: P, templateId: T.id, name: "بتن", wf: 100, targetCost: 5000, totalFloatH: 24 });
    const N2 = await eps.saveNode(db, { projectId: P, pmsId: PM.id, name: "بتن", wf: 0 });
    await eps.attachTemplate(db, { projectId: P, nodeId: N2.id, templateId: T.id });
    const { rows: [m] } = await db.query("SELECT target_cost, total_float_hr_cnt FROM wbs_activity WHERE node_id = $1", [N2.id]);
    equal([Number(m.target_cost), Number(m.total_float_hr_cnt)], [5000, 24]);
    await eps.removeNode(db, { projectId: P, pmsId: PM.id, id: N2.id }).catch(() => {});
  });
});

test("a PMS set aside is kept but marked; the board says which are active", async () => {
  await inP(async () => {
    const X = await eps.savePms(db, { projectId: P, contractId: C.id, code: "PM09", title: "کنار", userId: U.planner.id });
    equal(X.active, true, "a new PMS is active");
    await eps.setPmsActive(db, { projectId: P, id: X.id, active: false, userId: U.planner.id });
    equal((await eps.epsBoard(db, { projectId: P, contractId: C.id })).map((p) => [p.code, p.active]), [["PM01", true], ["PM09", false]]);
    await eps.setPmsActive(db, { projectId: P, id: X.id, active: "true", userId: U.planner.id });
    equal((await eps.epsBoard(db, { projectId: P, contractId: C.id })).find((p) => p.code === "PM09").active, true);
    await eps.removeEps(db, { projectId: P, kind: "pms", id: X.id, userId: U.planner.id });
  });
});

test("a version is deleted with its planning rows, requirements and comments only when asked to", async () => {
  await inP(async () => {
    const V3 = await eps.saveVersion(db, { projectId: P, pmsId: PM.id, code: "PM01-R3", title: "سوم", userId: U.planner.id });
    await plan.addToPlan(db, { projectId: P, versionId: V3.id, activityIds: [A.id], userId: U.planner.id });
    const ty = await plan.saveRequirementType(db, { projectId: P, contractId: C.id, name: "نقشه" });
    await plan.saveRequirement(db, { projectId: P, versionId: V3.id, activityId: A.id, name: "IFC", typeId: ty.id, userId: U.planner.id });
    await plan.saveComment(db, { projectId: P, versionId: V3.id, activityId: A.id, item: "یادداشت", userId: U.planner.id });
    await throws(() => eps.removeEps(db, { projectId: P, kind: "version", id: V3.id }), "حذف تمام زیرمجموعه‌ها");
    equal(await eps.removeEps(db, { projectId: P, kind: "version", id: V3.id, all: true, userId: U.planner.id }), { planned: 1 });
    const left = (await db.query(`SELECT (SELECT count(*) FROM eps_version WHERE id = $1)::int + (SELECT count(*) FROM activity_plan WHERE version_id = $1)::int
      + (SELECT count(*) FROM activity_requirement WHERE version_id = $1)::int + (SELECT count(*) FROM activity_comment WHERE version_id = $1)::int AS n`, [V3.id])).rows[0].n;
    equal(left, 0);
    equal((await db.query("SELECT count(*)::int AS n FROM wbs_activity WHERE id = $1", [A.id])).rows[0].n, 1, "the activity stays on the WBS");
  });
});

test("a PMS deleted with all under it takes its daily-report lines out of the reports, through their workflow; another PMS's lines stay; a report the user may not write refuses it whole", async () => {
  await inP(async () => {
    const type = await cr.ensureType(db, { projectId: P });
    const wfl = await rp.workflowOf(db, { projectId: P, reportTypeId: type.id });
    const g1 = wfl.find((s) => s.seq === 1).groups[0].id;
    await rp.setGroupMember(db, { projectId: P, groupId: g1, userId: U.planner.id, permissions: ["view", "create", "add_content", "edit", "delete_content", "sign"] });
    await rp.setStageApprover(db, { projectId: P, stageId: wfl.find((s) => s.seq === 1).id, approverId: U.planner.id });
    const PX = await eps.savePms(db, { projectId: P, contractId: C.id, code: "PMX", title: "حذفی", userId: U.planner.id });
    await eps.saveVersion(db, { projectId: P, pmsId: PX.id, code: "PMX-R0", title: "پایه", userId: U.planner.id });
    const NX = await eps.saveNode(db, { projectId: P, pmsId: PX.id, name: "گره", wf: 100, volumeActual: 100 });
    const AX = await eps.saveActivity(db, { projectId: P, nodeId: NX.id, name: "کار", wf: 100 });
    const R = await cr.createContractReport(db, { projectId: P, contractId: C.id, reportDate: today, title: "روزانه", userId: U.planner.id });
    await act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [AX.id], mode: "number", value: 5, userId: U.planner.id });
    await act.addProgress(db, { projectId: P, reportId: R.id, activityIds: [B.id], mode: "number", value: 7, userId: U.planner.id });
    const c = await eps.pmsContents(db, { projectId: P, id: PX.id });
    equal([c.counts.reportLines, c.counts.reports, c.stops], [1, 1, []]);
    assert(c.blockers.some((b) => b.includes(R.report_no)), "without the tick the report still stops it");
    await throws(() => eps.removeEps(db, { projectId: P, kind: "pms", id: PX.id, userId: U.planner.id }), "حذف تمام زیرمجموعه‌ها");
    const versions = async () => (await db.query("SELECT count(*)::int AS n FROM report_version WHERE report_id = $1", [R.id])).rows[0].n;
    const before = await versions();
    await throws(() => eps.removeEps(db, { projectId: P, kind: "pms", id: PX.id, all: true, userId: U.outsider.id }), "", "not in the report's workflow");
    equal([await versions(), (await db.query("SELECT count(*)::int AS n FROM eps_pms WHERE id = $1", [PX.id])).rows[0].n], [before, 1], "refused whole: nothing written");
    await eps.removeEps(db, { projectId: P, kind: "pms", id: PX.id, all: true, userId: U.planner.id });
    equal((await db.query("SELECT count(*)::int AS n FROM eps_pms WHERE id = $1", [PX.id])).rows[0].n, 0);
    const lines = (await act.progressLines(db, { projectId: P, contractId: C.id })).filter((l) => l.reportId === R.id);
    equal(lines.map((l) => [l.activityId, Number(l.qty)]), [[B.id, 7]], "its line left the report; the other PMS's stayed");
    equal(await versions(), before + 1, "the report rewritten once, as a new version");
  });
});

test("the EPS sheet into a new PMS: the activity table's fields and the project's own column written; a value the column does not hold named", async () => {
  await inP(async () => {
    const { rows: [crew] } = await db.query("INSERT INTO custom_field (project_id, form_key, label, data_type) VALUES ($1,'eps-activities','Crew','text') RETURNING id", [P]);
    const { rows: [hrs] } = await db.query("INSERT INTO custom_field (project_id, form_key, label, data_type) VALUES ($1,'eps-activities','Hours','number') RETURNING id", [P]);
    const head = [...SHEET_HEAD, "Crew", "Hours"];
    const row = (vals) => { const r = new Array(head.length).fill(""); for (const [h, v] of Object.entries(vals)) r[head.indexOf(h)] = v; return r; };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head,
      row({ Type: "WBS", Code: "01", Name: "Piping", "W.F": 100 }),
      row({ Type: "Activity", "Parent code": "01", Code: "A-1", Name: "Erect", "W.F": 100, Volume: 10, "Volume actual": 12, "Activity ID": "A1000",
        "At Completion Total Cost($)": 900, Crew: "4 welders", Hours: "many" }),
    ]), "WBS");
    const r = await imp.importPlan(db, { projectId: P, contractId: C.id, mode: "new", pmsCode: "PMS1", kind: "sheet", sourceName: "eps.xlsx",
      content: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), userId: U.planner.id });
    const { rows: [a] } = await db.query("SELECT a.id, a.activity_no, a.total_cost, a.volume_plan, a.volume_actual FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1", [r.pms.id]);
    equal([a.activity_no, Number(a.total_cost), Number(a.volume_plan), Number(a.volume_actual)], ["A1000", 900, 10, 12]);
    equal((await db.query("SELECT field_id, value FROM custom_value WHERE row_key = $1", [String(a.id)])).rows, [{ field_id: crew.id, value: "4 welders" }]);
    assert(r.problems.some((p) => p.includes("Hours") && p.includes("many")), r.problems.join(" | "));
    // a template people build may keep the project's column
    const t = await tpl.saveTemplate(db, { projectId: P, kind: "eps", name: "با خدمه", columns: ["Parent code", "Code", "Name", "Crew"], userId: U.planner.id });
    equal(t.columns, ["Parent code", "Code", "Name", "Crew"]);
    await throws(() => tpl.saveTemplate(db, { projectId: P, kind: "planning", name: "x", columns: ["Activity code", "Crew"], userId: U.planner.id }), "ناشناخته");
    void hrs;
  });
});

test("an EPS sheet whose actual finish is before its start: the file still goes in, that row named and its actual dates left empty — not a database error", async () => {
  await inP(async () => {
    const head = [...SHEET_HEAD];
    const row = (vals) => { const r = new Array(head.length).fill(""); for (const [h, v] of Object.entries(vals)) r[head.indexOf(h)] = v; return r; };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head,
      row({ Code: "01", Name: "Civil" }),
      row({ "Parent code": "01", Code: "A-1", Name: "Anchor bolt", "Plan start": "2024-07-01", "Plan end": "2024-12-31", "Actual start": "2024-11-27", "Actual end": "2024-07-27" }),
      row({ "Parent code": "01", Code: "A-2", Name: "Rebar", "Actual start": "2025-06-01", "Actual end": "2025-06-18" }),
    ]), "WBS");
    const r = await imp.importPlan(db, { projectId: P, contractId: C.id, mode: "new", pmsCode: "PMS2", kind: "sheet", sourceName: "spans.xlsx",
      content: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), userId: U.planner.id });
    const { rows } = await db.query(`SELECT a.code, a.plan_start::text, a.actual_start::text, a.actual_end::text FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id
      WHERE n.pms_id = $1 ORDER BY a.code`, [r.pms.id]);
    equal(rows.map((x) => [x.code, x.plan_start, x.actual_start, x.actual_end]), [["A-1", "2024-07-01", null, null], ["A-2", null, "2025-06-01", "2025-06-18"]],
      "which of the two is wrong is not guessed; its plan dates and the other row stand");
    assert(r.problems.some((p) => p.includes("A-1") && p.includes("2024-07-27") && p.includes("2024-11-27")), r.problems.join(" | "));
  });
});

test("through the route: a PMS set active or aside by one who edits the contract's EPS", async () => {
  const route = await import("../../app/api/eps/route.js");
  const call = async (body, as = "ec-planner") => {
    const res = await route.POST(new Request("http://x/api/eps", { method: "POST", headers: { authorization: `Bearer kc|${as}`, "content-type": "application/json" },
      body: JSON.stringify({ projectId: P, ...body }) }));
    return { status: res.status, body: await res.json() };
  };
  const r = await call({ kind: "pms-active", id: PM.id, active: false });
  equal([r.status, r.body.row?.active], [200, false]);
  equal((await call({ kind: "pms-active", id: PM.id, active: true })).body.row.active, true);
  equal((await call({ kind: "pms-active", id: "00000000-0000-0000-0000-000000000000", active: true })).status, 404);
  equal((await call({ kind: "pms-active", id: PM.id, active: false }, "ec-outsider")).status, 404, "not on the contract: not there");
});

await run();
