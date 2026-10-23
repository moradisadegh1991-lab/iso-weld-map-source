#!/usr/bin/env node
/**
 * Duties and the workflow tree (migration 079, lib/db/repos/workflows.mjs,
 * lib/reports/workflow.mjs; owner's requirements of 2026-10-18, items 1–3):
 * a duty held by people and placed in a review group; a tree of workflows,
 * one of which a form follows; pages and tree rows a duty reaches; days to
 * review; and a form that is not written without a workflow.
 * And (owner's requirements of 2026-10-22, items 1 and 2-a): roles under a
 * contract gathering duties; a holder's own access level and temporary
 * access between two days; the final approver and deputy named by a duty;
 * a stage's deadline that approves it when the days run out, its text in
 * place of the signature.
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

// ── 2026-10-22: roles, a holder's own access, temporary access, approver by duty, stage deadlines ──

let K, role;
test("roles under a contract gather its duties; a role with duties is not removed; the same name once per contract", async () => {
  const ctr = await import("../../lib/db/repos/contracts.mjs");
  await as(async () => {
    K = await ctr.upsertContract(db, { projectId: P, contractNo: "WF-C1", title: "Piping", kind: "main", counterparty: "KPC", currency: "IRR", userId: pm.id });
    await throws(() => wfs.saveRole(db, { projectId: P, contractId: K.id, name: " " }), "نام نقش");
    role = await wfs.saveRole(db, { projectId: P, contractId: K.id, name: "نظارت کارگاه" });
    await throws(() => wfs.saveRole(db, { projectId: P, contractId: K.id, name: "نظارت کارگاه" }), "در این قرارداد هست");
    await wfs.saveDuty(db, { projectId: P, id: site.id, code: "SM", name: site.name, permissions: site.permissions, roleId: role.id });
    const d = (await wfs.duties(db, { projectId: P })).find((x) => x.id === site.id);
    equal([d.roleName, d.contractNo], ["نظارت کارگاه", "WF-C1"]);
    await throws(() => wfs.removeRole(db, { projectId: P, id: role.id }), "۱ وظیفه".replace("۱", "1"));
    equal((await wfs.roles(db, { projectId: P })).map((r) => [r.name, r.contract_no]), [["نظارت کارگاه", "WF-C1"]]);
  });
});

test("a holder's own access level: of the duty's rights in the group, only theirs; unknown rights refused; cleared, all of the duty's again", async () => {
  await as(async () => {
    const ali1 = async () => (await rp.workflowOf(db, { projectId: P, workflowId: flow.id }))[0].groups[0].members.find((m) => m.userId === ali.id);
    await throws(() => wfs.setDutyMember(db, { projectId: P, dutyId: site.id, userId: ali.id, permissions: ["fly"] }), "ناشناخته");
    await throws(() => wfs.setDutyMember(db, { projectId: P, dutyId: site.id, userId: outsider.id }), "عضو پروژه");
    await wfs.setDutyMember(db, { projectId: P, dutyId: site.id, userId: ali.id, permissions: ["view", "sign"] });
    equal((await ali1()).permissions.sort(), ["sign", "view"], "the duty may approve and create; Ali, only view and sign");
    equal((await wfs.duties(db, { projectId: P })).find((x) => x.id === site.id).members[0].permissions, ["view", "sign"]);
    await wfs.setDutyMember(db, { projectId: P, dutyId: site.id, userId: ali.id, permissions: null });
    assert((await ali1()).permissions.includes("approve"), "no level of his own: the duty's rights");
  });
});

test("temporary access: both days required, the last not before the first; it counts only between them", async () => {
  await as(async () => {
    const sara1 = async () => (await rp.workflowOf(db, { projectId: P, workflowId: flow.id }))[0].groups[0].members.some((m) => m.userId === sara.id);
    await throws(() => wfs.setDutyMember(db, { projectId: P, dutyId: clerk.id, userId: sara.id, temporary: true, startsOn: day(3) }), "تاریخ شروع و پایان");
    await throws(() => wfs.setDutyMember(db, { projectId: P, dutyId: clerk.id, userId: sara.id, temporary: true, startsOn: day(1), endsOn: day(3) }), "پیش از شروع");
    await wfs.setDutyMember(db, { projectId: P, dutyId: clerk.id, userId: sara.id, temporary: true, startsOn: day(10), endsOn: day(5) });
    equal(await sara1(), false, "a holding that ended five days ago does not count");
    await wfs.setDutyMember(db, { projectId: P, dutyId: clerk.id, userId: sara.id, temporary: true, startsOn: day(1), endsOn: day(-1) });
    equal(await sara1(), true, "from yesterday to tomorrow: she holds it today");
    const m = (await wfs.duties(db, { projectId: P })).find((x) => x.id === clerk.id).members[0];
    equal([m.temporary, m.startsOn, m.endsOn], [true, day(1), day(-1)]);
  });
});

test("the final approver and deputy named by a duty: its holders approve, no one else; a person or a duty, not both; the duty must sign at the stage", async () => {
  await as(async () => {
    const st1 = (await rp.workflowOf(db, { projectId: P, workflowId: flow.id }))[0];
    await throws(() => rp.setStageApprover(db, { projectId: P, stageId: st1.id, approverId: ali.id, approverDutyId: site.id }), "نه هر دو");
    await throws(() => rp.setStageApprover(db, { projectId: P, stageId: st1.id, deputyDutyId: clerk.id }), "جانشین بدون");
    const other = await wfs.saveDuty(db, { projectId: P, code: "OT", name: "دیگر", permissions: ["view", "sign"] });
    await throws(() => rp.setStageApprover(db, { projectId: P, stageId: st1.id, approverDutyId: other.id }), "با حق امضا");
    await rp.setStageApprover(db, { projectId: P, stageId: st1.id, approverDutyId: site.id });
    const r = await rp.createReport(db, { projectId: P, reportTypeId: A.id, reportDate: day(1), content: { a: 1 }, userId: reza.id });
    let snap = (await rp.snapshotOf(db, { projectId: P, reportId: r.id })).snapshot;
    equal(snap.stages[0].approverIds, [ali.id], "whoever holds the duty today");
    assert(/تأییدکنندهٔ نهایی تعیین‌شده/.test(wf.checkApprove(snap, reza.id).reason), "Reza may sign but not approve");
    await rp.signReport(db, { projectId: P, reportId: r.id, userId: ali.id });
    snap = (await rp.snapshotOf(db, { projectId: P, reportId: r.id })).snapshot;
    equal(wf.checkApprove(snap, ali.id).ok, true, "Ali, holding the duty, approves after signing");
    equal((await rp.approveStage(db, { projectId: P, reportId: r.id, userId: ali.id })).stage_seq, 2);
  });
});

test("a stage's deadline: days and text, both or neither; when they run out the stage is approved then, by no one, its text in place of the signature", async () => {
  await as(async () => {
    const [st1, st2] = await rp.workflowOf(db, { projectId: P, workflowId: flow.id });
    await throws(() => rp.setStageDeadline(db, { projectId: P, stageId: st1.id, days: 2 }), "متنی که به جای امضا");
    await throws(() => rp.setStageDeadline(db, { projectId: P, stageId: st1.id, days: 0, text: "x" }), "۱ تا ۳۶۵");
    await rp.setStageDeadline(db, { projectId: P, stageId: st1.id, days: 2, text: "بررسی نشد؛ با گذشت مهلت تأییدشده" });
    const r = await rp.createReport(db, { projectId: P, reportTypeId: A.id, reportDate: day(3), content: { d: 1 }, userId: reza.id });
    let snap = (await rp.snapshotOf(db, { projectId: P, reportId: r.id })).snapshot;
    equal([snap.stageSeq, wf.deadlinesPassed(snap, BigInt(Date.now()) * 1000n)], [1, []], "a fresh report has its two days");
    await db.query("UPDATE report SET created_at = now() - interval '3 days' WHERE id = $1", [r.id]);
    const v = await rp.reportView(db, { projectId: P, reportId: r.id, userId: reza.id });
    equal([v.report.stage_seq, v.report.status], [2, "open"], "three days in, the first stage's two days ran out: on to the second");
    const auto = v.decisions.find((d) => d.auto);
    equal([auto.stageSeq, auto.by, auto.autoText], [1, null, "بررسی نشد؛ با گذشت مهلت تأییدشده"]);
    assert(Math.abs(Date.parse(auto.at) - (Date.parse(v.report.created_at) + 2 * 86_400_000)) < 2000, `approved when the days ran out (${auto.at})`);
    equal(v.signatureBoxes[0].auto.text, "بررسی نشد؛ با گذشت مهلت تأییدشده", "the text stands where the stage's signature would be");
    equal(v.signatureBoxes[1].deadlineAt, null, "the second stage has no days");
    // the last stage's days too: the report becomes the record, as it stood
    await rp.setStageDeadline(db, { projectId: P, stageId: st2.id, days: 1, text: "نظارت بررسی نکرد" });
    const r2 = await rp.createReport(db, { projectId: P, reportTypeId: A.id, reportDate: day(5), content: { d: 2 }, userId: reza.id });
    await db.query("UPDATE report SET created_at = now() - interval '5 days' WHERE id = $1", [r2.id]);
    const list = await rp.listReports(db, { projectId: P, reportTypeId: A.id, userId: reza.id });
    equal(list.find((x) => x.id === r2.id).status, "approved", "listed: both stages' days ran out, the report is the record");
    snap = (await rp.snapshotOf(db, { projectId: P, reportId: r2.id })).snapshot;
    equal(snap.decisions.filter((d) => d.auto).map((d) => d.stageSeq), [1, 2]);
    await rp.setStageDeadline(db, { projectId: P, stageId: st1.id, days: null, text: null });
    await rp.setStageDeadline(db, { projectId: P, stageId: st2.id, days: null });
    equal((await rp.workflowOf(db, { projectId: P, workflowId: flow.id })).map((x) => x.deadlineDays), [null, null], "no days, no limit");
  });
});

await run();
