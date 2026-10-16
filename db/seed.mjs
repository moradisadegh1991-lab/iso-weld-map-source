#!/usr/bin/env node
/**
 * Development seed.
 *
 * In AUTH_MODE=dev the bearer token IS the user id, so any name authenticates
 * — but a brand new user belongs to no project, and `/api/projects` correctly
 * returns nothing. That empty list is the system working, not a bug, and it
 * is also a poor first five minutes. This gives you a project to open.
 *
 *   npm run db:seed            uses the identity "sadegh"
 *   SEED_IDENTITY=ali npm run db:seed
 *
 * Refuses to run unless AUTH_MODE=dev: seeding a real deployment with a
 * fictional engineer who can approve weld registers is not a mistake worth
 * leaving available.
 */
import "../tools/env.mjs";           // the app reads .env.local; so must this
import { createClient } from "../lib/db/client.mjs";
import { migrate } from "../lib/db/migrate.mjs";
import { withProject } from "../lib/db/scope.mjs";
import { ensureUser, createProject, createUnit, addMember } from "../lib/db/repos/projects.mjs";
import { upsertPipingClass, setClassSizes, applyNdtRequirements } from "../lib/db/repos/piping-class.mjs";
import { upsertWelder, addQualification } from "../lib/db/repos/execution.mjs";
import { registerDocument } from "../lib/db/repos/documents.mjs";
import { createRun, saveRegister } from "../lib/db/repos/runs.mjs";
import { getStore } from "../lib/storage/index.mjs";
import { buildModel } from "../lib/engine.js";
import { DEMO } from "../lib/demo.js";

if (process.env.AUTH_MODE !== "dev") {
  console.error("refusing to seed: set AUTH_MODE=dev first.");
  console.error("this creates a fictional engineer who can approve weld registers.");
  process.exit(1);
}

const IDENTITY = process.env.SEED_IDENTITY || "sadegh";
const db = await createClient({ dataDir: process.env.PGLITE_DIR || ".pglite" });

try {
  await migrate(db);

  const user = await ensureUser(db, {
    subject: IDENTITY, email: "moradisadegh70@gmail.com", displayName: "صادق مرادی" });

  const existing = await db.query("SELECT id FROM project WHERE code = 'K110'");
  if (existing.rows.length) {
    console.log(`project K110 already seeded. sign in as: ${IDENTITY}`);
    await addMember(db, { projectId: existing.rows[0].id, userId: user.id, role: "admin" });
    process.exit(0);
  }

  const project = await createProject(db, {
    code: "K110", name: "K110 Ethane Cracking — Kavian Olefin-2", ownerUserId: user.id });
  await createUnit(db, { projectId: project.id, code: "30", name: "Unit 30" });

  await withProject(db, project.id, async () => {
    // A piping class carrying the rule that used to be hard-coded in the
    // engine: field closures at 100%. It belongs here, not in the code.
    const cls = await upsertPipingClass(db, {
      projectId: project.id, code: "DX01", serviceCategory: "normal",
      description: "Carbon steel, Normal Fluid Service",
      materialSpec: "API 5L Gr.B", pwhtAboveMm: 19,
      ndtRules: [{ when: { shopField: "Field" }, method: "RT", percent: 100,
                   reason: "جوش‌های سایت ۱۰۰٪ رادیوگرافی — الزام پروژه، نه کد" }],
      notes: "نمونهٔ توسعه. اعداد واقعی از برگهٔ مشخصات کلاس پروژه بیایند.",
    });
    // Thicknesses are illustrative and marked as such: the real ones come off
    // the class spec sheet, and nothing here guesses them from a schedule.
    await setClassSizes(db, { projectId: project.id, pipingClassId: cls.id, sizes: [
      { nps: 36, schedule: "SCH 10", wallThicknessMm: 7.92, odMm: 914.4 },
      { nps: 18, schedule: "SCH 40", wallThicknessMm: 14.27, odMm: 457.2 },
      { nps: 8, schedule: "SCH 40", wallThicknessMm: 8.18, odMm: 219.1 },
    ]});

    const { rows: [line] } = await db.query(
      `INSERT INTO line (project_id, line_no, piping_class_id, schedule)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [project.id, "36-P-30-001", cls.id, "SCH 10"]);

    for (const [stamp, name] of [["W-12", "رضایی"], ["W-13", "کریمی"]]) {
      const w = await upsertWelder(db, { projectId: project.id, stampNo: stamp, name });
      await addQualification(db, {
        projectId: project.id, welderId: w.id, process: "GTAW", positions: ["6G"],
        couponOdMm: 219.1, couponThicknessMm: 8.18,
        certificateNo: `WQT-${stamp}`, qualifiedOn: "2026-06-01",
      });
    }

    const bytes = Buffer.from("seed placeholder for SW 265022A rev 0");
    const blob = await (await getStore())
      .put(bytes, { ext: ".jpg", contentType: "image/jpeg" });
    const { document } = await registerDocument(db, {
      projectId: project.id, docNo: "SW 265022A", revision: "0", sheetNo: "1/1",
      fileSha256: blob.digest, storageUri: blob.uri, byteSize: blob.size, createdBy: user.id });

    const model = buildModel(DEMO, {});
    const run = await createRun(db, {
      projectId: project.id, documentId: document.id, lineId: line.id,
      payload: DEMO, validationChecks: model.checks, createdBy: user.id });
    await saveRegister(db, {
      projectId: project.id, runId: run.id, documentId: document.id, lineId: line.id, model });
    await applyNdtRequirements(db, { projectId: project.id, runId: run.id, pipingClass: cls });
  });

  console.log(`
seeded.

  sign in with the identity:   ${IDENTITY}
  project:                     K110
  piping class:                DX01 (normal service, field welds 100% RT)
  welders:                     W-12 رضایی · W-13 کریمی  (GTAW 6G)
  drawing:                     SW 265022A rev 0, register saved

Start the app with AUTH_MODE=dev, type that identity into the box next to
"پروژه‌ها", and K110 will be there.
`);
} finally {
  await db.close();
}
