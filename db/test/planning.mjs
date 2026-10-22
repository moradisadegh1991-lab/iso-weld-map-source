#!/usr/bin/env node
/**
 * The WBS on the PMS and a version's planning (owner's requirements of
 * 2026-10-22, «PLANING»; migration 083): one tree for all of a PMS's
 * versions; a version carries the activities it plans, each with its own
 * start, finish, work done before and planned quantity, and those stand over
 * the activity's own when the version is read; the defaults a row takes from
 * its activity; copying between versions of one PMS only; the Excel sheet.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import * as XLSX from "xlsx";
import * as pl from "../../lib/eps/planning.mjs";
import * as w from "../../lib/eps/wbs.mjs";

// ── the rules ────────────────────────────────────────────────────────────

test("a row takes from its activity what was not typed: start, finish, work done before the start, planned = whole − done before", () => {
  const act = { id: "a", code: "A1", plan_start: "2026-03-01", plan_end: "2026-03-20", volumeActual: 100, volumePlan: 90 };
  const lines = [{ activityId: "a", date: "2026-02-27", qty: 12 }, { activityId: "a", date: "2026-03-01", qty: 3 }, { activityId: "a", date: "2026-03-05", qty: 8 }, { activityId: "b", date: "2026-02-01", qty: 50 }];
  equal(pl.planRow({}, act, { lines }).row, { start_on: "2026-03-01", end_on: "2026-03-20", done_before: 12, volume_plan: 88, description: null },
    "only the work before the 1st (not on it), only this activity's; the whole is the actual volume");
  equal(pl.planRow({ startOn: "2026-03-10", days: 5 }, act, { lines }).row.end_on, "2026-03-14", "start + days − 1");
  equal(pl.planRow({ startOn: "2026-03-10", days: 1 }, act).row.end_on, "2026-03-10", "a one-day activity starts and finishes the same day");
  equal(pl.planRow({ startOn: "2026-03-10", days: 5 }, act, { lines }).row.done_before, 23, "done before follows the start typed");
  equal(pl.planRow({ doneBefore: 30, volumePlan: 10 }, act).row, { start_on: "2026-03-01", end_on: "2026-03-20", done_before: 30, volume_plan: 10, description: null }, "typed figures stand");
  equal(pl.planRow({}, { ...act, volumeActual: null, volumePlan: null }).row.volume_plan, null, "no quantity to plan from: empty, not a guess");
  equal(pl.planRow({}, { ...act, volumeActual: null }).row.volume_plan, 90, "no actual volume: the planned one is the whole");
  equal(pl.planRow({ volumePlan: "0.1234567891" }, act).row.volume_plan, 0.1234567891, "ten decimals kept");
  assert(pl.planRow({ startOn: "2026-03-10", endOn: "2026-03-01" }, act).problem.includes("پیش از شروع"));
  assert(pl.planRow({ days: 0, startOn: "2026-03-01" }, act).problem.includes("عدد صحیح"));
  assert(pl.planRow({ days: 3 }, { ...act, plan_start: null }).problem.includes("بی‌تاریخ شروع"));
  assert(pl.planRow({ doneBefore: 101 }, act).problem.includes("بیش از حجم کل"));
  equal(w.finishOf("2026-12-30", 3), "2027-01-01", "across a year");
});

test("an activity under a version: the plan's dates and quantity stand over its own; without a plan it keeps its own", () => {
  const a = { id: "a", plan_start: "2026-01-01", plan_end: "2026-01-31", volume_plan: 100, volume_actual: 100 };
  const o = w.overlayPlan(a, { id: "p", start_on: "2026-02-01", end_on: "2026-02-10", volume_plan: 40, done_before: 60 });
  equal([o.plan_start, o.plan_end, o.volume_plan, o.volume_actual, o.plan.days, o.plan.done_before], ["2026-02-01", "2026-02-10", 40, 100, 10, 60]);
  equal(w.overlayPlan(a, { id: "p", start_on: null, end_on: null, volume_plan: null }).plan_start, "2026-01-01", "a plan without a date leaves the activity's");
  equal(w.overlayPlan(a, null), { ...a, plan: null });
});

test("the planning sheet: headers in either language, ten decimals, a date it cannot read named and left empty", () => {
  const r = pl.fromPlanSheet([
    ["Planning of PM01-R2"],
    ["WBS code", "Activity code", "Start", "Days", "Finish", "Done before", "Planned", "Description"],
    ["PM01.C.01", "A-1", "2026-03-01", 10, "", 5, 12.0000000001, "first"],
    ["", "A-2", 46082, "", "2026-04-01", "", "", ""],
    ["", "A-3", "1405/01/10", "", "", "x", "", ""],
    ["", "", "2026-01-01"],
  ]);
  equal(r.lines.map((l) => [l.row, l.wbs, l.code, l.startOn, l.days, l.endOn, l.doneBefore, l.volumePlan, l.description]), [
    [3, "PM01.C.01", "A-1", "2026-03-01", 10, null, 5, 12.0000000001, "first"],
    [4, null, "A-2", "2026-03-01", null, "2026-04-01", null, null, null],
    [5, null, "A-3", null, null, null, null, null, null],
  ]);
  assert(r.problems.some((p) => p.includes("1405/01/10")) && r.problems.some((p) => p.includes("«x»")), "named, not guessed");
  equal(pl.fromPlanSheet([["کد فعالیت", "تاریخ شروع", "تعداد روز"], ["A-1", "2026-01-05", 2]]).lines[0].days, 2);
  equal(pl.fromPlanSheet([["a", "b"], [1, 2]]).lines, []);
});

// ── in the database ──────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("planning-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const ctr = await import("../../lib/db/repos/contracts.mjs");
const eps = await import("../../lib/db/repos/eps.mjs");
const act = await import("../../lib/db/repos/eps-activities.mjs");
const plan = await import("../../lib/db/repos/planning.mjs");
const db = await getDb();
const U = await projects.ensureUser(db, { subject: "kc|plan", displayName: "planner" });
const P = (await projects.createProject(db, { code: "PL1", name: "PL", ownerUserId: U.id })).id;
const inP = (fn) => withProject(db, P, fn);
let C, PM, PM2, V1, V2, VX, N, N2, A, B, X;
const flat = (v) => { const out = []; const walk = (n) => { out.push(...n.activities); n.children.forEach(walk); }; v.roots.forEach(walk); return out; };
const one = async (versionId, id) => flat(await act.activityView(db, { projectId: P, versionId })).find((a) => a.id === id);

await inP(async () => {
  const { rows: [k] } = await db.query("INSERT INTO contractor (project_id, code, name) VALUES ($1, 'K', 'K') RETURNING id", [P]);
  C = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-1", title: "x", kind: "subcontract", contractorId: k.id, currency: "USD", userId: U.id });
  PM = await eps.savePms(db, { projectId: P, contractId: C.id, code: "PM01", title: "اجرا", budgetPlan: 1000, userId: U.id });
  PM2 = await eps.savePms(db, { projectId: P, contractId: C.id, code: "PM02", title: "دوم", userId: U.id });
  V1 = await eps.saveVersion(db, { projectId: P, pmsId: PM.id, code: "PM01-R1", title: "خرداد", userId: U.id });
  V2 = await eps.saveVersion(db, { projectId: P, pmsId: PM.id, code: "PM01-R2", title: "تیر", userId: U.id });
  VX = await eps.saveVersion(db, { projectId: P, pmsId: PM2.id, code: "PM02-R1", title: "دیگر", userId: U.id });
  await eps.setMaster(db, { projectId: P, id: V1.id, userId: U.id });
});

test("the WBS is the PMS's: built with no version at all, read the same through each of its versions", async () => {
  await inP(async () => {
    N = await eps.saveNode(db, { projectId: P, pmsId: PM.id, name: "سیویل", wf: 100, volumeActual: 200, unit: "m3", planStart: "2026-01-01", planEnd: "2026-01-31" });
    A = await eps.saveActivity(db, { projectId: P, nodeId: N.id, name: "خاکبرداری", wf: 60, volumeActual: 100, planStart: "2026-01-01", planEnd: "2026-01-10",
      actType: "Task Dependent", activityNo: "A1000", wfRate: 0.0000003701 });
    B = await eps.saveActivity(db, { projectId: P, nodeId: N.id, name: "تسطیح", wf: 40 });
    N2 = await eps.saveNode(db, { projectId: P, pmsId: PM2.id, name: "دیگر", wf: 100 });
    X = await eps.saveActivity(db, { projectId: P, nodeId: N2.id, name: "بیگانه", wf: 100 });
    equal([A.act_type, A.activity_no, Number(A.wf_rate)], ["Task Dependent", "A1000", 0.0000003701], "type, ID and W.F rate as typed");
    const byPms = flat(await act.activityView(db, { projectId: P, pmsId: PM.id })).map((a) => a.id).sort();
    equal(flat(await act.activityView(db, { projectId: P, versionId: V1.id })).map((a) => a.id).sort(), byPms);
    equal(flat(await act.activityView(db, { projectId: P, versionId: V2.id })).map((a) => a.id).sort(), byPms);
    equal(await eps.suggestNodeCode(db, { projectId: P, versionId: V2.id }), "PM01.C.02", "a code suggested through a version is the PMS tree's");
    await throws(() => eps.savePmsBudget(db, { projectId: P, id: PM.id, budgetPlan: -1 }), "منفی");
  });
});

test("adding to a version: defaults from the activity, the same figures for many, an activity already there named not doubled, one of another PMS refused", async () => {
  await inP(async () => {
    const r = await plan.addToPlan(db, { projectId: P, versionId: V1.id, activityIds: [A.id], userId: U.id });
    equal(r, { added: 1, skipped: [] });
    let rows = (await plan.planRows(db, { projectId: P, versionId: V1.id })).rows;
    equal(rows.map((x) => [x.code, x.start_on, x.end_on, x.days, x.done_before, x.volume_plan, x.total]),
      [[A.code, "2026-01-01", "2026-01-10", 10, 0, 100, 100]], "the activity's dates; nothing done before; the whole 100 planned");
    const again = await plan.addToPlan(db, { projectId: P, versionId: V1.id, activityIds: [A.id, B.id], startOn: "2026-02-01", days: 5, userId: U.id });
    equal([again.added, again.skipped], [1, [A.code]]);
    rows = (await plan.planRows(db, { projectId: P, versionId: V1.id })).rows;
    equal(rows.find((x) => x.activity_id === B.id).end_on, "2026-02-05");
    await throws(() => plan.addToPlan(db, { projectId: P, versionId: V1.id, activityIds: [X.id], userId: U.id }), "WBS این PMS");
    await throws(() => db.query("INSERT INTO activity_plan (project_id, version_id, activity_id) VALUES ($1,$2,$3)", [P, V1.id, X.id]), "activity_plan",
      "the database holds it too");
    await throws(() => plan.addToPlan(db, { projectId: P, versionId: V2.id, activityIds: [A.id], startOn: "2026-03-10", endOn: "2026-03-01", userId: U.id }), "پیش از شروع");
    equal((await plan.planRows(db, { projectId: P, versionId: V2.id })).rows.length, 0, "a refused set writes nothing");
  });
});

test("read under a version, an activity it plans takes the plan's dates and quantity; one it does not keeps its own; another version reads its own", async () => {
  await inP(async () => {
    await plan.addToPlan(db, { projectId: P, versionId: V2.id, activityIds: [A.id], startOn: "2026-04-01", days: 20, volumePlan: 70, doneBefore: 30, userId: U.id });
    const v1 = await one(V1.id, A.id), v2 = await one(V2.id, A.id), bare = await one(null, A.id).catch(() => null);
    equal([v1.plan_start, v1.plan_end, v1.volumePlan], ["2026-01-01", "2026-01-10", 100]);
    equal([v2.plan_start, v2.plan_end, v2.planDays, v2.volumePlan, v2.plan.done_before, v2.volumeActual], ["2026-04-01", "2026-04-20", 20, 70, 30, 100],
      "the version's plan; the actual volume (progress is measured on it) stays the activity's");
    const b2 = await one(V2.id, B.id);
    equal([b2.plan, b2.plan_start], [null, "2026-01-01"], "not in this version: the activity's own (here its node's)");
    equal(bare, null);
    equal(flat(await act.activityView(db, { projectId: P, pmsId: PM.id })).find((a) => a.id === A.id).plan_start, "2026-01-01", "the bare tree: the activity's own");
  });
});

test("editing a row where it stands: days set the finish from the start, a field emptied goes back to the activity's, the rest kept", async () => {
  await inP(async () => {
    const row = (await plan.planRows(db, { projectId: P, versionId: V2.id })).rows[0];
    await plan.savePlanRow(db, { projectId: P, id: row.id, days: 3, userId: U.id });
    let r = (await plan.planRows(db, { projectId: P, versionId: V2.id })).rows[0];
    equal([r.start_on, r.end_on, r.volume_plan, r.done_before], ["2026-04-01", "2026-04-03", 70, 30]);
    await plan.savePlanRow(db, { projectId: P, id: row.id, volumePlan: "", description: "اکشن پلن ۱۰ روزه", userId: U.id });
    r = (await plan.planRows(db, { projectId: P, versionId: V2.id })).rows[0];
    equal([r.volume_plan, r.description], [70, "اکشن پلن ۱۰ روزه"], "planned emptied: whole 100 − 30 done before");
    await throws(() => plan.savePlanRow(db, { projectId: P, id: row.id, endOn: "2026-03-01", userId: U.id }), "پیش از شروع");
  });
});

test("copying a version's plan into another of the same PMS: missing rows added, existing kept unless replaced; another PMS refused", async () => {
  await inP(async () => {
    equal(await plan.copyPlan(db, { projectId: P, fromVersionId: V1.id, toVersionId: V2.id, userId: U.id }), { added: 1, replaced: 0, kept: 1 });
    equal((await one(V2.id, A.id)).plan_start, "2026-04-01", "kept");
    equal(await plan.copyPlan(db, { projectId: P, fromVersionId: V1.id, toVersionId: V2.id, replace: true, userId: U.id }), { added: 0, replaced: 2, kept: 0 });
    equal((await one(V2.id, A.id)).plan_start, "2026-01-01", "replaced by V1's");
    await throws(() => plan.copyPlan(db, { projectId: P, fromVersionId: V1.id, toVersionId: VX.id, userId: U.id }), "یک PMS");
    await throws(() => plan.copyPlan(db, { projectId: P, fromVersionId: V1.id, toVersionId: V1.id, userId: U.id }), "یکی است");
  });
});

test("a planning sheet into a version: rows rewritten or added by activity code; a code that repeats needs its WBS code; one bad line refuses the file", async () => {
  await inP(async () => {
    // a second activity A's code under another node of the same PMS
    const N3 = await eps.saveNode(db, { projectId: P, pmsId: PM.id, name: "دوم", wf: 0 });
    const twin = await eps.saveActivity(db, { projectId: P, nodeId: N3.id, code: A.code, name: "هم‌نام", wf: 0 });
    const file = (rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([pl.PLAN_HEAD, ...rows]), "Planning"); return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); };
    await throws(() => plan.importPlanSheet(db, { projectId: P, versionId: V2.id, content: file([["", A.code, "2026-05-01", 2]]), userId: U.id }), "WBS code");
    await throws(() => plan.importPlanSheet(db, { projectId: P, versionId: V2.id, content: file([[N.code, A.code, "2026-05-01", 2], ["", "NOPE", "", ""]]), userId: U.id }), "NOPE",
      "refused whole");
    equal((await one(V2.id, A.id)).plan_start, "2026-01-01", "nothing of the refused file was written");
    const r = await plan.importPlanSheet(db, { projectId: P, versionId: V2.id, content: file([[N.code, A.code, "2026-05-01", 2, "", 0, 33.3333333333], [N3.code, A.code, "2026-06-01", 1]]), userId: U.id });
    equal(r, { added: 1, updated: 1 });
    const a = await one(V2.id, A.id);
    equal([a.plan_start, a.plan_end, a.volumePlan], ["2026-05-01", "2026-05-02", 33.3333333333]);
    equal((await one(V2.id, twin.id)).plan_start, "2026-06-01");
  });
});

test("a version with planning rows is not deleted nor moved to another PMS; its rows go first", async () => {
  await inP(async () => {
    await throws(() => eps.removeEps(db, { projectId: P, kind: "version", id: V2.id }), "ردیف برنامه");
    await throws(() => eps.moveEps(db, { projectId: P, kind: "version", id: V2.id, pmsId: PM2.id }), "PMS دیگری نمی‌رود");
    await throws(() => eps.removeEps(db, { projectId: P, kind: "pms", id: PM2.id }), "نسخه");
    const ids = (await plan.planRows(db, { projectId: P, versionId: V2.id })).rows.map((x) => x.id);
    equal(await plan.removePlanRows(db, { projectId: P, ids, userId: U.id }), { removed: ids.length });
    await eps.moveEps(db, { projectId: P, kind: "version", id: V2.id, pmsId: PM2.id });
    await eps.removeEps(db, { projectId: P, kind: "version", id: V2.id });
    equal((await one(V1.id, A.id)).plan.volume_plan, 100, "the other version's plan is untouched");
  });
});

test("through the route: contract access decides; a version and a row of another contract are not reached", async () => {
  const route = await import("../../app/api/eps/planning/route.js");
  const req = (url, as, body) => new Request(`http://x${url}`, { method: body ? "POST" : "GET",
    headers: { authorization: `Bearer kc|${as}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const ok = await route.GET(req(`/api/eps/planning?projectId=${P}&versionId=${V1.id}`, "plan"));
  const body = await ok.json();
  equal([ok.status, body.rows.length, body.may.edit], [200, 2, true]);
  const stranger = await projects.ensureUser(db, { subject: "kc|plan-x", displayName: "x" });
  await projects.addMember(db, { projectId: P, userId: stranger.id, role: "engineer" });
  equal((await route.GET(req(`/api/eps/planning?projectId=${P}&versionId=${V1.id}`, "plan-x"))).status, 404, "not on the contract: not there");
  equal((await route.POST(req("/api/eps/planning", "plan-x", { projectId: P, kind: "plan-add", versionId: V1.id, activityIds: [B.id] }))).status, 404);
  equal((await route.POST(req("/api/eps/planning", "plan", { projectId: P, kind: "plan-copy", fromVersionId: V1.id, toVersionId: VX.id }))).status, 400,
    "a copy across PMSs of one contract reaches the repository, which refuses it");
});

await run();
