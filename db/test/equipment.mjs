#!/usr/bin/env node
/**
 * Reading an equipment list, and filing what it says.
 *
 * The rule under test throughout: this path never invents a tag and never
 * guesses a chain. An equipment list is the document that decides which
 * hold points a machine gets, so a confident wrong answer here puts an
 * alignment check on a vessel — or takes one off a compressor.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseEquipmentList, classifyKind, toTags, summarise, EQUIPMENT_HEADERS,
} from "../../lib/equipment/parse.mjs";
import { guessMapping } from "../../lib/truth/parse.mjs";

const LIST = `Tag No,Description,Type,Subsystem,Unit
P-2101A,Feed Pump,Centrifugal,21-01,21
P-2101B,Feed Pump (spare),Centrifugal,21-01,21
V-2101,Feed Surge Drum,Vertical,21-01,21
E-2102,Feed/Effluent Exchanger,Shell & Tube,21-02,21
EA-2103,Product Air Cooler,Fin-Fan,21-02,21
TOTAL,,,,
K-2201,Recycle Compressor,Centrifugal,22-01,22`;

// ── reading the file ─────────────────────────────────────────────────────

test("the header row is recognised however it is spelled", async () => {
  for (const h of ["Tag No", "TAG_NUMBER", "Equipment Tag", "tag-no", "شماره تگ", "Item No"]) {
    const { mapping } = guessMapping([h, "Description"], EQUIPMENT_HEADERS);
    equal(mapping.tagNo, 0, `"${h}" must be recognised as the tag column`);
  }
});

test("subsystem and system are different columns and do not steal each other", async () => {
  // Both appear on the same real list. "Subsystem" matching the system
  // pattern would file every tag under the wrong parent, silently.
  const { mapping } = guessMapping(["Tag No", "System", "Subsystem"], EQUIPMENT_HEADERS);
  equal(mapping.system, 1);
  equal(mapping.subsystem, 2);
});

test("a column nobody recognises is reported, never guessed", async () => {
  const r = parseEquipmentList("Tag No,Description\nP-1,Pump");
  assert(r.unmapped.includes("weight"), "an absent field is named as unmapped");
  equal(r.tags[0].vendor, null, "and nothing is put in it");
});

test("a list with no tag column is refused with the headers it did see", async () => {
  const r = parseEquipmentList("Name,Cost\nfoo,3");
  equal(r.tags.length, 0);
  assert(/ستون شمارهٔ تگ پیدا نشد/.test(r.error));
  assert(/Name/.test(r.error), "and says what it found instead, so it can be fixed");
});

test("a space-aligned paste is caught rather than read as one column", async () => {
  // The failure that produced a golden file whose weld number was a whole
  // row. Same shape, different document.
  const r = parseEquipmentList("Tag No      Description      Type\nP-1      Feed Pump      Centrifugal");
  assert(r.tags.length > 0, "aligned columns are a layout, not an error");
  equal(r.tags[0].tagNo, "P-1");
});

test("headings, blanks and the totals row do not become equipment", async () => {
  const r = parseEquipmentList(LIST);
  equal(r.tags.length, 6, "seven data rows, one of which is a total");
  equal(r.skipped, ["TOTAL"], "and it is named, not silently dropped");
  assert(!r.tags.some((t) => t.tagNo === "TOTAL"),
    "a totals row imported as a tag is a subsystem that waits on it forever");
});

test("a tag repeated in the list is reported once and flagged", async () => {
  const r = parseEquipmentList(`Tag No,Description\nP-1,Feed Pump\nP-1,Feed Pump\nV-1,Drum`);
  equal(r.tags.length, 2);
  equal(r.duplicates, ["P-1"], "the two rows may disagree, so a person is told");
});

// ── the classifier ───────────────────────────────────────────────────────

test("the description decides the chain, not the tag prefix", async () => {
  // "C-" is a compressor on one project and a column on the next. A
  // classifier keyed on the prefix is confidently wrong on someone else's list.
  equal(classifyKind("Recycle Compressor").kind, "rotating");
  equal(classifyKind("Absorber Column").kind, "static");
  // Same prefix, opposite answers, decided by the words.
  const r = toTags([["C-101", "Recycle Compressor"], ["C-102", "Absorber Column"]],
    { tagNo: 0, description: 1 });
  equal(r.tags.map((t) => t.kind), ["rotating", "static"]);
});

test("rotating and static are both recognised in Persian", async () => {
  equal(classifyKind("پمپ خوراک").kind, "rotating");
  equal(classifyKind("مخزن ذخیره").kind, "static");
});

test("an air cooler is NOT called static, because its fan needs aligning", async () => {
  // "Air Cooled Exchanger" matches "exchanger". Letting that win would take
  // the alignment hold points off a machine that has a drive.
  equal(classifyKind("Air Cooled Exchanger").kind, null);
  equal(classifyKind("Product Air Cooler").kind, null);
  equal(classifyKind("Fin-Fan Cooler").kind, null);
  assert(/مهندس/.test(classifyKind("Product Air Cooler").why),
    "and it says a person has to decide, rather than giving no reason");
});

test("a package is not classified, because its contents decide", async () => {
  for (const d of ["Nitrogen Package", "Metering Skid", "پکیج ازت"]) {
    equal(classifyKind(d).kind, null, `"${d}" must not be guessed`);
  }
});

test("a description that reads both ways is not a coin to flip", async () => {
  equal(classifyKind("Pump Suction Drum").kind, null,
    "matching both lists means this cannot be read, not that either will do");
});

test("an unreadable description yields null, not a default", async () => {
  equal(classifyKind("").kind, null);
  equal(classifyKind(null, null).kind, null);
  equal(classifyKind("Widget 4000").kind, null, "an unknown word is not a vessel");
});

test("a definite word still wins over a generic one in the same description", async () => {
  equal(classifyKind("Feed Pump Unit").kind, "rotating",
    "'unit' must not make a pump ambiguous");
});

test("the summary counts what is left for a person", async () => {
  const s = summarise(parseEquipmentList(LIST));
  equal(s.total, 6);
  equal(s.rotating, 3, "two feed pumps and a compressor");
  equal(s.static, 2, "a drum and an exchanger");
  equal(s.unclassified, 1, "the air cooler, which a person has to place");
  equal(s.rotating + s.static + s.unclassified, s.total, "every tag is in exactly one bucket");
  equal(s.pctClassified, 83.3, "and the headline number is the honest one, not 100%");
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "equip-db-"));

const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const equip = await import("../../lib/db/repos/equipment.mjs");
const acts = await import("../../lib/db/repos/activities.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });

test("a dry run says what would happen and writes nothing", async () => {
  // An import that can only be understood after it has happened is one
  // nobody runs on a real project.
  await withProject(db, proj.id, async () => {
    const { tags } = parseEquipmentList(LIST);
    const plan = await equip.importEquipmentList(db, { projectId: proj.id, tags, dryRun: true });
    equal(plan.tags, 6);
    equal(plan.created, 6);
    equal(plan.subsystems, 3);
    equal(plan.unclassified.map((u) => u.tagNo), ["EA-2103"]);

    const { rows } = await db.query("SELECT count(*)::int AS n FROM tag WHERE project_id = $1", [proj.id]);
    equal(rows[0].n, 0, "a dry run that writes is not a dry run");
  });
});

test("the import creates the subsystems the list names", async () => {
  // An equipment list is usually the first document that states the
  // breakdown. Refusing until someone loads a subsystem table separately
  // means typing the same codes twice.
  await withProject(db, proj.id, async () => {
    const { tags } = parseEquipmentList(LIST);
    const r = await equip.importEquipmentList(db, { projectId: proj.id, tags, userId: alice.id });
    equal(r.created, 6);
    equal(r.subsystems, 3);

    const { rows } = await db.query(
      "SELECT code, system_code FROM subsystem WHERE project_id = $1 ORDER BY code", [proj.id]);
    equal(rows.map((x) => x.code), ["21-01", "21-02", "22-01"]);
    equal(rows[0].system_code, "21", "derived from the code, since the list had no system column");
  });
});

test("re-importing the same list updates rather than duplicates", async () => {
  await withProject(db, proj.id, async () => {
    const { tags } = parseEquipmentList(LIST);
    const r = await equip.importEquipmentList(db, { projectId: proj.id, tags, userId: alice.id });
    equal(r.updated, 6, "a re-issued list is the normal case, not an error");
    equal(r.created, 0);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM tag WHERE project_id = $1", [proj.id]);
    equal(rows[0].n, 6);
  });
});

test("an imported tag arrives with its chain already running", async () => {
  // The payoff: one file, and every machine knows what it is waiting for.
  await withProject(db, proj.id, async () => {
    const { rows: [pump] } = await db.query(
      "SELECT id FROM tag WHERE tag_no = 'P-2101A' AND project_id = $1", [proj.id]);
    const s = await acts.tagStatus(db, { projectId: proj.id, tagId: pump.id });
    equal(s.next.map((n) => n.code), ["foundation"]);
    equal(s.why.rootCauses[0].discipline, "civil",
      "the list arrived this morning and the civil crew already has its instruction");
    assert(s.steps.some((x) => x.code === "strain"),
      "and the pipe-strain hold point is on it, because the parser read 'Pump'");
  });
});

test("an unclassified tag is imported, queued, and gets no fabricated chain", async () => {
  await withProject(db, proj.id, async () => {
    const queue = await equip.unclassifiedTags(db, { projectId: proj.id });
    equal(queue.map((q) => q.tag_no), ["EA-2103"], "the air cooler waits for a person");

    const s = await acts.tagStatus(db, { projectId: proj.id, tagId: queue[0].id });
    equal(s.chain, null, "no chain, so no verdict");
    assert(/زنجیرهٔ پیش‌نیاز تعریف نشده/.test(s.reason));

    // The human half of "machine detects, human corrects".
    await equip.classifyTag(db, { projectId: proj.id, tagId: queue[0].id, kind: "rotating" });
    const after = await acts.tagStatus(db, { projectId: proj.id, tagId: queue[0].id });
    equal(after.next.map((n) => n.code), ["foundation"], "and now it runs");
    equal((await equip.unclassifiedTags(db, { projectId: proj.id })).length, 0);
  });
});

test("a kind nobody defined cannot be set by hand either", async () => {
  await withProject(db, proj.id, async () => {
    const { rows: [t] } = await db.query(
      "SELECT id FROM tag WHERE tag_no = 'V-2101' AND project_id = $1", [proj.id]);
    await throws(() => equip.classifyTag(db, {
      projectId: proj.id, tagId: t.id, kind: "spinning" }), "INVALID_INPUT");
  });
});

test("a tag with no subsystem is imported and named, not dropped", async () => {
  await withProject(db, proj.id, async () => {
    const { tags } = parseEquipmentList("Tag No,Description\nX-9001,Slop Drum");
    const r = await equip.importEquipmentList(db, { projectId: proj.id, tags, userId: alice.id });
    equal(r.unfiled, ["X-9001"]);
    const { rows } = await db.query(
      "SELECT subsystem_id FROM tag WHERE tag_no = 'X-9001' AND project_id = $1", [proj.id]);
    equal(rows[0].subsystem_id, null, "it exists on the plant whether or not it is filed");
  });
});

await run();
