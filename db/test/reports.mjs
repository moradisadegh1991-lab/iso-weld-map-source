#!/usr/bin/env node
/**
 * Reports with a staged review (lib/reports/workflow.mjs, lib/db/repos/reports.mjs):
 * a daily report through contractor → supervision → client; signatures that
 * attest to one version and lapse when it changes; approval that needs the
 * approver's own signature; a return that reopens the stage before; a
 * cancellation only before any approval; history that is only added to.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.PGLITE_DIR = await scratchDir("reports-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const rp = await import("../../lib/db/repos/reports.mjs");
const wf = await import("../../lib/reports/workflow.mjs");

const db = await getDb();
const planner = await projects.ensureUser(db, { subject: "kc|planner" });   // contractor planning: creates, edits, signs
const siteMgr = await projects.ensureUser(db, { subject: "kc|sitemgr" });   // contractor site manager: edits after signing, approves, cancels
const sup = await projects.ensureUser(db, { subject: "kc|sup" });           // supervision: signs, approves, returns
const client = await projects.ensureUser(db, { subject: "kc|client" });     // client: signs, approves, returns
const reader = await projects.ensureUser(db, { subject: "kc|reader" });     // a project member outside the workflow
const outsider = await projects.ensureUser(db, { subject: "kc|out" });      // not in the project
const proj = await projects.createProject(db, { code: "RPT", name: "R", ownerUserId: planner.id });
const P = proj.id;
for (const u of [siteMgr, sup, client, reader]) await projects.addMember(db, { projectId: P, userId: u.id, role: "viewer" });
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let type, G = {};
await withProject(db, P, async () => {
  type = await rp.upsertReportType(db, { projectId: P, code: "DR", name: "گزارش روزانه" });
  const st1 = await rp.upsertStage(db, { projectId: P, reportTypeId: type.id, seq: 1, name: "پیمانکار" });
  const st2 = await rp.upsertStage(db, { projectId: P, reportTypeId: type.id, seq: 2, name: "نظارت" });
  const st3 = await rp.upsertStage(db, { projectId: P, reportTypeId: type.id, seq: 3, name: "کارفرما" });
  G.plan = await rp.upsertGroup(db, { projectId: P, stageId: st1.id, seq: 1, name: "برنامه‌ریزی" });
  G.site = await rp.upsertGroup(db, { projectId: P, stageId: st1.id, seq: 2, name: "مدیریت کارگاه" });
  G.sup = await rp.upsertGroup(db, { projectId: P, stageId: st2.id, seq: 1, name: "نظارت مقیم", title: "دستگاه نظارت" });
  G.cl = await rp.upsertGroup(db, { projectId: P, stageId: st3.id, seq: 1, name: "کارفرما" });
  await rp.setGroupMember(db, { projectId: P, groupId: G.plan.id, userId: planner.id, permissions: ["view", "create", "edit", "sign"] });
  await rp.setGroupMember(db, { projectId: P, groupId: G.site.id, userId: siteMgr.id,
    permissions: ["view", "edit", "edit_after_sign", "sign", "approve", "delete"] });
  await rp.setGroupMember(db, { projectId: P, groupId: G.sup.id, userId: sup.id, permissions: ["view", "sign", "approve", "return"] });
  await rp.setGroupMember(db, { projectId: P, groupId: G.cl.id, userId: client.id, permissions: ["view", "sign", "approve", "return"] });
});
const as = (fn) => withProject(db, P, fn);
const content = (n) => ({ weather: "صاف", manpower: [{ role: "جوشکار", present: n }], work: "فیت‌آپ خط 2\"-P-101" });

test("the workflow is set up from the owner's stages and groups; a member's rights are checked", async () => {
  await as(async () => {
    const w = await rp.workflowOf(db, { projectId: P, reportTypeId: type.id });
    equal(w.map((s) => [s.seq, s.name, s.groups.map((g) => g.name)]),
      [[1, "پیمانکار", ["برنامه‌ریزی", "مدیریت کارگاه"]], [2, "نظارت", ["نظارت مقیم"]], [3, "کارفرما", ["کارفرما"]]]);
    await throws(() => rp.setGroupMember(db, { projectId: P, groupId: G.plan.id, userId: reader.id, permissions: ["fly"] }), "ناشناخته");
    await throws(() => rp.setGroupMember(db, { projectId: P, groupId: G.plan.id, userId: outsider.id, permissions: ["view"] }), "عضو پروژه نیست");
  });
});

let r1;
test("a report is created only by a first-stage member with the right, numbered per type, as version 1", async () => {
  await as(async () => {
    await throws(() => rp.createReport(db, { projectId: P, reportTypeId: type.id, reportDate: today, content: content(4), userId: sup.id }), "حق ایجاد");
    await throws(() => rp.createReport(db, { projectId: P, reportTypeId: type.id, reportDate: "2999-01-01", content: content(4), userId: planner.id }), "هنوز نرسیده");
    r1 = await rp.createReport(db, { projectId: P, reportTypeId: type.id, reportDate: daysAgo(1), title: "روز ۱", content: content(4), userId: planner.id });
    equal([r1.report_no, r1.stage_seq, r1.status], ["DR-R0001", 1, "open"]);
    const v = await rp.reportView(db, { projectId: P, reportId: r1.id, userId: planner.id });
    equal([v.versionNo, v.content.manpower[0].present, v.may.edit, v.may.approve], [1, 4, true, false]);
  });
});

test("a signature attests to one version: once signed, the stage only shows it; withdrawn, it is edited again and the signature lapses", async () => {
  await as(async () => {
    await rp.editReport(db, { projectId: P, reportId: r1.id, content: content(5), userId: planner.id });           // v2, nobody signed yet
    await throws(() => rp.editReport(db, { projectId: P, reportId: r1.id, content: content(5), userId: planner.id }), "تغییری نکرده");
    await rp.signReport(db, { projectId: P, reportId: r1.id, userId: planner.id });
    await throws(() => rp.signReport(db, { projectId: P, reportId: r1.id, userId: planner.id }), "امضا کرده‌اید");
    await throws(() => rp.editReport(db, { projectId: P, reportId: r1.id, content: content(6), userId: planner.id }), "امضای خود را لغو کنید",
      "the signer does not edit what they signed: they withdraw first (owner's spec 2026-10-15)");
    await throws(() => rp.editReport(db, { projectId: P, reportId: r1.id, content: content(6), userId: siteMgr.id }), "فقط قابل نمایش",
      "signed content is read-only for everyone at the stage, even a member holding the retired edit_after_sign (owner's review, item 4)");
    const shown = await rp.reportView(db, { projectId: P, reportId: r1.id, userId: siteMgr.id });
    equal(shown.may.edit, false, "and the page shows it without edit controls");
    await rp.withdrawSignature(db, { projectId: P, reportId: r1.id, userId: planner.id });
    const e = await rp.editReport(db, { projectId: P, reportId: r1.id, content: content(6), userId: siteMgr.id });  // v3
    equal(e.versionNo, 3);
    const v = await rp.reportView(db, { projectId: P, reportId: r1.id, userId: planner.id });
    assert(v.may.signFor.includes(G.plan.id), "the planner may sign the new content");
  });
});

test("final approval needs the approver's own signature on the current content; it locks the stage and moves on", async () => {
  await as(async () => {
    await throws(() => rp.approveStage(db, { projectId: P, reportId: r1.id, userId: planner.id }), "حق تأیید نهایی");
    await throws(() => rp.approveStage(db, { projectId: P, reportId: r1.id, userId: siteMgr.id }), "بدون امضای خود");
    await rp.signReport(db, { projectId: P, reportId: r1.id, userId: siteMgr.id });
    const r = await rp.approveStage(db, { projectId: P, reportId: r1.id, userId: siteMgr.id });
    equal(r.stage_seq, 2);
    await throws(() => rp.editReport(db, { projectId: P, reportId: r1.id, content: content(7), userId: siteMgr.id }), "حق ویرایش",
      "past its stage, the contractor cannot touch it");
    await throws(() => rp.withdrawSignature(db, { projectId: P, reportId: r1.id, userId: siteMgr.id }), "پس گرفته نمی‌شود",
      "a signature the stage approved stands");
  });
});

test("a signature can be withdrawn while the report is at its stage, and given again", async () => {
  await as(async () => {
    await rp.signReport(db, { projectId: P, reportId: r1.id, userId: sup.id });
    await rp.withdrawSignature(db, { projectId: P, reportId: r1.id, userId: sup.id });
    await throws(() => rp.approveStage(db, { projectId: P, reportId: r1.id, userId: sup.id }), "بدون امضای خود", "withdrawn means it no longer counts");
    await rp.signReport(db, { projectId: P, reportId: r1.id, userId: sup.id });
    const v = await rp.reportView(db, { projectId: P, reportId: r1.id, userId: sup.id });
    equal(v.signatureBoxes[1].groups[0].signatures.length, 1);
  });
});

test("a return says why, goes back one stage, and that stage reviews again with plain edit rights", async () => {
  await as(async () => {
    await throws(() => rp.returnReport(db, { projectId: P, reportId: r1.id, comment: " ", userId: sup.id }), "دلیل برگشت");
    const r = await rp.returnReport(db, { projectId: P, reportId: r1.id, comment: "تعداد جوشکار با کارکرد نمی‌خواند", userId: sup.id });
    equal(r.stage_seq, 1);
    const v = await rp.reportView(db, { projectId: P, reportId: r1.id, userId: planner.id });
    equal(v.signatureBoxes[0].groups.flatMap((g) => g.signatures).length, 0, "the stage's earlier signatures were for the review before the return");
    await rp.editReport(db, { projectId: P, reportId: r1.id, content: content(4), userId: planner.id });          // v4, plain edit again
    await throws(() => rp.returnReport(db, { projectId: P, reportId: r1.id, comment: "x", userId: siteMgr.id }), "حق برگشت");
  });
});

test("the last stage's approval makes its version the record: hash kept, report locked, every version still there", async () => {
  await as(async () => {
    await rp.signReport(db, { projectId: P, reportId: r1.id, userId: siteMgr.id });
    await rp.approveStage(db, { projectId: P, reportId: r1.id, userId: siteMgr.id });
    await rp.signReport(db, { projectId: P, reportId: r1.id, userId: sup.id });
    await rp.approveStage(db, { projectId: P, reportId: r1.id, userId: sup.id });
    await rp.signReport(db, { projectId: P, reportId: r1.id, userId: client.id });
    const r = await rp.approveStage(db, { projectId: P, reportId: r1.id, comment: "تأیید", userId: client.id });
    equal([r.status, r.approved_version], ["approved", 4]);
    const v = await rp.reportView(db, { projectId: P, reportId: r1.id, userId: client.id });
    equal(v.record.hash, v.contentHash);
    equal(v.versions.map((x) => x.version_no), [1, 2, 3, 4]);
    equal(v.decisions.map((d) => [d.stageSeq, d.action]),
      [[1, "approved"], [2, "returned"], [1, "approved"], [2, "approved"], [3, "approved"]]);
    await throws(() => rp.editReport(db, { projectId: P, reportId: r1.id, content: content(9), userId: client.id }), "قفل");
    await throws(() => rp.returnReport(db, { projectId: P, reportId: r1.id, comment: "دیر", userId: client.id }), "قفل");
    const old = await rp.reportVersion(db, { projectId: P, reportId: r1.id, versionNo: 2, userId: client.id });
    equal(old.content.manpower[0].present, 5, "an earlier version is read as it was");
  });
});

test("a report is cancelled, with a reason, only at the first stage and only if no stage ever approved it", async () => {
  await as(async () => {
    const r2 = await rp.createReport(db, { projectId: P, reportTypeId: type.id, reportDate: today, content: content(3), userId: planner.id });
    equal(r2.report_no, "DR-R0002");
    await throws(() => rp.cancelReport(db, { projectId: P, reportId: r2.id, comment: "تکراری", userId: planner.id }), "حق حذف");
    await throws(() => rp.cancelReport(db, { projectId: P, reportId: r2.id, comment: "", userId: siteMgr.id }), "دلیل حذف");
    const c = await rp.cancelReport(db, { projectId: P, reportId: r2.id, comment: "تکراری", userId: siteMgr.id });
    equal(c.status, "cancelled");
    await throws(() => rp.signReport(db, { projectId: P, reportId: r2.id, userId: planner.id }), "لغو");

    const r3 = await rp.createReport(db, { projectId: P, reportTypeId: type.id, reportDate: today, content: content(2), userId: planner.id });
    await rp.signReport(db, { projectId: P, reportId: r3.id, userId: siteMgr.id });
    await rp.approveStage(db, { projectId: P, reportId: r3.id, userId: siteMgr.id });
    await rp.returnReport(db, { projectId: P, reportId: r3.id, comment: "اصلاح", userId: sup.id });
    await throws(() => rp.cancelReport(db, { projectId: P, reportId: r3.id, comment: "حذف", userId: siteMgr.id }), "تأیید کرده",
      "back at the first stage, but supervision has seen it approved: it is corrected, not removed");
  });
});

test("only the workflow's members and the people it was sent to may read a report", async () => {
  await as(async () => {
    await throws(() => rp.reportView(db, { projectId: P, reportId: r1.id, userId: reader.id }), "دسترسی ندارید");
    equal((await rp.listReports(db, { projectId: P, reportTypeId: type.id, userId: reader.id })).length, 0);
    await throws(() => rp.sendReport(db, { projectId: P, reportId: r1.id, userIds: [outsider.id], userId: planner.id }), "عضو پروژه");
    equal(await rp.sendReport(db, { projectId: P, reportId: r1.id, userIds: [reader.id, client.id], note: "برای اطلاع", userId: planner.id }), 2);
    const v = await rp.reportView(db, { projectId: P, reportId: r1.id, userId: reader.id });
    equal([v.report.report_no, v.may.edit, v.may.signFor.length], ["DR-R0001", false, 0]);
    equal((await rp.listReports(db, { projectId: P, reportTypeId: type.id, userId: reader.id })).map((r) => r.report_no), ["DR-R0001"]);
  });
});

test("history is only added to: a version, a signature and a decision cannot be changed or removed", async () => {
  for (const sql of ["UPDATE report_version SET content = '{}'::jsonb", "DELETE FROM report_signature",
    "UPDATE report_decision SET comment = 'x'"]) {
    await throws(() => as(() => db.query(sql)), "permission denied", sql);
  }
  await as(async () => {
    const log = await import("../../lib/db/repos/log.mjs");
    const rows = await log.sectionLog(db, { projectId: P, section: "reports" });
    assert(rows.some((e) => e.action === "withdrawn") && rows.some((e) => e.action === "returned"), "every step is in the section log");
  });
});

test("the engine alone: arrival, lapsed signatures, and one hash for one content whatever the key order", async () => {
  const stages = [{ seq: 1, name: "a", groups: [{ id: "g1", seq: 1, name: "x", members: [{ userId: "u", permissions: ["sign", "approve", "edit"] }] }] }];
  const base = { status: "open", stageSeq: 1, versionNo: 2, createdT: 10n, stages, decisions: [] };
  const sig = (t, action, versionNo) => ({ stageSeq: 1, groupId: "g1", userId: "u", action, versionNo, t });
  equal(wf.signaturesAt({ ...base, signatures: [sig(11n, "sign", 2)] }, 1).map((s) => s.current), [true]);
  equal(wf.signaturesAt({ ...base, signatures: [sig(11n, "sign", 1)] }, 1).map((s) => s.current), [false]);
  equal(wf.signaturesAt({ ...base, signatures: [sig(11n, "sign", 2), sig(12n, "withdraw", 2)] }, 1).length, 0);
  equal(wf.signaturesAt({ ...base, decisions: [{ stageSeq: 2, action: "returned", t: 20n }], signatures: [sig(11n, "sign", 2)] }, 1).length, 0,
    "a signature from before a return does not count");
  equal(wf.checkApprove({ ...base, signatures: [sig(11n, "sign", 2)] }, "u").final, true);
  const returner = [{ ...stages[0], groups: [{ ...stages[0].groups[0], members: [{ userId: "u", permissions: ["return"] }] }] }];
  assert(/مرحلهٔ اول/.test(wf.checkReturn({ ...base, stages: returner, signatures: [] }, "u", "دلیل").reason),
    "the first stage has no stage before it to return to");
  equal(wf.canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), wf.canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

// ── phase 2: the signature image, and changing a workflow ────────────────

const sg = await import("../../lib/db/repos/signatures.mjs");
const { createLocalStore } = await import("../../lib/storage/content-store.mjs");
const store = createLocalStore({ root: await scratchDir("reports-store-") });
const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, n)]);

test("a signature image is an image: PNG/JPEG/WebP by its bytes, under 1 MB; the same image again is not a new one", async () => {
  await as(async () => {
    await throws(() => sg.saveSignature(db, { userId: sup.id, bytes: Buffer.from("<html><script>x</script>"), kind: "scanned", store }), "PNG، JPEG");
    await throws(() => sg.saveSignature(db, { userId: sup.id, bytes: PNG(1), kind: "stamp", store }), "نوع امضا");
    await throws(() => sg.saveSignature(db, { userId: sup.id, bytes: Buffer.concat([PNG(1), Buffer.alloc(1024 * 1024)]), kind: "drawn", store }), "مگابایت");
    const a = await sg.saveSignature(db, { userId: sup.id, bytes: PNG(1), kind: "drawn", store });
    const again = await sg.saveSignature(db, { userId: sup.id, bytes: PNG(1), kind: "drawn", store });
    equal([again.id, again.duplicate], [a.id, true]);
    equal((await sg.currentSignature(db, { userId: sup.id })).content_type, "image/png");
  });
});

test("a report signature keeps the image it was given with, after the signer changes theirs", async () => {
  await as(async () => {
    const first = await sg.saveSignature(db, { userId: planner.id, bytes: PNG(2), kind: "drawn", store });
    const r = await rp.createReport(db, { projectId: P, reportTypeId: type.id, reportDate: today, content: content(8), userId: planner.id });
    await rp.signReport(db, { projectId: P, reportId: r.id, userId: planner.id });
    const second = await sg.saveSignature(db, { userId: planner.id, bytes: PNG(3), kind: "scanned", store });
    assert(second.id !== first.id, "a new image is a new row");
    const v = await rp.reportView(db, { projectId: P, reportId: r.id, userId: planner.id });
    equal(v.signatureBoxes[0].groups[0].signatures[0].signatureId, first.id);
    equal((await sg.signatureHistory(db, { userId: planner.id })).length, 2, "the earlier image is kept, not replaced");
  });
});

test("a signature image is shown only within a project its owner is a member of", async () => {
  const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: outsider.id });
  const img = await withProject(db, other.id, () => sg.saveSignature(db, { userId: outsider.id, bytes: PNG(4), kind: "drawn", store }));
  await throws(() => as(() => sg.readSignature(db, { projectId: P, signatureId: img.id, store })), "not found");
  const mine = await as(() => sg.currentSignature(db, { userId: planner.id }));
  const got = await as(() => sg.readSignature(db, { projectId: P, signatureId: mine.id, store }));
  equal([got.contentType, got.bytes.length], ["image/png", PNG(3).length]);
  await throws(() => as(() => db.query("UPDATE user_signature SET kind = 'drawn'")), "permission denied");
});

test("a workflow in use keeps its shape: no stage removed once a report used the type, no group removed once someone signed for it", async () => {
  await as(async () => {
    const w = await rp.workflowOf(db, { projectId: P, reportTypeId: type.id });
    await throws(() => rp.removeStage(db, { projectId: P, stageId: w[2].id }), "حذف نمی‌شود");
    await throws(() => rp.removeGroup(db, { projectId: P, groupId: G.plan.id }), "امضا ثبت شده");
    const t2 = await rp.upsertReportType(db, { projectId: P, code: "WR", name: "گزارش هفتگی" });
    const s1 = await rp.upsertStage(db, { projectId: P, reportTypeId: t2.id, seq: 1, name: "پیمانکار" });
    const g = await rp.upsertGroup(db, { projectId: P, stageId: s1.id, seq: 1, name: "برنامه‌ریزی" });
    await rp.setGroupMember(db, { projectId: P, groupId: g.id, userId: planner.id, permissions: ["view", "create"] });
    await rp.removeGroup(db, { projectId: P, groupId: g.id });
    await rp.removeStage(db, { projectId: P, stageId: s1.id });
    const all = await rp.reportTypes(db, { projectId: P });
    equal(all.map((t) => [t.code, t.stages.length, t.reports]), [["DR", 3, 4], ["WR", 0, 0]]);
  });
});

test("the daily-report template builds the agreed stages once, and leaves a workflow already set up alone", async () => {
  const fresh = await projects.createProject(db, { code: "TPL", name: "T", ownerUserId: planner.id });
  await withProject(db, fresh.id, async () => {
    equal((await rp.applyDailyTemplate(db, { projectId: fresh.id })).created, true);
    equal((await rp.applyDailyTemplate(db, { projectId: fresh.id })).created, false);
    const [t] = await rp.reportTypes(db, { projectId: fresh.id });
    equal(t.stages.map((s) => [s.name, s.groups.map((g) => g.name)]),
      [["پیمانکار", ["برنامه‌ریزی", "مدیریت کارگاه"]], ["نظارت", ["نظارت مقیم"]], ["کارفرما", ["نمایندهٔ کارفرما"]]]);
  });
  await as(async () => equal((await rp.applyDailyTemplate(db, { projectId: P })).created, false, "this project's own DR workflow is kept"));
});

// ── owner's spec 2026-10-15: one final approver per stage, a deputy, finer content rights ──

test("a stage's named final approver: only they or the deputy approve, after signing; the deputy acts «on behalf of»", async () => {
  const fresh = await projects.createProject(db, { code: "APV", name: "A", ownerUserId: planner.id });
  for (const u of [siteMgr, sup, client]) await projects.addMember(db, { projectId: fresh.id, userId: u.id, role: "engineer" });
  await withProject(db, fresh.id, async () => {
    const F = fresh.id;
    const t = await rp.upsertReportType(db, { projectId: F, code: "AP", name: "x" });
    const s1 = await rp.upsertStage(db, { projectId: F, reportTypeId: t.id, seq: 1, name: "پیمانکار" });
    const g = await rp.upsertGroup(db, { projectId: F, stageId: s1.id, seq: 1, name: "مدیریت" });
    await rp.setGroupMember(db, { projectId: F, groupId: g.id, userId: planner.id, permissions: ["view", "create", "add_content", "sign"] });
    await rp.setGroupMember(db, { projectId: F, groupId: g.id, userId: siteMgr.id, permissions: ["view", "sign"] });
    await rp.setGroupMember(db, { projectId: F, groupId: g.id, userId: sup.id, permissions: ["view", "sign", "approve"] });
    await rp.setGroupMember(db, { projectId: F, groupId: g.id, userId: client.id, permissions: ["view"] });
    await throws(() => rp.setStageApprover(db, { projectId: F, stageId: s1.id, approverId: client.id }), "حق امضا", "the approver must be able to sign");
    await throws(() => rp.setStageApprover(db, { projectId: F, stageId: s1.id, deputyId: siteMgr.id }), "بدون تأییدکننده");
    await rp.setStageApprover(db, { projectId: F, stageId: s1.id, approverId: planner.id, deputyId: siteMgr.id });
    const r = await rp.createReport(db, { projectId: F, reportTypeId: t.id, reportDate: today, content: content(1), userId: planner.id });
    await rp.signReport(db, { projectId: F, reportId: r.id, userId: sup.id });
    await throws(() => rp.approveStage(db, { projectId: F, reportId: r.id, userId: sup.id }), "فقط با تأییدکنندهٔ نهایی",
      "a group's approve right no longer suffices once the stage names its approver");
    await throws(() => rp.approveStage(db, { projectId: F, reportId: r.id, userId: siteMgr.id }), "بدون امضای خود");
    await rp.signReport(db, { projectId: F, reportId: r.id, userId: siteMgr.id });
    const done = await rp.approveStage(db, { projectId: F, reportId: r.id, userId: siteMgr.id });
    equal(done.status, "approved");
    const { rows: [d] } = await db.query("SELECT on_behalf_of FROM report_decision WHERE report_id = $1 AND action = 'approved'", [r.id]);
    equal(d.on_behalf_of, planner.id, "the deputy's approval is recorded for the approver");
    const v = await rp.reportView(db, { projectId: F, reportId: r.id, userId: planner.id });
    const sigs = v.signatureBoxes[0].groups[0].signatures;
    equal([sigs.find((x) => x.userId === siteMgr.id).onBehalfOf != null, sigs.find((x) => x.userId === sup.id).onBehalfOf], [true, null]);
  });
});

test("content rights: adding rows, changing rows and removing rows are separate; after a return earlier stages edit again", async () => {
  const stages = [
    { seq: 1, groups: [{ id: "g1", seq: 1, members: [{ userId: "adder", permissions: ["view", "add_content"] }, { userId: "editor", permissions: ["view", "edit"] }] }] },
    { seq: 2, groups: [{ id: "g2", seq: 1, members: [{ userId: "rev", permissions: ["view", "edit", "sign", "return"] }] }] },
  ];
  const snap = { status: "open", stageSeq: 1, versionNo: 1, createdT: 1n, stages, signatures: [], decisions: [] };
  equal([wf.checkEdit(snap, "adder", { added: 1 }).ok, wf.checkEdit(snap, "adder", { changed: 1 }).ok, wf.checkEdit(snap, "editor", { removed: 1 }).ok,
    wf.checkEdit(snap, "editor", { changed: 1 }).ok], [true, false, false, true]);
  const back = { ...snap, stageSeq: 1, decisions: [{ stageSeq: 1, action: "approved", versionNo: 1, t: 2n }, { stageSeq: 2, action: "returned", versionNo: 1, t: 3n }] };
  equal(wf.checkEdit(back, "rev", { changed: 1 }).ok, true, "returned to stage 1: the reviewer of stage 2 may correct it too");
  const forward = { ...snap, stageSeq: 1, decisions: [] };
  equal(wf.checkEdit(forward, "rev", { changed: 1 }).ok, false, "without a return, stage 2 does not touch stage 1's report");
});

await run();
