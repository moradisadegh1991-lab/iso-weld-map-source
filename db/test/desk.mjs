#!/usr/bin/env node
/**
 * The desk and notifications (owner's requirements of 2026-10-22, items
 * 13–15; lib/db/repos/desk.mjs, lib/db/repos/notifications.mjs, migration
 * 088): a member's active and archived requests, what waits on them, the
 * forms they may start; notifications sent to other members with files and
 * a day to reply by, read and answered once, private to sender and
 * recipients, and not changed once sent.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("desk-db-");
process.env.STORAGE_ROOT = await scratchDir("desk-store-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const rp = await import("../../lib/db/repos/reports.mjs");
const wfs = await import("../../lib/db/repos/workflows.mjs");
const desk = await import("../../lib/db/repos/desk.mjs");
const nt = await import("../../lib/db/repos/notifications.mjs");
const { createLocalStore } = await import("../../lib/storage/content-store.mjs");

const db = await getDb();
const U = {};
for (const k of ["pm", "maker", "boss", "other", "viewer", "out"]) U[k] = await projects.ensureUser(db, { subject: `kc|dk-${k}`, displayName: k });
const P = (await projects.createProject(db, { code: "DSK", name: "Desk", ownerUserId: U.pm.id })).id;
const P2 = (await projects.createProject(db, { code: "DS2", name: "Other", ownerUserId: U.pm.id })).id;
for (const k of ["maker", "boss", "other"]) await projects.addMember(db, { projectId: P, userId: U[k].id, role: "engineer" });
await projects.addMember(db, { projectId: P, userId: U.viewer.id, role: "viewer" });
const as = (fn) => withProject(db, P, fn);
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const store = createLocalStore({ root: process.env.STORAGE_ROOT });

let T, R1, R2, R3;
test("the desk: the requests a member takes part in, active and archived; what waits on them; the forms they may start", async () => {
  await as(async () => {
    const flow = await wfs.saveWorkflow(db, { projectId: P, code: "DF", name: "Desk flow" });
    const s1 = await rp.upsertStage(db, { projectId: P, workflowId: flow.id, seq: 1, name: "Site" });
    const s2 = await rp.upsertStage(db, { projectId: P, workflowId: flow.id, seq: 2, name: "Review" });
    const g1 = await rp.upsertGroup(db, { projectId: P, stageId: s1.id, seq: 1, name: "Makers" });
    const g2 = await rp.upsertGroup(db, { projectId: P, stageId: s2.id, seq: 1, name: "Reviewers" });
    await rp.setGroupMember(db, { projectId: P, groupId: g1.id, userId: U.maker.id, permissions: ["view", "create", "edit", "sign", "approve", "delete"] });
    await rp.setGroupMember(db, { projectId: P, groupId: g2.id, userId: U.boss.id, permissions: ["view", "sign", "approve", "return"] });
    T = await rp.upsertReportType(db, { projectId: P, code: "DK", name: "Desk form" });
    await wfs.attachWorkflow(db, { projectId: P, reportTypeId: T.id, workflowId: flow.id });
    R1 = await rp.createReport(db, { projectId: P, reportTypeId: T.id, reportDate: day(1), content: { a: 1 }, userId: U.maker.id });
    R2 = await rp.createReport(db, { projectId: P, reportTypeId: T.id, reportDate: day(2), content: { a: 2 }, userId: U.maker.id });
    await rp.signReport(db, { projectId: P, reportId: R2.id, userId: U.maker.id });
    await rp.approveStage(db, { projectId: P, reportId: R2.id, userId: U.maker.id });
    R3 = await rp.createReport(db, { projectId: P, reportTypeId: T.id, reportDate: day(3), content: { a: 3 }, userId: U.maker.id });
    await rp.cancelReport(db, { projectId: P, reportId: R3.id, comment: "duplicate", userId: U.maker.id });

    const m = await desk.deskOf(db, { projectId: P, userId: U.maker.id });
    equal(m.start.map((x) => x.code), [], "a form with no page of its own is not offered to start");
    equal(m.active.map((x) => [x.reportNo, x.stageName, x.waits]).sort(), [[R1.report_no, "Site", ["sign"]], [R2.report_no, "Review", []]].sort(),
      "the maker: R1 waits on their signature; R2 went on to review, nothing waits on them there");
    const b = await desk.deskOf(db, { projectId: P, userId: U.boss.id });
    equal(b.active[0].reportNo, R2.report_no, "what waits on a member comes first");
    equal(b.active.find((x) => x.id === R2.id).waits, ["sign", "return"], "the reviewer: sign, or return (approve after signing)");
    equal((await desk.deskOf(db, { projectId: P, userId: U.other.id })).active, [], "someone in none of its groups sees nothing");
    // sent to someone: on their desk too
    await rp.sendReport(db, { projectId: P, reportId: R1.id, userIds: [U.other.id], userId: U.maker.id });
    equal((await desk.deskOf(db, { projectId: P, userId: U.other.id })).active.map((x) => [x.id, x.waits]), [[R1.id, []]]);
    // approved: into the archive
    await rp.signReport(db, { projectId: P, reportId: R2.id, userId: U.boss.id });
    await rp.approveStage(db, { projectId: P, reportId: R2.id, userId: U.boss.id });
    const b2 = await desk.deskOf(db, { projectId: P, userId: U.boss.id });
    equal([b2.active.map((x) => [x.reportNo, x.waits]), b2.archive.map((x) => [x.reportNo, x.status])],
      [[[R1.report_no, []]], [[R2.report_no, "approved"], [R3.report_no, "cancelled"]]], "approved and cancelled: the archive; R1 still at the first stage, nothing on them");
    equal(desk.linkOf({ code: "CR" }, "x"), "/contract-reports?report=x");
    equal(desk.linkOf({ code: "HF", form: {} }, "x"), "/forms/HF?report=x");
  });
});

test("the desk sees a stage's deadline: a request past it is moved on before it is listed", async () => {
  await as(async () => {
    const [s1] = await rp.workflowOf(db, { projectId: P, reportTypeId: T.id });
    await rp.setStageDeadline(db, { projectId: P, stageId: s1.id, days: 1, text: "approved by the deadline" });
    await db.query("UPDATE report SET created_at = now() - interval '2 days' WHERE id = $1", [R1.id]);
    const m = await desk.deskOf(db, { projectId: P, userId: U.maker.id });
    equal(m.active.find((x) => x.id === R1.id).stageName, "Review");
    await rp.setStageDeadline(db, { projectId: P, stageId: s1.id, days: null });
  });
});

let N;
test("a notification: to other members, a title, a day to reply by not past; files kept; the project's log says only that one was sent", async () => {
  await as(async () => {
    const send = (x) => nt.sendNotification(db, { projectId: P, userId: U.pm.id, title: "Pipe delivery", store, ...x });
    await throws(() => send({ title: " ", recipients: [U.boss.id] }), "عنوان");
    await throws(() => send({ recipients: [U.pm.id] }), "غیر از خودتان", "not to oneself only");
    await throws(() => send({ recipients: [U.out.id] }), "عضو پروژه");
    await throws(() => send({ recipients: [U.boss.id], replyDue: day(1) }), "گذشته است");
    N = await send({ recipients: [U.boss.id, U.viewer.id], body: "Is the pipe on site?", replyDue: day(-2),
      files: [{ name: "list.txt", bytes: Buffer.from("PIPE 6in x 40"), contentType: "text/plain" }] });
    const pmView = await nt.notificationsOf(db, { projectId: P, userId: U.pm.id });
    equal(pmView.sent[0].recipients.map((r) => [r.name, r.state]).sort(), [["boss", "unread"], ["viewer", "unread"]]);
    const { rows: [log] } = await db.query("SELECT entity_label, comment FROM workflow_event WHERE entity_id = $1", [N.id]);
    assert(log.entity_label === "نوتیفیکیشن" && !log.comment.includes("Pipe"), `the log keeps the title out (${log.entity_label}: ${log.comment})`);
  });
});

test("read, replied once, late after the day; the files only to sender and recipients; another project sees none", async () => {
  await as(async () => {
    let inbox = await nt.notificationsOf(db, { projectId: P, userId: U.boss.id });
    equal([inbox.unread, inbox.awaitingReply, inbox.inbox[0].files.map((f) => f.name)], [1, 1, ["list.txt"]]);
    await nt.markRead(db, { projectId: P, id: N.id, userId: U.boss.id });
    await throws(() => nt.markRead(db, { projectId: P, id: N.id, userId: U.other.id }), "not found", "not sent to them");
    await throws(() => nt.reply(db, { projectId: P, id: N.id, userId: U.boss.id, text: " " }), "متن پاسخ");
    await nt.reply(db, { projectId: P, id: N.id, userId: U.boss.id, text: "Yes, 40 m" });
    await throws(() => nt.reply(db, { projectId: P, id: N.id, userId: U.boss.id, text: "again" }), "عوض نمی‌شود");
    inbox = await nt.notificationsOf(db, { projectId: P, userId: U.boss.id });
    equal([inbox.unread, inbox.awaitingReply, inbox.inbox[0].state, inbox.inbox[0].reply], [0, 0, "replied", "Yes, 40 m"]);
    // the viewer answers after the day: taken, and late
    const late = await nt.notificationsOf(db, { projectId: P, userId: U.viewer.id, today: day(-5) });
    equal(late.inbox[0].state, "overdue", "past the day without a reply: overdue");
    await nt.reply(db, { projectId: P, id: N.id, userId: U.viewer.id, text: "Checking" });
    const sent = await nt.notificationsOf(db, { projectId: P, userId: U.pm.id });
    equal(sent.sent[0].recipients.map((r) => r.state).sort(), ["replied", "replied"]);
    const fid = sent.sent[0].files[0].id;
    equal(String((await nt.readFile(db, { projectId: P, fileId: fid, userId: U.boss.id, store })).bytes), "PIPE 6in x 40");
    await throws(() => nt.readFile(db, { projectId: P, fileId: fid, userId: U.other.id, store }), "برای شما نیست");
    // what was sent is not changed
    await throws(() => db.query("UPDATE notification SET title = 'x' WHERE id = $1", [N.id]), "permission denied");
    await throws(() => db.query("DELETE FROM notification_recipient WHERE notification_id = $1", [N.id]), "permission denied");
  });
  await withProject(db, P2, async () => equal((await nt.notificationsOf(db, { projectId: P2, userId: U.boss.id })).inbox, []));
});

test("through the routes: the desk is one's own; a viewer replies; a notification's file to its people only", async () => {
  const deskRoute = await import("../../app/api/desk/route.js");
  const route = await import("../../app/api/notifications/route.js");
  const req = (as2, path, body) => new Request(`http://x${path}`, { method: body ? "POST" : "GET",
    headers: { authorization: `Bearer kc|dk-${as2}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const d = await (await deskRoute.GET(req("boss", `/api/desk?projectId=${P}`))).json();
  equal([d.archive.map((x) => x.status).sort(), d.notifications], [["approved", "cancelled"], { unread: 0, awaitingReply: 0 }], JSON.stringify(d).slice(0, 300));
  const n = await (await route.GET(req("viewer", `/api/notifications?projectId=${P}`))).json();
  assert(n.people.every((p) => p.id !== U.viewer.id) && n.inbox.length === 1, "the people to send to, without oneself");
  equal((await route.POST(req("viewer", "/api/notifications", { projectId: P, kind: "send", title: "Hi", recipients: [U.pm.id] }))).status, 200, "a viewer sends too");
  const fid = n.inbox[0].files[0].id;
  equal((await route.GET(req("other", `/api/notifications?projectId=${P}&file=${fid}`))).status, 403);
  equal((await route.GET(req("viewer", `/api/notifications?projectId=${P}&file=${fid}`))).status, 200);
});

await run();
