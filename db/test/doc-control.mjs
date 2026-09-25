#!/usr/bin/env node
/**
 * Document control: revisions in date order, no IFC before approval where
 * approval is required, one answer to "which revision on that day", and an
 * uploaded sheet checked against the construction revision of its day.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  issueProblems, currentOn, constructionOn, usedRevisionCheck, ifcLateness, transmittalItemState,
} from "../../lib/documents/control.mjs";

// ── the engine ───────────────────────────────────────────────────────────

const REVS = [
  { revision: "A", purpose: "IFR", issuedOn: "2026-03-01" },
  { revision: "B", purpose: "IFA", issuedOn: "2026-04-01", approvedCode: 2 },
  { revision: "0", purpose: "IFC", issuedOn: "2026-05-01" },
  { revision: "1", purpose: "IFR", issuedOn: "2026-06-01" },
  { revision: "2", purpose: "IFC", issuedOn: "2026-07-01" },
];

test("the revision in force and the revision to build to, on any date", async () => {
  equal(currentOn(REVS, "2026-02-01"), null);
  equal(currentOn(REVS, "2026-06-15").revision, "1");
  equal(currentOn(REVS, "2026-06-01").revision, "1", "in force from the day it is issued");
  equal(constructionOn(REVS, "2026-04-15"), null, "nothing issued for construction yet");
  equal(constructionOn(REVS, "2026-06-15").revision, "0", "rev 1 is out for review; build to rev 0");
  equal(constructionOn(REVS, "2026-07-01").revision, "2", "the day of issue counts");
  equal(constructionOn([...REVS, { revision: "3", purpose: "VOID", issuedOn: "2026-08-01" }], "2026-09-01"), null, "voided");
});

test("a sheet used on a date is checked against that date's construction revision", async () => {
  equal(usedRevisionCheck(REVS, "0", "2026-06-15"), { ok: true, expected: "0" });
  const old = usedRevisionCheck(REVS, "0", "2026-07-10");
  equal([old.ok, old.expected], [false, "2"]);
  const unk = usedRevisionCheck(REVS, "X", "2026-07-10");
  assert(/در رجیستر مدارک نیست/.test(unk.reason));
  equal(usedRevisionCheck(REVS, "A", "2026-03-15").ok, null, "no IFC yet: nothing can be said");
});

test("revisions are issued forward in time, never after VOID, never twice", async () => {
  equal(issueProblems(REVS, { revision: "3", purpose: "IFC", issuedOn: "2026-08-01" }), []);
  equal(issueProblems(REVS, { revision: "3", purpose: "IFC", issuedOn: "2026-06-30" }).length, 1, "back-dated");
  equal(issueProblems(REVS, { revision: "2", purpose: "AB", issuedOn: "2026-08-01" }).length, 1, "rev 2 exists");
  equal(issueProblems([...REVS, { revision: "3", purpose: "VOID", issuedOn: "2026-08-01" }],
    { revision: "4", purpose: "IFC", issuedOn: "2026-09-01" }).length, 1);
  equal(issueProblems([], { revision: "A", purpose: "XYZ", issuedOn: "2026-01-01" }).length, 1);
});

test("IFC waits for a code 1 or 2 where the client must approve", async () => {
  const noApproval = [{ revision: "A", purpose: "IFA", issuedOn: "2026-03-01", approvedCode: null }];
  equal(issueProblems(noApproval, { revision: "0", purpose: "IFC", issuedOn: "2026-04-01" }, { approvalRequired: true }).length, 1);
  equal(issueProblems(noApproval, { revision: "0", purpose: "IFC", issuedOn: "2026-04-01" }, { approvalRequired: false }), []);
  equal(issueProblems([{ ...noApproval[0], approvedCode: 1 }], { revision: "0", purpose: "IFC", issuedOn: "2026-04-01" },
    { approvalRequired: true }), []);
});

test("IFC lateness, and a transmittal item's state", async () => {
  equal(ifcLateness({ plannedIfcOn: "2026-04-20" }, REVS, "2026-09-01"), { daysLate: 11, issued: "2026-05-01" });
  equal(ifcLateness({ plannedIfcOn: "2026-08-20" }, REVS.slice(0, 2), "2026-09-01"), { daysLate: 12, issued: null });
  equal(ifcLateness({ plannedIfcOn: null }, REVS, "2026-09-01").daysLate, null);
  equal([transmittalItemState({ returnCode: 3 }, "x"), transmittalItemState({ returnCode: 1 }, "x"),
    transmittalItemState({ responseDue: "2026-09-01" }, "2026-09-02"), transmittalItemState({ responseDue: "2026-09-02" }, "2026-09-02")],
  ["rejected", "returned", "overdue", "awaiting"]);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "doc-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const dc = await import("../../lib/db/repos/doc-control.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "DOC", name: "D", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "DOC2", name: "O", ownerUserId: alice.id });
const P = proj.id;
const shift = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let iso1, pid, revA, revB;

test("IFC is refused until the client returns code 1 or 2, and then it is issued", async () => {
  await withProject(db, P, async () => {
    iso1 = await dc.upsertMdr(db, { projectId: P, docNo: "iso-60-001", title: "Isometric CW return", discipline: "piping",
      plannedIfcOn: shift(-40) });
    pid = await dc.upsertMdr(db, { projectId: P, docNo: "PID-60-001", title: "P&ID cooling water", discipline: "process",
      approvalRequired: true, plannedIfcOn: shift(-20) });
    revA = await dc.issueRevision(db, { projectId: P, mdrId: pid.id, revision: "A", purpose: "IFA", issuedOn: shift(-60), userId: alice.id });
    await throws(() => dc.issueRevision(db, { projectId: P, mdrId: pid.id, revision: "0", purpose: "IFC", issuedOn: shift(-30) }), "INVALID_INPUT");
    const t = await dc.createTransmittal(db, { projectId: P, transmittalNo: "tr-001", toParty: "Client", purpose: "approval",
      sentOn: shift(-59), responseDue: shift(-45), revisionIds: [revA.id] });
    equal(t.transmittal_no, "TR-001");
    const [item] = (await dc.transmittals(db, { projectId: P }))[0].items;
    equal(item.state, "overdue");
    await throws(() => dc.recordReturn(db, { projectId: P, itemId: item.id, code: 3, returnedOn: shift(-40) }), "INVALID_INPUT", "code 3 needs a comment");
    await throws(() => dc.recordReturn(db, { projectId: P, itemId: item.id, code: 2, returnedOn: shift(-70) }), "INVALID_INPUT", "before it was sent");
    // A rejected revision is not an approval, shown or counted.
    const revR = await dc.issueRevision(db, { projectId: P, mdrId: pid.id, revision: "B", purpose: "IFA", issuedOn: shift(-58) });
    const t2 = await dc.createTransmittal(db, { projectId: P, transmittalNo: "TR-001B", toParty: "Client", purpose: "approval",
      sentOn: shift(-58), revisionIds: [revR.id] });
    const [itemR] = (await dc.transmittals(db, { projectId: P })).find((x) => x.id === t2.id).items;
    await dc.recordReturn(db, { projectId: P, itemId: itemR.id, code: 3, returnedOn: shift(-50), comment: "Wrong line class" });
    let pidDoc = (await dc.registerBoard(db, { projectId: P })).documents.find((d) => d.doc_no === "PID-60-001");
    equal(pidDoc.revisions.find((r) => r.revision === "B").approvedCode, null);
    await throws(() => dc.issueRevision(db, { projectId: P, mdrId: pid.id, revision: "0", purpose: "IFC", issuedOn: shift(-45) }), "INVALID_INPUT",
      "a code 3 is not an approval");
    await dc.recordReturn(db, { projectId: P, itemId: item.id, code: 2, returnedOn: shift(-40), comment: "Add drain" });
    await throws(() => dc.recordReturn(db, { projectId: P, itemId: item.id, code: 1, returnedOn: shift(-39) }), "INVALID_INPUT", "once");
    revB = await dc.issueRevision(db, { projectId: P, mdrId: pid.id, revision: "0", purpose: "IFC", issuedOn: shift(-30), userId: alice.id });
    equal(revB.purpose, "IFC");
    await throws(() => db.query("UPDATE mdr_revision SET issued_on = issued_on - 1"), "permission denied");
    await throws(() => db.query("UPDATE transmittal_item SET revision_id = revision_id"), "permission denied");
  });
});

test("a transmittal cannot carry a revision issued after it was sent", async () => {
  await withProject(db, P, async () => {
    await throws(() => dc.createTransmittal(db, { projectId: P, transmittalNo: "TR-002", toParty: "C-02", purpose: "construction",
      sentOn: shift(-35), revisionIds: [revB.id] }), "INVALID_INPUT");
    await throws(() => dc.createTransmittal(db, { projectId: P, transmittalNo: "TR-002", toParty: "C-02", purpose: "construction",
      sentOn: shift(-29), revisionIds: [] }), "INVALID_INPUT");
  });
});

test("the register answers for a past date, and flags a sheet extracted from a superseded revision", async () => {
  await withProject(db, P, async () => {
    await dc.issueRevision(db, { projectId: P, mdrId: iso1.id, revision: "0", purpose: "IFC", issuedOn: shift(-30) });
    await dc.issueRevision(db, { projectId: P, mdrId: iso1.id, revision: "1", purpose: "IFC", issuedOn: shift(-5) });
    // Two uploaded sheets: rev 0 today (superseded since 5 days) and rev 1 today.
    // The upload's number as the title block printed it — case differs from the register.
    for (const [rev, sha] of [["0", "a"], ["1", "b"]]) {
      await db.query(`INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'iso-60-001',$2,$3,'local://x')`,
        [P, rev, sha.repeat(64)]);
    }
    await db.query(`INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri) VALUES ($1,'ISO-99-999','0',$2,'local://y')`,
      [P, "c".repeat(64)]);
    let b = await dc.registerBoard(db, { projectId: P });
    const iso = b.documents.find((d) => d.doc_no === "ISO-60-001");
    equal([iso.current.revision, iso.construction.revision, iso.lateness.daysLate], ["1", "1", 10]);
    equal(b.sheets.map((s) => [s.revision, s.ok, s.expected]), [["0", false, "1"], ["1", true, "1"]]);
    equal(b.unregistered, ["ISO-99-999"], "an uploaded drawing the register does not know");
    b = await dc.registerBoard(db, { projectId: P, onDate: shift(-10) });
    equal(b.documents.find((d) => d.doc_no === "ISO-60-001").construction.revision, "0", "ten days ago rev 0 was the one");
  });
});

test("document control belongs to one project", async () => {
  await withProject(db, other.id, async () => {
    const b = await dc.registerBoard(db, { projectId: other.id });
    equal([b.documents.length, b.transmittals.length], [0, 0]);
  });
});

await run();
