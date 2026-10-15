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
const { shapeOf, shapeRegex, learnShapes, recognize, repair, confusableKey } = await import("../../lib/intake/patterns.mjs");
const { compileFormat, parseLineNumbers, parseCodeList } = await import("../../lib/intake/legend.mjs");
const { parseTsv, linesOf, ocrEngine } = await import("../../lib/intake/ocr.mjs");
const { extract, diff } = await import("../../lib/intake/extract.mjs");

// ── shapes ───────────────────────────────────────────────────────────────

test("a shape keeps separators, turns digits to 9 and letters to A; a register teaches only shapes it repeats", async () => {
  equal([shapeOf("30-E-1101A"), shapeOf('8"-MP-140001-A1A-H'), shapeOf("TIC-140001")], ["99-A-9999A", '9"-AA-999999-A9A-A', "AAA-999999"]);
  assert(shapeRegex("99-A-9999A").test("30-P-1102B") && !shapeRegex("99-A-9999A").test("30-P-1102"));
  equal(learnShapes(["30-E-1101A", "30-P-1102B", "P-7001"]).map((s) => s.shape), ["99-A-9999A"], "one P-7001 is not a pattern");
  const r = recognize("30-E-1101A and 30-10 / 30-10", [{ kind: "equipment", shape: "99-A-9999A" }, { kind: "subsystem", shape: "99-99" }, { kind: "line", shape: "99-99" }]);
  equal([[...r.found.get("equipment").keys()], r.ambiguous.get("30-10")], [["30-E-1101A"], ["subsystem", "line"]],
    "a shape two kinds share decides nothing");
});

// ── OCR misreads, the legend, the engine's words ─────────────────────────

test("an OCR misread is repaired only to the project's shapes, and only when one reading fits", async () => {
  const pats = [{ kind: "equipment", shape: "99-A-9999A" }, { kind: "instrument", shape: "AAA-999999" }];
  equal(repair("3O-E-11O1A", pats), { value: "30-E-1101A", kinds: ["equipment"] }, "O where the shape has a digit");
  equal(repair("T1C-140001", pats), { value: "TIC-140001", kinds: ["instrument"] }, "1 where the shape has a letter");
  equal([repair("30-E-1101A", pats), repair("30-E-110XA", pats), repair("30-E1101A", pats)], [null, null, null],
    "nothing to swap, a letter no digit is confused with, a separator missing: not repaired");
  equal(confusableKey("30-E-11O1A") === confusableKey("30-E-1101A"), true);
});

test("the line-number format: the bracketed part is the number; codes the legend lacks are named, not filled", async () => {
  const f = compileFormat('{size}"-[{fluid}-{number}]-{class}(-{insulation})');
  const codes = { fluid: new Map([["MP", "MEDIUM PRESSURE STEAM"]]), insulation: new Map([["H", "HOT"]]) };
  const r = parseLineNumbers('8"-MP-140001-A1A-H  6" - XX-140005-A1A-N  3/4"-MP-140009-B1A', f, codes);
  equal(r.map((x) => [x.key, x.size, x.class, x.fluid, x.insulation, x.unknown]), [
    ["MP-140001", "8", "A1A", "MP", "H", {}],
    ["XX-140005", "6", "A1A", null, null, { fluid: "XX", insulation: "N" }],
    ["MP-140009", "3/4", "B1A", "MP", null, {}]]);
  const whole = compileFormat('[{size}"-{fluid}-{number}-{class}(-{insulation})]');
  equal(parseLineNumbers('8" - MP-140001-A1A-H', whole).map((x) => x.key), ['8"-MP-140001-A1A-H'], "spacing as printed or OCR'd, one key");
  for (const [bad, why] of [["{size}-{fluid}-{number}", "[ ]"], ["[{fluid}]-{number}", "{number}"], ["[{fluid}-{nr}]", "nr"]]) {
    let msg = ""; try { compileFormat(bad); } catch (e) { msg = e.message; }
    assert(msg.includes(why), `${bad} refused: ${msg}`);
  }
  equal(parseCodeList("MP = MEDIUM PRESSURE STEAM\nh\tHOT INSULATION"), [{ code: "MP", meaning: "MEDIUM PRESSURE STEAM" }, { code: "H", meaning: "HOT INSULATION" }]);
});

test("Tesseract's words carry their confidence; an unsure word makes its number 'to be checked'", async () => {
  const tsv = ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "5\t1\t1\t1\t1\t1\t300\t300\t300\t30\t96.1\t30-E-1101A",
    "5\t1\t1\t1\t1\t2\t700\t300\t300\t30\t52.0\t30-E-1107A",
    "5\t1\t1\t1\t1\t3\t1100\t300\t300\t30\t91.0\t3O-P-1102B",
    "5\t1\t1\t1\t1\t4\t1500\t300\t300\t30\t93.0\t30-P-11O2C",
    "5\t1\t2\t1\t1\t1\t300\t600\t30\t30\t-1\t"].join("\n");
  const words = parseTsv(tsv, { dpi: 300 });
  equal([words.length, words[0].c, words[0].b], [4, 0.96, [72, 72, 144, 79.2]], "points, 0..1");
  const page = { n: 1, words, lines: linesOf(words), text: "" };
  const ex = extract({ pages: [page] }, { patterns: [{ kind: "equipment", shape: "99-A-9999A" }], docNo: "X" });
  const reg = { equipment: new Map([["30-E-1101A", { id: "a" }], ["30-P-1102B", { id: "b" }], ["30-P-1102C", { id: "c" }]]) };
  const p = new Map(diff(ex.candidates, reg).map((x) => [x.key, x]));
  equal([p.get("30-E-1101A").check, p.get("30-E-1107A").check, p.get("30-P-1102B").ocrRead, p.get("30-P-1102B").action],
    [["خوانده‌شده با OCR"], ["خوانده‌شده با OCR", "اطمینان OCR 52٪"], "3O-P-1102B", "same"],
    "every OCR number is checked before it changes a register; an unsure word says so; a repaired one says what was printed");
  const s = diff([{ kind: "equipment", key: "30-P-1102D", attrs: {}, where: [], disagree: {}, ocr: { conf: 0.99 } }],
    { equipment: new Map([["30-P-11O2D", { id: "x" }]]) })[0];
  equal(s.suspect, "30-P-11O2D", "a new number one misread away from a register number is named");
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

test("a scan read by OCR: numbers proposed with their confidence; one to be checked is applied only with a reason", async () => {
  const { engine } = await ocrEngine();
  if (!engine) { console.log("  SKIP no OCR engine on this machine (apt install tesseract-ocr poppler-utils)"); return; }
  const t = await inP(async () => inc.registerIncoming(db, { projectId: P, transmittalNo: "DES-TR-03", fromParty: "Designer", sentOn: "2026-10-06",
    receivedOn: "2026-10-06", purpose: "IFC", store, userId: alice.id, items: [
      { docNo: "K110-30-PID-0021-10-11", revision: "4", purpose: "IFC", file: await file("pid-scan-text.pdf", "application/pdf") }] }));
  await inP(() => inc.sendReply(db, { projectId: P, incomingId: t.transmittal.id, sentOn: "2026-10-07", userId: alice.id,
    codes: [{ itemId: t.items[0].itemId, code: 1 }] }));
  const rev = (await db.query("SELECT revision_id FROM transmittal_item WHERE id = $1", [t.items[0].itemId])).rows[0].revision_id;
  await inP(async () => {
    await intake.setLineFormat(db, { projectId: P, format: '[{size}"-{fluid}-{number}-{class}(-{insulation})]', example: '8"-MP-140001-A1A-H', userId: alice.id });
    await intake.addLegendCodes(db, { projectId: P, kind: "fluid", text: "MP = MEDIUM PRESSURE STEAM", userId: alice.id });
    await intake.addLegendCodes(db, { projectId: P, kind: "insulation", text: "H = HOT INSULATION\nN = NOT INSULATED", userId: alice.id });
  });
  const text = await inP(() => intake.readRevision(db, { projectId: P, revisionId: rev, store, userId: alice.id }));
  equal(text.run.status, "needs-ocr");
  const q = await inP(() => intake.queueOcr(db, { projectId: P, revisionId: rev, userId: alice.id }));
  equal([q.method, q.status], ["ocr", "queued"]);
  const r = await intake.ocrRevision(db, { projectId: P, revisionId: rev, store, userId: alice.id });
  equal([r.run.method, r.run.status, r.run.ocr_pages, r.run.doc_no_seen], ["ocr", "read", [1], true], r.run.error || "");
  assert(r.run.engine?.startsWith("tesseract"), r.run.engine);
  const by = (k, key) => r.items.find((i) => i.kind === k && i.key === key);
  equal([by("equipment", "30-E-1101A")?.action, by("instrument", "FT-140021")?.action, by("drawing", "K110-30-PID-0021-10-12")?.action],
    ["same", "same", "same"], "the scan shows what the text layer of Rev.3 showed");
  assert(by("equipment", "30-E-1101A").confidence > 0.5, "confidence recorded");
  const line = by("line", '6"-MP-140005-A1A-N');
  equal(line?.changes.map((c) => [c.field, c.to]), [["piping_class", "A1A"], ["fluid_code", "MP"], ["insulation", "N"]], "the format reads the class; the legend fills fluid and insulation");
  assert(!r.items.some((i) => i.kind === "line" && /PID/.test(i.key)), "a drawing number is not read as a line number");
  const [item] = (await inP(() => db.query("SELECT i.id FROM intake_item i WHERE i.run_id = $1 AND i.kind = 'line' AND i.key = $2", [r.run.id, '6"-MP-140005-A1A-N']))).rows;
  await throws(() => inP(() => intake.decide(db, { projectId: P, itemIds: [item.id], decision: "applied", userId: alice.id })), "بررسی شود");
  await throws(() => inP(() => db.query("UPDATE intake_item SET decision = 'applied', decided_by = $2, decided_at = now() WHERE id = $1", [item.id, alice.id])),
    "intake_item_check_needs_reason", "the database holds the rule too");
  await inP(() => intake.decide(db, { projectId: P, itemIds: [item.id], decision: "applied", reason: "checked against the scan, sheet 1", userId: alice.id }));
  const [l] = (await inP(() => db.query("SELECT fluid_code, insulation FROM line WHERE project_id = $1 AND line_no = $2", [P, '6"-MP-140005-A1A-N']))).rows;
  equal([l.fluid_code, l.insulation], ["MP", "N"]);
});

// ── phase 3: datasheets, cable schedules, structural drawings ────────────

test("a datasheet's design conditions: gauge units converted exactly; bar without g/a, absolute and two values are named, not filled", async () => {
  const { designConditions, totalWeight, structureTypeOf } = await import("../../lib/intake/datasheet.mjs");
  const d = (t) => { const r = designConditions(t); return [r.pressure, r.tmin, r.tmax, r.problems.length]; };
  equal(d("DESIGN PRESSURE (barg) 25\nDESIGN TEMPERATURE -29 / 350 °C"), [25, -29, 350, 0]);
  equal(d("DESIGN PRESSURE: 2.5 MPa(g) @ 350 °C\nDESIGN TEMP. 650 °F"), [25, null, 343.3, 0], "@ starts the coincident temperature, not a pressure");
  equal(d("DESIGN PRESSURE 25 bar\nDESIGN TEMPERATURE 120"), [null, null, null, 2], "bar alone, and no temperature unit");
  equal(d("DESIGN PRESSURE 10 bara"), [null, null, null, 1], "absolute needs the site's atmosphere");
  equal(d("DESIGN PRESSURE SHELL 25 barg TUBE 40 barg\nMDMT -46 °C\nDESIGN TEMPERATURE 200 C"), [null, -46, 200, 1], "two pressures: not picked");
  equal([totalWeight("TOTAL WEIGHT: 45 200 KG"), totalWeight("TOTAL STEEL WEIGHT 12.5 T"), structureTypeOf("PIPE RACK PR-01"), structureTypeOf("PIPE RACK AND PLATFORM")],
    [45.2, 12.5, "pipe_rack", null]);
});

test("phase 3 in the registers: datasheet → design conditions of its tag; cable schedule → cables; GA → structure", async () => {
  const cables = () => {
    const ws = XLSX.utils.aoa_to_sheet([["CABLE SCHEDULE"], ["CABLE NO", "FROM", "TO", "CABLE TYPE", "LENGTH"],
      ["30-PC-1101", "MCC-30-01", "30-P-1102B", "3Cx16mm2 0.6/1kV XLPE/SWA", "120"], ["30-PC-1102", "MCC-30-01", "30-E-1101A HEATER", "3Cx4mm2 0.6/1kV", "85"]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "CS");
    return { bytes: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), name: "cs.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  };
  await inP(async () => {
    const [eq] = (await db.query("SELECT id FROM tag WHERE project_id = $1 AND tag_no = '30-E-1101A'", [P])).rows;
    await dc.upsertMdr(db, { projectId: P, docNo: "K110-30-DS-1101-00-01", title: "Datasheet E-1101A", discipline: "mechanical", tagId: eq.id });
    await dc.upsertMdr(db, { projectId: P, docNo: "K110-30-DS-9999-00-01", title: "Datasheet, not linked", discipline: "mechanical" });
    await dc.upsertMdr(db, { projectId: P, docNo: "K110-30-CS-0001-00-01", title: "Cable schedule", discipline: "electrical" });
    await dc.upsertMdr(db, { projectId: P, docNo: "K110-30-ST-0101-00-01", title: "Pipe rack GA", discipline: "structural" });
    await intake.addPattern(db, { projectId: P, kind: "structure", example: "PR-3001", userId: alice.id });
  });
  const t = await inP(async () => inc.registerIncoming(db, { projectId: P, transmittalNo: "DES-TR-04", fromParty: "Designer", sentOn: "2026-10-08",
    receivedOn: "2026-10-08", purpose: "IFC", store, userId: alice.id, items: [
      { docNo: "K110-30-DS-1101-00-01", revision: "1", purpose: "IFC", file: await file("datasheet.pdf", "application/pdf") },
      { docNo: "K110-30-DS-9999-00-01", revision: "1", purpose: "IFC", file: await file("datasheet.pdf", "application/pdf") },
      { docNo: "K110-30-CS-0001-00-01", revision: "1", purpose: "IFC", file: cables() },
      { docNo: "K110-30-ST-0101-00-01", revision: "0", purpose: "IFC", file: await file("structure.pdf", "application/pdf") }] }));
  await inP(() => inc.sendReply(db, { projectId: P, incomingId: t.transmittal.id, sentOn: "2026-10-09", userId: alice.id,
    codes: t.items.map((i) => ({ itemId: i.itemId, code: 1 })) }));
  const revs = await Promise.all(t.items.map(async (i) => (await db.query("SELECT revision_id FROM transmittal_item WHERE id = $1", [i.itemId])).rows[0].revision_id));
  const [ds, dsLoose, cs, ga] = await Promise.all(revs.map((r) => inP(() => intake.readRevision(db, { projectId: P, revisionId: r, store, userId: alice.id }))));

  const design = ds.items.find((i) => i.kind === "design");
  equal([design?.key, design?.action, design?.changes.map((c) => [c.field, c.to])],
    ["30-E-1101A", "update", [["design_pressure_barg", "25"], ["design_temp_min_c", "-29"], ["design_temp_max_c", "350"]]], "2.5 MPa(g) is 25 barg");
  assert(!ds.items.some((i) => i.kind === "design" && i.key !== "30-E-1101A"), "only the tag the document is registered against");
  assert(!dsLoose.items.some((i) => i.kind === "design") && dsLoose.run.notes.some((n) => n.includes("وصل نیست")), "a datasheet linked to no tag fills nothing, and says why");

  const c1 = cs.items.find((i) => i.kind === "cable" && i.key === "30-PC-1101");
  equal([c1?.action, cs.items.filter((i) => i.kind === "cable").length], ["new", 2]);
  const st = ga.items.find((i) => i.kind === "structure");
  equal([st?.key, st?.action, st?.attrs.tonnage, st?.attrs.type, st?.attrs.drawing], ["PR-3001", "new", "45.2", "pipe_rack", "K110-30-ST-0101-00-01"]);

  const ids = [design, c1, cs.items.find((i) => i.key === "30-PC-1102"), st].map((x) => x.id ?? null);
  const board = await inP(() => intake.intakeBoard(db, { projectId: P }));
  const all = board.docs.flatMap((d) => d.items);
  const pick = (k, key) => all.find((i) => i.kind === k && i.key === key).id;
  const r = await inP(() => intake.decide(db, { projectId: P, itemIds: [pick("design", "30-E-1101A"), pick("cable", "30-PC-1101"), pick("cable", "30-PC-1102"), pick("structure", "PR-3001")],
    decision: "applied", userId: alice.id }));
  equal(r.errors, []);
  const q = async (sql) => (await inP(() => db.query(sql, [P]))).rows;
  const [m] = await q(`SELECT m.design_pressure_barg::float AS p, m.design_temp_min_c::float AS tmin, m.design_temp_max_c::float AS tmax, d.doc_no
    FROM asset_master m JOIN tag t ON t.id = m.tag_id JOIN mdr_revision r ON r.id = m.design_datasheet_rev_id JOIN mdr_document d ON d.id = r.mdr_id
    WHERE t.project_id = $1 AND t.tag_no = '30-E-1101A'`);
  equal([m.p, m.tmin, m.tmax, m.doc_no], [25, -29, 350, "K110-30-DS-1101-00-01"], "the datasheet revision read is the one cited");
  const cb = await q("SELECT c.cable_no, c.cores, c.size_mm2::float AS mm2, c.voltage_class, c.length_m::float AS len, t.tag_no FROM cable c LEFT JOIN tag t ON t.id = c.to_tag_id WHERE c.project_id = $1 ORDER BY 1");
  equal(cb.map((c) => [c.cable_no, c.cores, c.mm2, c.voltage_class, c.len, c.tag_no]),
    [["30-PC-1101", 3, 16, "LV", 120, "30-P-1102B"], ["30-PC-1102", 3, 4, "LV", 85, "30-E-1101A"]], "through the schedule importer: size, rating, tag fed");
  const [s] = await q("SELECT t.tag_no, s.structure_type, s.tonnage_t::float AS w, s.drawing_ref FROM tag t JOIN structure_spec s ON s.tag_id = t.id WHERE t.project_id = $1");
  equal([s.tag_no, s.structure_type, s.w, s.drawing_ref], ["PR-3001", "pipe_rack", 45.2, "K110-30-ST-0101-00-01"]);
});

test("PGlite is one connection: two projects' scoped work interleaving does not see each other", async () => {
  const other = await projects.createProject(db, { code: "INT2", name: "J", ownerUserId: alice.id });
  const slow = (pid, tag) => withProject(db, pid, async () => {
    await spine.upsertTag(db, { projectId: pid, tagNo: tag, discipline: "equipment" });
    await new Promise((r) => setTimeout(r, 30));
    return (await db.query("SELECT tag_no FROM tag WHERE tag_no LIKE 'ISO-%' ORDER BY 1")).rows.map((r) => r.tag_no);
  });
  const [a, b] = await Promise.all([slow(P, "ISO-A"), slow(other.id, "ISO-B")]);
  equal([a, b], [["ISO-A"], ["ISO-B"]]);
});

test("a reading is a record: its items cannot be rewritten, only decided", async () => {
  await throws(() => inP(() => db.query("UPDATE intake_item SET action = 'same' WHERE project_id = $1", [P])), "permission");
  await throws(() => inP(() => db.query("DELETE FROM intake_run WHERE project_id = $1", [P])), "permission");
});

await run();
