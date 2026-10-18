#!/usr/bin/env node
/**
 * Duties and the workflow tree (migration 079, lib/db/repos/workflows.mjs,
 * lib/reports/workflow.mjs; owner's requirements of 2026-10-18, items 1–3):
 * a duty held by people and placed in a review group; a tree of workflows,
 * one of which a form follows; pages and tree rows a duty reaches; days to
 * review; and a form that is not written without a workflow.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.PGLITE_DIR = await scratchDir("workflows-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const rp = await import("../../lib/db/repos/reports.mjs");
const wfs = await import("../../lib/db/repos/workflows.mjs");
const wf = await import("../../lib/reports/workflow.mjs");

const db = await getDb();
const pm = await projects.ensureUser(db, { subject: "kc|wf-pm", displayName: "PM" });
const ali = await projects.ensureUser(db, { subject: "kc|wf-ali", displayName: "Ali" });       // holds «site manager»
const sara = await projects.ensureUser(db, { subject: "kc|wf-sara", displayName: "Sara" });    // holds «resources clerk»: one page, one branch
const reza = await projects.ensureUser(db, { subject: "kc|wf-reza", displayName: "Reza" });    // named in a group directly
const outsider = await projects.ensureUser(db, { subject: "kc|wf-out" });
const P = (await projects.createProject(db, { code: "WFT", name: "W", ownerUserId: pm.id })).id;
for (const u of [ali, sara, reza]) await projects.addMember(db, { projectId: P, userId: u.id, role: "viewer" });
const as = (fn) => withProject(db, P, fn);
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let site, clerk, folder, flow, A, B, G = {}, pages = {};
test("a duty: a name, the access it carries and who holds it — every holder a project member", async () => {
  await as(async () => {
    await throws(() => wfs.saveDuty(db, { projectId: P, name: " " }), "نام وظیفه");
    await throws(() => wfs.saveDuty(db, { projectId: P, name: "x", permissions: ["fly"] }), "ناشناخته");
    site = await wfs.saveDuty(db, { projectId: P, code: "SM", name: "مدیر کارگاه", permissions: ["view", "create", "edit", "sign", "approve"] });
    clerk = await wfs.saveDuty(db, { projectId: P, code: "RC", name: "کارشناس منابع", permissions: ["view", "edit"] });
    await throws(() => wfs.saveDuty(db, { projectId: P, code: "SM", name: "دیگر" }), "ثبت شده");
    await throws(() => wfs.setDutyMembers(db, { projectId: P, dutyId: site.id, userIds: [outsider.id] }), "عضو پروژه");
    equal(await wfs.setDutyMembers(db, { projectId: P, dutyId: site.id, userIds: [ali.id] }), 1);
    await wfs.setDutyMembers(db, { projectId: P, dutyId: clerk.id, userIds: [sara.id] });
    const list = await wfs.duties(db, { projectId: P });
    equal(list.map((d) => [d.code, d.members.map((m) => m.name)]).sort(), [["RC", ["Sara"]], ["SM", ["Ali"]]]);
  });
});

test("the workflow tree: folders and workflows; a node does not go under its own branch, nor is removed while used", async () => {
  await as(async () => {
    folder = await wfs.saveWorkflow(db, { projectId: P, name: "گزارش‌های کارگاه" });
    flow = await wfs.saveWorkflow(db, { projectId: P, parentId: folder.id, code: "SITE", name: "گردش گزارش روزانه" });
    await throws(() => wfs.saveWorkflow(db, { projectId: P, id: folder.id, parentId: flow.id, name: "گزارش‌های کارگاه" }), "زیر خودش");
    await throws(() => wfs.removeWorkflow(db, { projectId: P, id: folder.id }), "گره‌های دیگری");
    const st1 = await rp.upsertStage(db, { projectId: P, workflowId: flow.id, seq: 1, name: "پیمانکار" });
    const st2 = await rp.upsertStage(db, { projectId: P, workflowId: flow.id, seq: 2, name: "نظارت" });
    G.site = await rp.upsertGroup(db, { projectId: P, stageId: st1.id, seq: 1, name: "کارگاه" });
    G.sup = await rp.upsertGroup(db, { projectId: P, stageId: st2.id, seq: 1, name: "نظارت" });
    const tree = await wfs.workflowTree(db, { projectId: P });
    equal(tree.map((w) => [w.name, w.parentId === folder.id, w.stages]), [["گردش گزارش روزانه", true, 2], ["گزارش‌های کارگاه", false, 0]]);
  });
});

test("a form follows one workflow; one workflow serves two forms; no workflow, no report; changed only before its first report", async () => {
  await as(async () => {
    A = await rp.upsertReportType(db, { projectId: P, code: "RA", name: "فرم الف" });
    B = await rp.upsertReportType(db, { projectId: P, code: "RB", name: "فرم ب" });
    await throws(() => wfs.attachWorkflow(db, { projectId: P, reportTypeId: A.id, workflowId: folder.id }), "مرحله‌ای ندارد", "a folder is not a workflow");
    await rp.setGroupMember(db, { projectId: P, groupId: G.site.id, userId: reza.id, permissions: ["view", "create", "edit", "sign"] });
    await throws(() => rp.createReport(db, { projectId: P, reportTypeId: A.id, reportDate: day(1), userId: reza.id }), "گردش کاری تعیین نشده",
      "a form is not written without a workflow (item 3)");
    await wfs.attachWorkflow(db, { projectId: P, reportTypeId: A.id, workflowId: flow.id });
    await wfs.attachWorkflow(db, { projectId: P, reportTypeId: B.id, workflowId: flow.id });
    equal((await rp.workflowOf(db, { projectId: P, reportTypeId: B.id })).map((s) => s.name), ["پیمانکار", "نظارت"], "B follows the same stages");
    await throws(() => wfs.removeWorkflow(db, { projectId: P, id: flow.id }), "فرم از این گردش کار");
    await rp.createReport(db, { projectId: P, reportTypeId: B.id, reportDate: day(1), content: {}, userId: reza.id });
    const other = await wfs.saveWorkflow(db, { projectId: P, name: "دیگری" });
    await rp.upsertStage(db, { projectId: P, workflowId: other.id, seq: 1, name: "یک" });
    await throws(() => wfs.attachWorkflow(db, { projectId: P, reportTypeId: B.id, workflowId: other.id }), "عوض نمی‌شود",
      "a report's history is tied to its workflow's stages");
    const second = (await rp.workflowOf(db, { projectId: P, workflowId: flow.id }))[1].id;
    await throws(() => rp.removeStage(db, { projectId: P, stageId: second }), "گزارش ثبت شده",
      "a stage of a workflow that a report of any of its forms used stays");
  });
});

test("a type set up the old way gets a workflow of its own, named after it", async () => {
  await as(async () => {
    const C = await rp.upsertReportType(db, { projectId: P, code: "RC", name: "فرم ج" });
    await rp.upsertStage(db, { projectId: P, reportTypeId: C.id, seq: 1, name: "تنها" });
    const t = (await rp.reportTypes(db, { projectId: P })).find((x) => x.code === "RC");
    equal([t.workflow_name, t.stages.map((s) => s.name)], ["فرم ج", ["تنها"]]);
  });
});

test("a duty in a group: its holders are members with its rights; whoever holds it acts, and a duty in use is not deleted", async () => {
  await as(async () => {
    await wfs.setGroupDuty(db, { projectId: P, groupId: G.site.id, dutyId: site.id, reviewDays: 2 });
    let m = (await rp.workflowOf(db, { projectId: P, workflowId: flow.id }))[0].groups[0].members;
    equal(m.map((x) => [x.name, x.permissions.includes("approve"), x.via]).sort(), [["Ali", true, ["مدیر کارگاه"]], ["Reza", false, []]],
      "the duty's own rights when the group gives none");
    const r = await rp.createReport(db, { projectId: P, reportTypeId: A.id, reportDate: day(1), content: { n: 1 }, userId: ali.id });
    equal(r.stage_seq, 1, "Ali creates through his duty");
    await throws(() => wfs.removeDuty(db, { projectId: P, id: site.id }), "از گروه‌ها بردارید");
    await rp.setStageApprover(db, { projectId: P, stageId: (await rp.workflowOf(db, { projectId: P, workflowId: flow.id }))[0].id, approverId: ali.id });
    // the duty changes hands: Ali leaves it, Reza's rights stay his own
    await wfs.setDutyMembers(db, { projectId: P, dutyId: site.id, userIds: [] });
    m = (await rp.workflowOf(db, { projectId: P, workflowId: flow.id }))[0].groups[0].members;
    equal(m.map((x) => x.name), ["Reza"]);
    await throws(() => rp.createReport(db, { projectId: P, reportTypeId: A.id, reportDate: day(1), userId: ali.id }), "حق ایجاد");
    await wfs.setDutyMembers(db, { projectId: P, dutyId: site.id, userIds: [ali.id] });
  });
});

let rep;
test("pages and rows: a duty reaches only its pages and the branches it was given; a member named directly reaches all", async () => {
  await as(async () => {
    pages.work = await wfs.savePage(db, { projectId: P, workflowId: flow.id, pageNo: 1, name: "شرح کار", sections: ["narrative"] });
    pages.res = await wfs.savePage(db, { projectId: P, workflowId: flow.id, pageNo: 2, name: "منابع", sections: ["resources"] });
    await throws(() => wfs.savePage(db, { projectId: P, workflowId: flow.id, pageNo: 2, name: "x" }), "در این گردش کار هست");
    await wfs.setGroupDuty(db, { projectId: P, groupId: G.site.id, dutyId: clerk.id, pages: [pages.res.id], scope: ["branch-pipe"] });
    rep = await rp.createReport(db, { projectId: P, reportTypeId: A.id, reportDate: day(1), content: { v: 1 }, userId: reza.id });
    const edit = (userId, v, touched) => rp.editReport(db, { projectId: P, reportId: rep.id, content: { v }, userId,
      inspect: async () => ({ added: 0, changed: 1, removed: 0, touched }) });
    await throws(() => edit(sara.id, 2, [{ section: "narrative", path: ["branch-pipe"], label: "فیت‌آپ" }]), "بیرون از صفحه‌ها",
      "the narrative is on page 1, which her duty does not reach");
    await throws(() => edit(sara.id, 2, [{ section: "resources", path: ["welder", "branch-civil"], label: "بنا" }]), "«بنا»",
      "a resource under another branch is not hers");
    equal((await edit(sara.id, 2, [{ section: "resources", path: ["welder", "branch-pipe"], label: "جوشکار" }])).versionNo, 2,
      "a resource anywhere under her branch is");
    equal((await edit(reza.id, 3, [{ section: "narrative", path: [] }, { section: "header", path: [] }])).versionNo, 3,
      "a member named in the group, not through a duty, reaches the whole form");
  });
});

test("days to review: the group's deadline runs from the report's arrival at the stage; past it, unsigned, it is overdue", async () => {
  await as(async () => {
    const v = await rp.reportView(db, { projectId: P, reportId: rep.id, userId: reza.id });
    const g = v.signatureBoxes[0].groups[0];
    equal([g.reviewDays, g.overdue], [2, false]);
    assert(Math.abs(Date.parse(g.due) - (Date.parse(v.report.created_at) + 2 * 86_400_000)) < 1000, `due two days after arrival (${g.due})`);
    // the rule on its own: a report that arrived three days ago is past a two-day review
    const s = (await rp.snapshotOf(db, { projectId: P, reportId: rep.id })).snapshot;
    const due = wf.reviewDue({ ...s, createdT: BigInt(Date.now() - 3 * 86_400_000) * 1000n }, 1).find((x) => x.groupId === G.site.id);
    assert(Date.parse(due.due) < Date.now(), "three days in, the two days are past");
    equal(wf.reviewDue(s, 2)[0].reviewDays, null, "a group without a duty's days has no deadline");
  });
});

await run();
