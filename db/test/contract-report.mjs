#!/usr/bin/env node
/**
 * The contract's daily report (owner's spec 2026-10-15, steps 5–6): header,
 * narrative, problems and resources; a later stage writes its own values for
 * a row and never the first stage's; changed rows are shown per stage, latest
 * first, in the stage's colour; resources summed over a period with filters;
 * copy from an earlier report; photos and files.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import path from "node:path";
import * as cd from "../../lib/reports/contract-daily.mjs";

// ── the rules ────────────────────────────────────────────────────────────

const row = (base, stages = {}, id = undefined) => ({ id, base, stages });

test("content: totals derived, local + non-local must make the total, a quantity needs its unit", async () => {
  const { problems } = cd.checkContent({ header: { base: { tempMin: 30, tempMax: 20, startTime: "7:00" } },
    resources: [row({ resourceId: "a", day: 5, night: 1, leave: 1, sick: 0, local: 3, nonLocal: 3 })],
    narrative: [row({ title: "بتن‌ریزی", qty: 12 })], problems: [row({ description: "" })] }, { resourceIds: new Set(["a"]) });
  for (const want of ["HH:MM", "حداقل دما", "بومی + غیربومی (6)", "واحد لازم", "شرح هر مشکل"]) assert(problems.some((p) => p.includes(want)), `${want}: ${problems.join(" | ")}`);
  equal(cd.total({ day: 5, night: 1, leave: 1, sick: 2 }), 9);
  const { problems: foreign } = cd.checkContent({ resources: [row({ resourceId: "zz", day: 1 })] }, { resourceIds: new Set(["a"]) });
  assert(foreign.some((p) => p.includes("از منابع این قرارداد نیست")));
});

test("resource rows by executive work group: the group is from the contract's tree, one row per resource and group (owner's review, item 8)", async () => {
  const opts = { resourceIds: new Set(["a", "b"]), workGroupIds: new Set(["g1", "g2"]) };
  const ok = cd.checkContent({ resources: [row({ workGroupId: "g1", resourceId: "a", day: 2 }), row({ workGroupId: "g2", resourceId: "a", day: 3 })] }, opts);
  equal(ok.problems, []);
  const foreign = cd.checkContent({ resources: [row({ workGroupId: "zz", resourceId: "a", day: 1 })] }, opts);
  assert(foreign.problems.some((p) => p.includes("گروه اجرایی")), foreign.problems.join(" | "));
  const twice = cd.checkContent({ resources: [row({ workGroupId: "g1", resourceId: "a", day: 1 }), row({ workGroupId: "g1", resourceId: "a", day: 2 })] }, opts);
  assert(twice.problems.some((p) => p.includes("یک ردیف کافی")), twice.problems.join(" | "));
  const gone = cd.checkContent({ resources: [row({ workGroupId: "g1", resourceId: "a", day: 1 }), row({ workGroupId: "g1", resourceId: "a", day: 2 }, { 2: { removed: true } })] }, opts);
  equal(gone.problems, [], "a row removed at a later stage does not count twice");
});

test("the upper resources part: every resource in its tree order, the report's rows summed per resource, sums per unit at the foot", async () => {
  const tree = [{ id: "c1", name: "نیرو", children: [{ id: "c2", name: "جوشکاری", children: [], resources: [{ id: "a", name: "جوشکار", kind: "person", unit: "نفر", seq: 1 }] }],
    resources: [{ id: "b", name: "فیتر", kind: "person", unit: "نفر", seq: 1 }] }];
  const loose = [{ id: "m", name: "جرثقیل", kind: "machine", unit: "دستگاه", seq: 1 }];
  const rows = [row({ workGroupId: "g1", resourceId: "a", day: 2, night: 1, leave: 0, sick: 1, local: 3, nonLocal: 1 }),
    row({ workGroupId: "g2", resourceId: "a", day: 3, local: 2, nonLocal: 1 }),
    row({ workGroupId: "g1", resourceId: "a", day: 9 }, { 2: { removed: true } }),
    row({ resourceId: "m", day: 1 })];
  const b = cd.resourceBoard(rows, tree, loose);
  equal(b.items.map((x) => (x.type === "branch" ? `[${x.name}]` : x.name)), ["[نیرو]", "فیتر", "[جوشکاری]", "جوشکار", "[بدون دسته]", "جرثقیل"],
    "branches, then their resources, depth first; resources in no branch last");
  const a = b.items.find((x) => x.id === "a");
  equal([a.day, a.night, a.sick, a.total, a.local, a.nonLocal, a.rows, a.category], [5, 1, 1, 7, 5, 2, 2, "نیرو / جوشکاری"],
    "both work groups' rows summed; the removed one not");
  equal(b.items.find((x) => x.id === "b").total, 0, "a resource with no row shows, at zero");
  equal([b.byUnit["نفر"].total, b.byUnit["دستگاه"].total], [7, 1], "people and machines are summed apart");
});

test("a later stage writes only its own values; the first stage's stay; a row is marked removed, never dropped", async () => {
  const prev = { header: { base: {}, stages: {} }, narrative: [], problems: [], resources: [{ id: "r1", base: { resourceId: "a", day: 5 }, stages: {} }] };
  const mine = structuredClone(prev); mine.resources[0].stages["2"] = { resourceId: "a", day: 4 };
  const d = cd.diffContent(prev, mine, { stageSeq: 2, firstSeq: 1 });
  equal({ ...d, touched: d.touched.map((t) => [t.section, t.row.id]) }, { added: 0, changed: 1, removed: 0, illegal: [], touched: [["resources", "r1"]] },
    "and it says which rows it reaches, for a duty limited to some rows");
  const base = structuredClone(prev); base.resources[0].base.day = 4;
  assert(cd.diffContent(prev, base, { stageSeq: 2, firstSeq: 1 }).illegal.length, "stage 2 does not rewrite stage 1's number");
  const drop = structuredClone(prev); drop.resources = [];
  assert(cd.diffContent(prev, drop, { stageSeq: 2, firstSeq: 1 }).illegal.length, "a later stage does not delete a row");
  const mark = structuredClone(prev); mark.resources[0].stages["2"] = { removed: true };
  equal(cd.diffContent(prev, mark, { stageSeq: 2, firstSeq: 1 }).removed, 1);
  const dd = cd.diffContent(prev, drop, { stageSeq: 1, firstSeq: 1 });
  equal([dd.added, dd.changed, dd.removed, dd.illegal], [0, 0, 1, []], "the first stage writes its own rows");
  const add = structuredClone(prev); add.resources.push({ id: "r2", base: null, addedAt: 2, stages: { 2: { resourceId: "a", day: 2 } } });
  equal(cd.diffContent(prev, add, { stageSeq: 2, firstSeq: 1 }).added, 1);
});

test("what a row shows: as first written, then each stage that changed it — latest first, in its colour; effective is the latest", async () => {
  const stages = [{ seq: 1, name: "پیمانکار" }, { seq: 2, name: "نظارت", changeColor: "#2e86c1" }, { seq: 3, name: "کارفرما", changeColor: "#c0392b" }];
  const r = { id: "x", base: { resourceId: "a", day: 5, night: 1 }, stages: { 2: { day: 4, confirmed: true }, 3: { confirmed: true } } };
  const d = cd.displayLines(r, stages);
  equal([d.lines.map((l) => [l.stage, l.color, l.values.day]), d.confirmedBy, d.effective.day], [[["نظارت", "#2e86c1", 4]], ["نظارت", "کارفرما"], 4],
    "stage 3 only confirmed: no line of its own");
  const r2 = { ...r, stages: { 2: { day: 4 }, 3: { day: 3 } } };
  equal(cd.displayLines(r2, stages).lines.map((l) => l.stage), ["کارفرما", "نظارت"], "latest stage first");
  const same = { ...r, stages: { 2: { day: 5 } } };
  equal(cd.displayLines(same, stages).lines.length, 0, "a stage that wrote the same number changed nothing");
  const c = cd.copyFrom({ header: { base: { startTime: "07:00", weather: "rain" } }, narrative: [r2], resources: [r2], problems: [row({ description: "x" })] });
  equal([c.resources[0].base.day, c.resources[0].stages, c.problems.length, c.header.base.weather, c.header.base.startTime], [3, {}, 0, null, "07:00"],
    "a copy starts from where the earlier report stands; today's weather and problems are today's");
});

// ── in the database ──────────────────────────────────────────────────────

const dir = await scratchDir("cr-db-");
process.env.PGLITE_DIR = dir;
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const rp = await import("../../lib/db/repos/reports.mjs");
const cr = await import("../../lib/db/repos/contract-reports.mjs");
const org = await import("../../lib/db/repos/org.mjs");
const res = await import("../../lib/db/repos/resources.mjs");
const ctr = await import("../../lib/db/repos/contracts.mjs");
const { createLocalStore } = await import("../../lib/storage/content-store.mjs");
const db = await getDb();
const store = createLocalStore({ root: path.join(dir, "files") });
const U = {};
for (const k of ["planner", "site", "sup", "client", "reader"]) U[k] = await projects.ensureUser(db, { subject: `kc|${k}`, displayName: k });
const P = (await projects.createProject(db, { code: "CR1", name: "C", ownerUserId: U.planner.id })).id;
for (const k of ["site", "sup", "client", "reader"]) await projects.addMember(db, { projectId: P, userId: U[k].id, role: "engineer" });
const inP = (fn) => withProject(db, P, fn);
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
let C, type, R, welder, crane, other, concrete, WG;

await inP(async () => {
  const { rows: [civ] } = await db.query("INSERT INTO contractor (project_id, code, name) VALUES ($1, 'CIV', 'Civil') RETURNING id", [P]);
  C = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-01", title: "Civil", kind: "subcontract", contractorId: civ.id, currency: "USD", userId: U.planner.id });
  const other2 = await ctr.upsertContract(db, { projectId: P, contractNo: "SC-02", title: "Other", kind: "subcontract", contractorId: civ.id, currency: "USD", userId: U.planner.id });
  const people = await org.addCategory(db, { projectId: P, contractId: C.id, tree: "resource", name: "نیروی انسانی" });
  concrete = await org.addCategory(db, { projectId: P, contractId: C.id, tree: "narrative", name: "بتن" });
  welder = await res.upsertResource(db, { projectId: P, contractId: C.id, categoryId: people.id, kind: "person", name: "جوشکار", forecastQty: 10 });
  WG = await org.addCategory(db, { projectId: P, contractId: C.id, tree: "work_group", name: "اکیپ ۱" });
  crane = await res.upsertResource(db, { projectId: P, contractId: C.id, kind: "machine", name: "جرثقیل" });
  other = await res.upsertResource(db, { projectId: P, contractId: other2.id, kind: "person", name: "بنا" });
  type = await cr.ensureType(db, { projectId: P });
  const w = await rp.workflowOf(db, { projectId: P, reportTypeId: type.id });
  const g = (seq, i = 0) => w.find((s) => s.seq === seq).groups[i].id;
  await rp.setGroupMember(db, { projectId: P, groupId: g(1), userId: U.planner.id, permissions: ["view", "create", "add_content", "edit", "delete_content", "sign"] });
  await rp.setGroupMember(db, { projectId: P, groupId: g(1, 1), userId: U.site.id, permissions: ["view", "sign"] });
  await rp.setGroupMember(db, { projectId: P, groupId: g(2), userId: U.sup.id, permissions: ["view", "edit", "add_content", "delete_content", "sign", "return"] });
  await rp.setGroupMember(db, { projectId: P, groupId: g(3), userId: U.client.id, permissions: ["view", "sign"] });
  for (const [seq, who, color] of [[1, U.site, null], [2, U.sup, "#2e86c1"], [3, U.client, "#c0392b"]]) {
    const st = w.find((s) => s.seq === seq);
    await rp.setStageApprover(db, { projectId: P, stageId: st.id, approverId: who.id });
    if (color) await rp.setStageColor(db, { projectId: P, stageId: st.id, color });
  }
});

const view = (u = U.planner) => inP(() => cr.contractReportView(db, { projectId: P, reportId: R.id, userId: u.id }));
const edit = (content, u) => inP(() => cr.editContractReport(db, { projectId: P, reportId: R.id, content, userId: u.id }));

test("a report of a contract: header, rows from the contract's own resources and narrative tree", async () => {
  R = await inP(() => cr.createContractReport(db, { projectId: P, contractId: C.id, reportDate: today, title: "گزارش روزانهٔ سیویل",
    header: { startTime: "07:00", endTime: "17:30", dayStatus: "working", tempMin: 24, tempMax: 38, weather: "clear", humidity: 55 }, userId: U.planner.id }));
  equal(R.contract_id, C.id);
  const v0 = await view();
  const c = structuredClone(v0.content);
  c.resources.push({ base: { resourceId: other.id, day: 1 } });
  await throws(() => edit(c, U.planner), "از منابع این قرارداد نیست");
  c.resources = [{ base: { workGroupId: concrete.id, resourceId: welder.id, day: 1 } }];
  await throws(() => edit(c, U.planner), "گروه اجرایی", "a narrative branch is not a work group");
  c.resources = [{ base: { workGroupId: WG.id, resourceId: welder.id, day: 5, night: 2, leave: 1, sick: 0, local: 5, nonLocal: 3 } }, { base: { resourceId: crane.id, day: 1 } }];
  c.narrative = [{ base: { categoryId: concrete.id, title: "بتن‌ریزی فونداسیون", description: "F-101", unit: "m³", qty: 24 } }];
  c.problems = [{ base: { description: "تأخیر بتن", scope: "F-101", cause: "تأمین‌کننده", hours: 2 } }];
  await edit(c, U.planner);
  const v = await view();
  equal([v.summary.day, v.summary.night, v.summary.total, v.summary.byUnit["نفر"], v.summary.byUnit["دستگاه"]], [5, 2, 8, 8, 1],
    "people are counted apart from machines; each unit on its own");
  equal(v.stages.map((s) => [s.name, s.current, s.approved]), [["پیمانکار", true, false], ["نظارت", false, false], ["کارفرما", false, false]]);
  equal([v.board.items.find((x) => x.id === welder.id).total, v.workGroupTree.map((n) => n.name)], [8, ["اکیپ ۱"]], "the view carries the board and the work groups");
});

test("through the stages: a later stage edits its own row, the first stage's number stays, the change shows in the stage's colour", async () => {
  await inP(async () => {
    await rp.signReport(db, { projectId: P, reportId: R.id, userId: U.planner.id });
    await rp.signReport(db, { projectId: P, reportId: R.id, userId: U.site.id });
    await rp.approveStage(db, { projectId: P, reportId: R.id, userId: U.site.id });
  });
  const v = await view(U.sup);
  const c = structuredClone(v.content);
  const welderRow = c.resources.find((r) => r.base.resourceId === welder.id);
  const tamper = structuredClone(c); Object.assign(tamper.resources.find((r) => r.id === welderRow.id).base, { day: 4, nonLocal: 2 });
  await throws(() => edit(tamper, U.sup), "مقدار ثبت‌شدهٔ مرحلهٔ اول");
  welderRow.stages["2"] = { resourceId: welder.id, day: 4, night: 2, leave: 1, sick: 1, local: 5, nonLocal: 3 };
  c.resources.find((r) => r.base.resourceId === crane.id).stages["2"] = { confirmed: true };
  c.problems[0].stages["2"] = { removed: true };
  c.narrative.push({ base: null, stages: { 2: { categoryId: concrete.id, title: "قالب‌بندی", unit: "m²", qty: 40 } } });
  await edit(c, U.sup);
  const after = await view(U.sup);
  const w = after.lines.resources.find((x) => x.id === welderRow.id);
  equal([w.base.day, w.lines.map((l) => [l.stage, l.color, l.values.day]), w.effective.day], [5, [["نظارت", "#2e86c1", 4]], 4]);
  equal(after.lines.resources.find((x) => x.effective.resourceId === crane.id).confirmedBy, ["نظارت"]);
  equal([after.lines.problems[0].effective.removed, after.lines.narrative.length, after.content.narrative[1].addedAt], [true, 2, 2]);
  equal(after.summary.total, 8, "4 day + 2 night + 1 leave + 1 sick, the supervision's numbers");
  await throws(() => edit(after.content, U.planner), "حق ویرایش", "the contractor does not touch it at supervision");
});

test("a return: the returning stage and every stage before it may edit; then on to the record", async () => {
  await inP(() => rp.returnReport(db, { projectId: P, reportId: R.id, comment: "عدد جوشکار با کارکرد نمی‌خواند", userId: U.sup.id }));
  const v = await view(U.sup);
  assert(v.may.edit, "supervision returned it, and may still correct it");
  assert((await view(U.planner)).may.edit);
  await inP(async () => {
    await rp.signReport(db, { projectId: P, reportId: R.id, userId: U.site.id });
    await rp.approveStage(db, { projectId: P, reportId: R.id, userId: U.site.id });
    await rp.signReport(db, { projectId: P, reportId: R.id, userId: U.sup.id });
    await rp.approveStage(db, { projectId: P, reportId: R.id, userId: U.sup.id });
    await rp.signReport(db, { projectId: P, reportId: R.id, userId: U.client.id });
    const done = await rp.approveStage(db, { projectId: P, reportId: R.id, userId: U.client.id });
    equal(done.status, "approved");
  });
  const fin = await view(U.client);
  equal([fin.stages.every((s) => s.approved), fin.stages.some((s) => s.current), fin.record.versionNo], [true, false, fin.versionNo]);
});

test("photos with caption and tags, files; removed, never deleted; only readers of the report read them", async () => {
  const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
  const R2 = await inP(() => cr.createContractReport(db, { projectId: P, contractId: C.id, reportDate: yesterday, title: "دیروز", copyFromId: R.id, userId: U.planner.id }));
  const v2 = await inP(() => cr.contractReportView(db, { projectId: P, reportId: R2.id, userId: U.planner.id }));
  equal([v2.content.resources.find((r) => r.base.resourceId === welder.id).base.day, v2.content.problems.length, v2.content.narrative.length], [4, 0, 2],
    "copied as it stands: supervision's numbers, the added row; the removed problem not carried");
  const photo = await inP(() => cr.addReportFile(db, { projectId: P, reportId: R2.id, kind: "photo", name: "f101.png", caption: "بتن‌ریزی F-101",
    tags: "بتن، فونداسیون, F-101", bytes: PNG, store, userId: U.planner.id }));
  equal(photo.tags, ["بتن", "فونداسیون", "F-101"]);
  await throws(() => inP(() => cr.addReportFile(db, { projectId: P, reportId: R2.id, kind: "photo", name: "x", bytes: Buffer.from("text"), store, userId: U.planner.id })), "PNG");
  await inP(() => cr.addReportFile(db, { projectId: P, reportId: R2.id, kind: "file", name: "test.pdf", bytes: Buffer.from("%PDF-1.4 x"), contentType: "application/pdf", store, userId: U.planner.id }));
  await throws(() => inP(() => cr.addReportFile(db, { projectId: P, reportId: R.id, kind: "file", name: "late.pdf", bytes: Buffer.from("x"), store, userId: U.planner.id })), "قفل",
    "an approved report takes nothing more");
  await throws(() => inP(() => cr.readReportFile(db, { projectId: P, fileId: photo.id, userId: U.reader.id, store })), "دسترسی ندارید");
  await inP(() => cr.removeReportFile(db, { projectId: P, fileId: photo.id, userId: U.planner.id }));
  const v3 = await inP(() => cr.contractReportView(db, { projectId: P, reportId: R2.id, userId: U.planner.id }));
  equal(v3.files.map((f) => [f.kind, !!f.removed_at]), [["photo", true], ["file", false]]);
  await throws(() => inP(() => db.query("DELETE FROM report_file WHERE id = $1", [photo.id])), "permission");
});

test("resources over a period, filtered by type, branch and name", async () => {
  const all = await inP(() => cr.resourceSummaryRange(db, { projectId: P, contractId: C.id, from: yesterday, to: today }));
  equal([all.reports, all.summary.total, all.summary.byUnit["دستگاه"]], [2, 16, 2], "two days: 8 people a day, one crane a day");
  const people = await inP(() => cr.resourceSummaryRange(db, { projectId: P, contractId: C.id, from: today, to: today, kind: "person" }));
  equal([people.reports, people.summary.total, people.byResource.length], [1, 8, 1]);
  const byName = await inP(() => cr.resourceSummaryRange(db, { projectId: P, contractId: C.id, name: "جرثقیل" }));
  equal(byName.summary.byUnit, { "دستگاه": 2 });
  const lists = await inP(() => cr.listContractReports(db, { projectId: P, contractId: C.id, userId: U.planner.id }));
  equal(lists.map((r) => r.title), ["گزارش روزانهٔ سیویل", "دیروز"]);
});

await run();
