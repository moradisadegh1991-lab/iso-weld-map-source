#!/usr/bin/env node
/**
 * Reading received documents into the registers (lib/intake/*,
 * lib/db/repos/intake.mjs): only approved revisions are read; numbers are
 * recognised by the project's own shapes; a scan is reported as needing
 * OCR, not read as empty; the proposal says new / fill / conflict / same;
 * a conflict is applied only with a reason; and what is applied is
 * recorded against the revision that showed it.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

const dir = await scratchDir("intake-db-");
process.env.PGLITE_DIR = dir;
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const dc = await import("../../lib/db/repos/doc-control.mjs");
const inc = await import("../../lib/db/repos/incoming.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const intake = await import("../../lib/db/repos/intake.mjs");
const { importInstrumentIndex } = await import("../../lib/db/repos/instrumentation.mjs");
const { createLocalStore } = await import("../../lib/storage/content-store.mjs");
const { shapeOf, shapeRegex, learnShapes, recognize } = await import("../../lib/intake/patterns.mjs");

// ── shapes ───────────────────────────────────────────────────────────────

test("a shape keeps separators, turns digits to 9 and letters to A; a register teaches only shapes it repeats", async () => {
  equal([shapeOf("30-E-1101A"), shapeOf('8"-MP-140001-A1A-H'), shapeOf("TIC-140001")], ["99-A-9999A", '9"-AA-999999-A9A-A', "AAA-999999"]);
  assert(shapeRegex("99-A-9999A").test("30-P-1102B") && !shapeRegex("99-A-9999A").test("30-P-1102"));
  equal(learnShapes(["30-E-1101A", "30-P-1102B", "P-7001"]).map((s) => s.shape), ["99-A-9999A"], "one P-7001 is not a pattern");
  const r = recognize("30-E-1101A and 30-10 / 30-10", [{ kind: "equipment", shape: "99-A-9999A" }, { kind: "subsystem", shape: "99-99" }, { kind: "line", shape: "99-99" }]);
  equal([[...r.found.get("equipment").keys()], r.ambiguous.get("30-10")], [["30-E-1101A"], ["subsystem", "line"]],
    "a shape two kinds share decides nothing");
});

// ── a project with registers ─────────────────────────────────────────────

const db = await getDb();
const store = createLocalStore({ root: path.join(dir, "files") });
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "INT", name: "I", ownerUserId: alice.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);

await inP(async () => {
  for (const c of ["30-10", "30-20"]) await spine.upsertSubsystem(db, { projectId: P, code: c, systemCode: "30" });
  await spine.upsertTag(db, { projectId: P, tagNo: "30-E-1101A", discipline: "equipment" });
  await spine.upsertTag(db, { projectId: P, tagNo: "30-P-1102B", discipline: "equipment", description: "BOOSTER PUMP" });
  for (const l of ['8"-MP-140001-A1A-H', '4"-CW-140002-B1A-N']) await spine.lineForRegister(db, { projectId: P, lineNo: l });
  await importInstrumentIndex(db, { projectId: P, text: "Tag\tService\nTIC-140010\tx\nTIC-140011\ty\nFT-140020\tz\nFT-140021\tw" });
  for (const d of ["K110-30-PID-0021-10-11", "K110-30-PID-0021-10-13"]) await dc.upsertMdr(db, { projectId: P, docNo: d, title: d, discipline: "process" });
  await dc.upsertMdr(db, { projectId: P, docNo: "K110-30-EQL-0001-00-01", title: "Equipment list", discipline: "mechanical" });
});

const file = async (name, type) => ({ bytes: await readFile(`db/test/fixtures/intake/${name}`), name, type });
const xlsx = () => {
  const ws = XLSX.utils.aoa_to_sheet([["EQUIPMENT LIST"], [], ["TAG NO", "SERVICE", "SUBSYSTEM"],
    ["30-E-1101A", "QUENCH EXCHANGER", "30-10"], ["30-P-1102B", "FEED PUMP", "30-10"], ["30-E-1104A", "NEW COOLER", "30-30"], ["XX99", "odd", ""]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "EQ");
  return { bytes: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), name: "eql.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
};
let revText, revXls, revScan, revUnapproved;

test("only an approved revision is read", async () => {
  const t = await inP(async () => inc.registerIncoming(db, { projectId: P, transmittalNo: "DES-TR-01", fromParty: "Designer", sentOn: "2026-10-01",
    receivedOn: "2026-10-02", purpose: "IFC", store, userId: alice.id, items: [
      { docNo: "K110-30-PID-0021-10-11", revision: "3", purpose: "IFC", file: await file("pid-text.pdf", "application/pdf") },
      { docNo: "K110-30-EQL-0001-00-01", revision: "1", purpose: "IFC", file: xlsx() },
      { docNo: "K110-30-PID-0021-10-13", revision: "2", purpose: "IFC", file: await file("pid-scan.pdf", "application/pdf") },
    ] }));
  const t2 = await inP(async () => inc.registerIncoming(db, { projectId: P, transmittalNo: "DES-TR-02", fromParty: "Designer", sentOn: "2026-10-01",
    receivedOn: "2026-10-02", purpose: "IFA", store, userId: alice.id, items: [
      { docNo: "K110-30-PID-0021-10-99", title: "not yet coded", revision: "A", purpose: "IFA", file: await file("pid-text.pdf", "application/pdf") }] }));
  const revOf = async (itemId) => (await db.query("SELECT revision_id FROM transmittal_item WHERE id = $1", [itemId])).rows[0].revision_id;
  [revText, revXls, revScan] = await Promise.all(t.items.map((i) => revOf(i.itemId)));
  revUnapproved = await revOf(t2.items[0].itemId);
  await inP(() => inc.sendReply(db, { projectId: P, incomingId: t.transmittal.id, sentOn: "2026-10-05", userId: alice.id,
    codes: t.items.map((i) => ({ itemId: i.itemId, code: 1 })) }));
  await throws(() => inP(() => intake.readRevision(db, { projectId: P, revisionId: revUnapproved, store, userId: alice.id })), "کد ۱ یا ۲");
});

test("a P&ID with a text layer: numbers in the project's shapes, each new / fill / same, its own number checked", async () => {
  const r = await inP(() => intake.readRevision(db, { projectId: P, revisionId: revText, store, userId: alice.id }));
  equal([r.run.method, r.run.status, r.run.doc_no_seen], ["pdf-text", "read", true]);
  const by = (k, key) => r.items.find((i) => i.kind === k && i.key === key)?.action;
  equal([by("equipment", "30-E-1101A"), by("equipment", "30-E-1103C"), by("line", '8"-MP-140001-A1A-H'), by("line", '6"-MP-140005-A1A-N'),
    by("instrument", "TIC-140001"), by("instrument", "FT-140021"), by("subsystem", "30-10"), by("drawing", "K110-30-PID-0021-10-12")],
    ["same", "new", "same", "new", "new", "same", "same", "new"]);
  assert(!r.items.some((i) => i.key === "K110-30-PID-0021-10-11"), "its own number is a check, not a reference");
  assert(!r.items.some((i) => i.key === "140003"), "a split number (PT 140003) is not invented into a tag");
});

test("a scan is reported as needing OCR, not read as an empty drawing", async () => {
  const r = await inP(() => intake.readRevision(db, { projectId: P, revisionId: revScan, store, userId: alice.id }));
  equal([r.run.status, r.run.scanned_pages, r.items.length], ["needs-ocr", [1], 0]);
});

test("an equipment list: a service fills an empty field, a different one is a conflict, an unknown shape is named", async () => {
  const r = await inP(() => intake.readRevision(db, { projectId: P, revisionId: revXls, store, userId: alice.id }));
  const it = (k, key) => r.items.find((i) => i.kind === k && i.key === key);
  equal([it("equipment", "30-E-1101A").action, it("equipment", "30-P-1102B").action, it("equipment", "30-E-1104A").action, it("subsystem", "30-30").action],
    ["update", "conflict", "new", "new"]);
  const c = it("equipment", "30-P-1102B").changes.find((x) => x.conflict);
  equal([c.from, c.to], ["BOOSTER PUMP", "FEED PUMP"]);
  equal(r.run.unknown_format.map((u) => u.value), ["XX99"]);
});

test("applying: a conflict needs a reason, a rejection too; applied changes reach the registers with their source revision", async () => {
  const b = await inP(() => intake.intakeBoard(db, { projectId: P }));
  const items = b.docs.flatMap((d) => d.items);
  const id = (k, key) => items.find((i) => i.kind === k && i.key === key).id;
  await throws(() => inP(() => intake.decide(db, { projectId: P, itemIds: [id("equipment", "30-P-1102B")], decision: "applied", userId: alice.id })), "دلیل");
  await throws(() => inP(() => intake.decide(db, { projectId: P, itemIds: [id("line", '6"-MP-140005-A1A-N')], decision: "rejected", userId: alice.id })), "دلیل");
  const all = items.filter((i) => i.action !== "conflict").map((i) => i.id);
  const r = await inP(() => intake.decide(db, { projectId: P, itemIds: all, decision: "applied", userId: alice.id }));
  equal(r.errors, []);
  await inP(() => intake.decide(db, { projectId: P, itemIds: [id("equipment", "30-P-1102B")], decision: "applied", reason: "equipment list Rev.1 IFC supersedes", userId: alice.id }));
  const q = async (sql, p = [P]) => (await db.query(sql, p)).rows;
  const tags = await inP(() => q("SELECT tag_no, description, (SELECT code FROM subsystem s WHERE s.id = t.subsystem_id) AS sub FROM tag t WHERE project_id = $1 ORDER BY tag_no"));
  equal(tags.map((t) => [t.tag_no, t.description, t.sub]), [
    ["30-E-1101A", "QUENCH EXCHANGER", "30-10"], ["30-E-1103C", null, null], ["30-E-1104A", "NEW COOLER", "30-30"], ["30-P-1102B", "FEED PUMP", "30-10"]]);
  const lines = await inP(() => q("SELECT line_no FROM line WHERE project_id = $1 ORDER BY line_no"));
  assert(lines.some((l) => l.line_no === '6"-MP-140005-A1A-N'));
  const inst = await inP(() => q("SELECT tag_no FROM instrument WHERE project_id = $1 AND tag_no = 'TIC-140001'"));
  equal(inst.length, 1);
  const ref = await inP(() => q("SELECT doc_no, outside_mdr FROM mdr_document WHERE project_id = $1 AND doc_no = 'K110-30-PID-0021-10-12'"));
  equal(ref.map((r) => r.outside_mdr), [true], "a drawing referenced but not on the MDR is added, flagged");
  const refs = await inP(() => intake.refsOf(db, { projectId: P, kind: "equipment", key: "30-E-1101A" }));
  equal(refs.map((r) => r.doc_no), ["K110-30-PID-0021-10-11", "K110-30-EQL-0001-00-01"], "every revision that showed the tag");
  const pendingSame = await inP(() => q("SELECT count(*)::int AS n FROM intake_item WHERE project_id = $1 AND action = 'same' AND decision = 'pending' AND run_id IN (SELECT run_id FROM intake_item WHERE decision = 'applied' AND action <> 'same')"));
  equal(pendingSame[0].n, 0, "what the document only confirmed is recorded as a reference once a person applies from it");
  const again = await inP(() => intake.decide(db, { projectId: P, itemIds: all, decision: "rejected", reason: "x", userId: alice.id }));
  equal(again.done, 0, "a decided item is not decided twice");
});

test("a reading is a record: its items cannot be rewritten, only decided", async () => {
  await throws(() => inP(() => db.query("UPDATE intake_item SET action = 'same' WHERE project_id = $1", [P])), "permission");
  await throws(() => inP(() => db.query("DELETE FROM intake_run WHERE project_id = $1", [P])), "permission");
});

await run();
