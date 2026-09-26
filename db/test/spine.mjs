#!/usr/bin/env node
/**
 * The cross-discipline spine.
 *
 * The test that matters most is the last one: it pins the database enum to
 * the module registry, so a discipline cannot be declared on the navigation
 * with no way to file its work. That is exactly the drift this whole table
 * exists to prevent, and it would otherwise be discovered by a user.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "spine-db-"));

const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const runsRepo = await import("../../lib/db/repos/runs.mjs");
const exec = await import("../../lib/db/repos/execution.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");
const { MODULES } = await import("../../lib/platform/modules.mjs");
const { buildModel } = await import("../../lib/engine.js");
const { DEMO } = await import("../../lib/demo.js");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "Other", ownerUserId: alice.id });

let sub21, lineId, docId, welds;

test("a subsystem carries its system, and derives it when the import does not", async () => {
  await withProject(db, proj.id, async () => {
    sub21 = await spine.upsertSubsystem(db, {
      projectId: proj.id, code: "21-01", name: "خوراک کوره", handoverSeq: 1,
      targetMcDate: "2026-12-01" });
    equal(sub21.system_code, "21", "21-01 belongs to system 21");

    const given = await spine.upsertSubsystem(db, {
      projectId: proj.id, code: "33-02", systemCode: "SYS-33" });
    equal(given.system_code, "SYS-33", "and a system the caller passes is never overwritten");
  });
});

test("re-importing the breakdown updates rather than duplicates", async () => {
  await withProject(db, proj.id, async () => {
    const again = await spine.upsertSubsystem(db, {
      projectId: proj.id, code: "21-01", handoverSeq: 2 });
    equal(again.id, sub21.id, "the same subsystem, not a second one");
    equal(again.handover_seq, 2);
    equal(again.name, "خوراک کوره",
      "and a field the re-import left blank keeps what it had — an import is not a delete");
  });
});

test("a tag names the discipline it belongs to, and the database enforces it", async () => {
  await withProject(db, proj.id, async () => {
    const pump = await spine.upsertTag(db, {
      projectId: proj.id, tagNo: "P-2101A", discipline: "equipment",
      subsystemId: sub21.id, kind: "pump" });
    equal(pump.discipline, "equipment");

    await throws(() => spine.upsertTag(db, {
      projectId: proj.id, tagNo: "X-1", discipline: "plumbing" }),
      "invalid input value for enum discipline",
      "a discipline nobody declared must not reach the table");

    await throws(() => spine.upsertTag(db, { projectId: proj.id, tagNo: "X-2" }),
      "must name its discipline");
  });
});

test("a subsystem belongs to one project and is invisible from another", async () => {
  // The spine is the table every module will join through, so a leak here
  // would carry one project's progress into another's report.
  await withProject(db, other.id, async () => {
    const { rows } = await db.query("SELECT * FROM subsystem WHERE code = '21-01'");
    equal(rows.length, 0, "row level security applies to the new tables too");
  });
});

// ── the payoff: progress filed across disciplines ────────────────────────

test("welds reach the readiness view through the line they are on", async () => {
  await withProject(db, proj.id, async () => {
    const { rows: [line] } = await db.query(
      "INSERT INTO line (project_id, line_no) VALUES ($1,'21-P-001') RETURNING id", [proj.id]);
    lineId = line.id;
    const { rows: [doc] } = await db.query(
      `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
       VALUES ($1,'SW 265022A','0',$2,'local://x') RETURNING id`, [proj.id, "a".repeat(64)]);
    docId = doc.id;

    await spine.fileLine(db, { projectId: proj.id, lineId, subsystemId: sub21.id });

    const model = buildModel(DEMO, {});
    const runRow = await runsRepo.createRun(db, {
      projectId: proj.id, documentId: docId, lineId, payload: DEMO,
      validationChecks: model.checks });
    await runsRepo.saveRegister(db, {
      projectId: proj.id, runId: runRow.id, documentId: docId, lineId, model });

    ({ rows: welds } = await db.query(
      "SELECT weld_uid FROM weld WHERE extraction_run_id = $1 ORDER BY weld_no", [runRow.id]));
    const w = await exec.upsertWelder(db, { projectId: proj.id, stampNo: "W-12", name: "رضایی" });
    await exec.addQualification(db, { projectId: proj.id, welderId: w.id, process: "GTAW",
      positions: ["6G"], couponOdMm: 219.1, couponThicknessMm: 8.18 });
    await exec.assignWeld(db, { projectId: proj.id, weldUid: welds[0].weld_uid,
      welderId: w.id, weldedAt: "2026-09-10", process: "GTAW", position: "V", lineId });
    await exec.recordNdt(db, { projectId: proj.id, weldUid: welds[0].weld_uid,
      method: "RT", result: "accept" });

    const readiness = await spine.subsystemReadiness(db, { projectId: proj.id });
    const row = readiness.find((r) => r.code === "21-01");
    assert(row, "the subsystem must appear once welds are filed under it");
    equal(row.discipline, "piping");
    equal(row.items, 10);
    equal(row.installed, 1);
    equal(row.tested, 1);
    equal(row.pctReady, 10);
    equal(row.name, "خوراک کوره", "named, so a report does not print a bare code");
  });
});

test("a document filed directly carries work that has no line", async () => {
  // The route every non-piping module takes: it has documents and no lines,
  // and it must be able to file its work without piping's vocabulary.
  await withProject(db, proj.id, async () => {
    const sub33 = await spine.upsertSubsystem(db, { projectId: proj.id, code: "33-02" });
    const filed = await spine.fileDocument(db, {
      projectId: proj.id, documentId: docId, subsystemId: sub33.id });
    equal(filed.subsystem_id, sub33.id);

    // The line still wins for this run, because a line is the finer grain.
    const readiness = await spine.subsystemReadiness(db, { projectId: proj.id });
    assert(readiness.some((r) => r.code === "21-01"),
      "the line's subsystem takes precedence over the document's");
  });
});

test("work belonging to no subsystem is reported, not quietly dropped", async () => {
  // A readiness percentage computed over only the filed items would CLIMB as
  // the breakdown got less complete. The unfiled count is what stops a
  // half-loaded breakdown reading as good news.
  await withProject(db, proj.id, async () => {
    await db.query("UPDATE line SET subsystem_id = NULL WHERE id = $1", [lineId]);
    await db.query("UPDATE document SET subsystem_id = NULL WHERE id = $1", [docId]);

    const orphans = await spine.unfiled(db, { projectId: proj.id });
    const piping = orphans.find((o) => o.discipline === "piping");
    equal(piping.items, 10, "ten welds nobody can hand over yet");

    await spine.fileLine(db, { projectId: proj.id, lineId, subsystemId: sub21.id });
  });
});

test("a line that does not belong to this project is not filed", async () => {
  await withProject(db, other.id, async () => {
    await throws(() => spine.fileLine(db, {
      projectId: other.id, lineId, subsystemId: sub21.id }), "line not found");
  });
});

// ── the guard that keeps the platform coherent ───────────────────────────

test("every module the platform declares can actually file its work", async () => {
  const { rows } = await db.query(
    "SELECT unnest(enum_range(NULL::discipline))::text AS d");
  const inDb = new Set(rows.map((r) => r.d));
  for (const m of MODULES) {
    assert(inDb.has(m.discipline),
      `module ${m.id} declares discipline "${m.discipline}", which the database `
      + `cannot store — it would appear in the navigation with nowhere to file its work`);
  }
});

await run();
