#!/usr/bin/env node
/**
 * Incoming transmittals from the designer: receipt with files, the reply due
 * date, inter-discipline review, comments that follow the document across
 * revisions, and the coded reply.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { replyDue, incomingState, replyProblems, closeProblems } from "../../lib/documents/review.mjs";

// ── the rules ────────────────────────────────────────────────────────────

test("the reply is due after the contract's review period — and unknown without one", async () => {
  equal(replyDue("2026-09-01", 14), "2026-09-15");
  equal(replyDue("2026-09-01", null), null);
  equal(replyDue("2026-09-01", 0), null);
  equal(replyDue("2026-09-01", "abc"), null);
});

test("an item is received, in review, ready or replied — and overdue past its due date", async () => {
  const T = "2026-09-20";
  equal(incomingState({ returnCode: 2, dueOn: "2026-09-01" }, T).code, "replied");
  equal(incomingState({ dueOn: "2026-09-25", reviews: [] }, T).code, "received");
  equal(incomingState({ dueOn: "2026-09-25", reviews: [{ status: "open" }, { status: "done" }] }, T).code, "in_review");
  equal(incomingState({ dueOn: "2026-09-25", reviews: [{ status: "done" }] }, T).code, "ready");
  equal(incomingState({ dueOn: "2026-09-19", reviews: [{ status: "done" }] }, T).code, "overdue");
  equal(incomingState({ dueOn: null, reviews: [] }, T).code, "received", "no due date: never overdue, never assumed");
});

test("a reply code that contradicts the record is refused", async () => {
  const done = [{ discipline: "Piping", status: "done" }];
  equal(replyProblems(5, {}).length, 1);
  equal(replyProblems(1, { reviews: [{ discipline: "Piping", status: "open" }] }).length, 1, "a review is still open");
  equal(replyProblems(1, { reviews: done, openComments: 1 }).length, 1, "approved while a comment is open");
  equal(replyProblems(1, { reviews: done, openComments: 0 }), []);
  equal(replyProblems(2, { reviews: done, openComments: 2, raisedHere: 0 }).length, 1, "code 2 with no comment on this revision");
  equal(replyProblems(2, { reviews: done, openComments: 2, raisedHere: 2 }), []);
  equal(replyProblems(3, { reviews: done, openComments: 0, raisedHere: 1 }).length, 1, "rejected with nothing open saying why");
  equal(replyProblems(3, { reviews: done, openComments: 1 }), []);
  equal(replyProblems(4, { reviews: [{ discipline: "x", status: "waived" }] }), [], "information needs neither");
  equal(closeProblems({ status: "open" }, { designerReply: " " }).length, 1);
  equal(closeProblems({ status: "closed" }, { designerReply: "x" }).length, 1);
});

// ── against the database ─────────────────────────────────────────────────

const dir = await mkdtemp(path.join(tmpdir(), "inc-db-"));
process.env.PGLITE_DIR = dir;
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const dc = await import("../../lib/db/repos/doc-control.mjs");
const inc = await import("../../lib/db/repos/incoming.mjs");
const { createLocalStore } = await import("../../lib/storage/content-store.mjs");

const db = await getDb();
const store = createLocalStore({ root: path.join(dir, "files") });
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob" });
const proj = await projects.createProject(db, { code: "INC", name: "I", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);
const pdf = (s) => ({ bytes: Buffer.from(`%PDF-1.4\n${s}\n%%EOF`), name: `${s}.pdf`, type: "application/pdf" });
let pid, tA, itemA, itemB;

await inP(async () => {
  pid = await dc.upsertMdr(db, { projectId: P, docNo: "OLF-PR-PID-0101", title: "P&ID CW pumps", discipline: "Process", approvalRequired: true });
});

test("a designer's transmittal is registered whole: revisions with their files; outside-MDR flagged; due unknown without a period", async () => {
  await inP(async () => {
    await throws(() => inc.registerIncoming(db, { projectId: P, transmittalNo: "DES-T-001", fromParty: "Designer", sentOn: "2026-09-02",
      receivedOn: "2026-09-01", purpose: "IFA", items: [{ docNo: "OLF-PR-PID-0101", revision: "A", purpose: "IFA" }], store }), "INVALID_INPUT");
    await throws(() => inc.registerIncoming(db, { projectId: P, transmittalNo: "DES-T-001", fromParty: "Designer", sentOn: "2026-09-01",
      receivedOn: "2026-09-02", purpose: "IFA", store, items: [
        { docNo: "OLF-PR-PID-0101", revision: "A", purpose: "IFA", file: pdf("pid-a") },
        { docNo: "OLF-ME-DS-0007", revision: "0", purpose: "IFA", file: pdf("ds-0") }] }), "INVALID_INPUT",
      "a document outside the MDR needs its title");
    equal((await db.query("SELECT count(*)::int AS n FROM transmittal")).rows[0].n, 0, "nothing half-registered");
    const r = await inc.registerIncoming(db, { projectId: P, transmittalNo: "des-t-001", fromParty: "Designer", sentOn: "2026-09-01",
      receivedOn: "2026-09-02", purpose: "IFA", store, userId: alice.id, items: [
        { docNo: "OLF-PR-PID-0101", revision: "A", purpose: "IFA", file: pdf("pid-a") },
        { docNo: "OLF-ME-DS-0007", title: "Pump datasheet", revision: "0", purpose: "IFA" }] });
    tA = r.transmittal;
    equal([r.dueOn, r.items[0].flags, r.items[1].flags], [null, [], ["خارج از MDR", "بدون فایل"]]);
    [itemA] = r.items.map((x) => x.itemId);
    const { rows: [rev] } = await db.query("SELECT file_sha256, file_uri, file_size FROM mdr_revision WHERE mdr_id = $1", [pid.id]);
    assert(/^[0-9a-f]{64}$/.test(rev.file_sha256) && rev.file_uri.startsWith("local://"));
    const f = await inc.revisionFile(db, { projectId: P, revisionId: (await db.query("SELECT id FROM mdr_revision WHERE mdr_id = $1", [pid.id])).rows[0].id, store });
    assert(f.bytes.toString().includes("pid-a"), "the stored file comes back byte for byte");
    const { rows: [ds] } = await db.query("SELECT outside_mdr, originator FROM mdr_document WHERE doc_no = 'OLF-ME-DS-0007'");
    equal([ds.outside_mdr, ds.originator], [true, "Designer"]);
    const out = await dc.transmittals(db, { projectId: P });
    equal(out.length, 0, "an incoming transmittal is not in the outgoing list");
  });
});

test("the review period, once stated, gives the due date; a comment needs an open review", async () => {
  await inP(async () => {
    await projects.updateProjectProfile(db, { projectId: P, patch: { doc_review_days: 14 } });
    await inc.assignReview(db, { projectId: P, itemId: itemA, disciplines: ["Process", "Piping", "Process"], userId: alice.id });
    const b = await inc.incomingBoard(db, { projectId: P, today: "2026-09-05" });
    const it = b.transmittals[0].items.find((i) => i.id === itemA);
    equal([it.reviews.length, it.state.code, it.dueOn], [2, "in_review", null], "the due date is fixed at receipt, when no period was stated");
    await inc.raiseComment(db, { projectId: P, itemId: itemA, discipline: "Process", ref: "Sheet 1, P-6101A/B", text: "Minimum flow line missing", userId: alice.id });
    await throws(() => inc.sendReply(db, { projectId: P, incomingId: tA.id, replyNo: "R-1", sentOn: "2026-09-06", codes: [{ itemId: itemA, code: 3 }], userId: alice.id }),
      "INVALID_INPUT", "Piping has not finished");
    const piping = it.reviews.find((r) => r.discipline === "Piping");
    await throws(() => inc.finishReview(db, { projectId: P, reviewId: piping.id, waive: true, reason: "" }), "INVALID_INPUT");
    await inc.finishReview(db, { projectId: P, reviewId: piping.id, userId: bob.id });
    await throws(() => inc.raiseComment(db, { projectId: P, itemId: itemA, discipline: "Piping", text: "late" }), "INVALID_INPUT", "Piping's review is closed");
    await inc.finishReview(db, { projectId: P, reviewId: it.reviews.find((r) => r.discipline === "Process").id, userId: alice.id });
  });
});

test("the reply code must agree with the comments; the reply is one number for the items it answers", async () => {
  await inP(async () => {
    await throws(() => inc.sendReply(db, { projectId: P, incomingId: tA.id, replyNo: "R-1", sentOn: "2026-09-06", codes: [{ itemId: itemA, code: 1 }], userId: alice.id }),
      "INVALID_INPUT", "approved while a comment is open");
    await throws(() => inc.sendReply(db, { projectId: P, incomingId: tA.id, replyNo: "R-1", sentOn: "2026-09-06", codes: [{ itemId: itemA, code: 3 }] }),
      "INVALID_INPUT", "a person gives the code");
    const r = await inc.sendReply(db, { projectId: P, incomingId: tA.id, replyNo: "prj-r-001", sentOn: "2026-09-06", codes: [{ itemId: itemA, code: 3 }], userId: bob.id });
    equal([r.reply_no, r.to_party], ["PRJ-R-001", "Designer"]);
    const it = (await inc.incomingBoard(db, { projectId: P })).transmittals[0].items.find((i) => i.id === itemA);
    equal([it.state.code, it.replyNo, it.returnCode], ["replied", "PRJ-R-001", 3]);
    await throws(() => inc.raiseComment(db, { projectId: P, itemId: itemA, discipline: "Civil", text: "x" }), "INVALID_INPUT", "no comment after the reply");
    await throws(() => db.query("DELETE FROM doc_reply"), "permission denied");
  });
});

test("Rev B: the same file is refused; the open comment follows the document until the designer's reply closes it", async () => {
  await inP(async () => {
    const reg = (file, no = "DES-T-002") => inc.registerIncoming(db, { projectId: P, transmittalNo: no, fromParty: "Designer", sentOn: "2026-09-10",
      receivedOn: "2026-09-11", purpose: "IFA", store, userId: alice.id, items: [{ docNo: "OLF-PR-PID-0101", revision: "B", purpose: "IFA", file }] });
    await throws(() => reg(pdf("pid-a")), "عیناً همان فایل");
    const r = await reg(pdf("pid-b"));
    itemB = r.items[0].itemId;
    equal(r.dueOn, "2026-09-25", "received on the 11th + 14 days");
    await inc.assignReview(db, { projectId: P, itemId: itemB, disciplines: ["Process"], userId: alice.id });
    const b = await inc.incomingBoard(db, { projectId: P, today: "2026-09-26" });
    const it = b.transmittals.flatMap((t) => t.items).find((i) => i.id === itemB);
    equal([it.state.code, it.comments.length, it.comments[0].status], ["overdue", 1, "open"], "the Rev A comment is on Rev B's page");
    await inc.finishReview(db, { projectId: P, reviewId: it.reviews[0].id, userId: bob.id });
    await throws(() => inc.sendReply(db, { projectId: P, incomingId: r.transmittal.id, replyNo: "PRJ-R-002", sentOn: "2026-09-26",
      codes: [{ itemId: itemB, code: 1 }], userId: bob.id }), "INVALID_INPUT", "Rev A's comment is still open");
    const c = it.comments[0];
    await throws(() => inc.closeComment(db, { projectId: P, commentId: c.id, designerReply: "" }), "INVALID_INPUT");
    await inc.closeComment(db, { projectId: P, commentId: c.id, designerReply: "Added 2\" min-flow line with RO, sheet 1", userId: bob.id });
    await inc.sendReply(db, { projectId: P, incomingId: r.transmittal.id, replyNo: "PRJ-R-002", sentOn: "2026-09-26", codes: [{ itemId: itemB, code: 1 }], userId: bob.id });
    const csv = await inc.crsCsv(db, { projectId: P, mdrId: pid.id });
    assert(csv.csv.includes('"A","Process","Sheet 1, P-6101A/B","Minimum flow line missing"') && csv.csv.includes('"CLOSED","B"'), csv.csv);
  });
});

test("receipt out of order is recorded and flagged, not refused: IFC before any approval", async () => {
  await inP(async () => {
    const d = await dc.upsertMdr(db, { projectId: P, docNo: "OLF-PI-GA-0200", title: "Piping GA", approvalRequired: true });
    const r = await inc.registerIncoming(db, { projectId: P, transmittalNo: "DES-T-003", fromParty: "Designer", sentOn: "2026-09-12",
      receivedOn: "2026-09-12", purpose: "IFC", store, items: [{ docNo: d.doc_no, revision: "0", purpose: "IFC", file: pdf("ga-0") }] });
    assert(r.items[0].flags.some((f) => /تأیید کارفرما/.test(f)), "the designer issued IFC before approval");
    await throws(() => inc.registerIncoming(db, { projectId: P, transmittalNo: "DES-T-004", fromParty: "Designer", sentOn: "2026-09-13",
      receivedOn: "2026-09-13", purpose: "IFC", store, items: [{ docNo: d.doc_no, revision: "0", purpose: "IFC", file: pdf("ga-0b") }] }),
      "پیش‌تر صادر شده", "the same revision twice is refused");
  });
});

test("incoming records belong to one project", async () => {
  const other = await projects.createProject(db, { code: "OTH", name: "O", ownerUserId: alice.id });
  await withProject(db, other.id, async () => {
    for (const t of ["doc_review", "doc_comment", "doc_reply"]) equal((await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0, t);
    equal((await inc.incomingBoard(db, { projectId: other.id })).transmittals.length, 0);
  });
});

await run();
