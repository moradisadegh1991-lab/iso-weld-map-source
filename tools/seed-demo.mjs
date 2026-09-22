/**
 * An olefin plant, so the screens can be judged against something real.
 *
 *   npm run demo:seed -- you@example.com
 *
 * Fills the signed-in user's DEMO project (created by `npm run auth:admin`)
 * with a steam cracker: siting, subsystems, contractors and their packages,
 * an equipment list, one saved isometric register, spool progress and a
 * support schedule. Safe to run twice — everything upserts, and the register
 * is only created if it is not already there.
 *
 * Every value here is DEMONSTRATION data. The coordinates are a round point
 * in the Asalouyeh area, not any real plant's survey origin, and must not be
 * copied into a real project.
 */
import "./env.mjs";
import { getDb } from "../lib/server/db.mjs";
import { withProject } from "../lib/db/scope.mjs";
import { updateProjectProfile } from "../lib/db/repos/projects.mjs";
import { upsertContractor, upsertPackage } from "../lib/db/repos/contractors.mjs";
import { parseEquipmentList } from "../lib/equipment/parse.mjs";
import { importEquipmentList } from "../lib/db/repos/equipment.mjs";
import { upsertSubsystem, fileLine } from "../lib/db/repos/spine.mjs";
import { recordActivity } from "../lib/db/repos/activities.mjs";
import { createRun, saveRegister } from "../lib/db/repos/runs.mjs";
import { upsertWelder, addQualification, assignWeld, recordNdt } from "../lib/db/repos/execution.mjs";
import { recordSpoolActivity, upsertSupport, markSupport } from "../lib/db/repos/piping-execution.mjs";
import { buildModel } from "../lib/engine.js";
import { DEMO } from "../lib/demo.js";

const email = (process.argv[2] || "").toLowerCase();
if (!email.includes("@")) {
  console.error("usage: npm run demo:seed -- <the email you created with npm run auth:admin>");
  process.exit(1);
}

// A steam cracker, by section. Numbering follows the common convention of
// section digit + sequence; descriptions are what decides the chain, so they
// are written the way a real list writes them.
const EQUIPMENT = `Tag No,Description,Type,Subsystem,Unit
F-1101A,Ethane Cracking Furnace,Fired,11-01,11
F-1101B,Naphtha Cracking Furnace,Fired,11-01,11
E-1102A,Transfer Line Exchanger,TLE,11-01,11
V-1103,Steam Drum,Horizontal,11-01,11
FN-1104,Induced Draft Fan,Centrifugal,11-01,11
T-1201,Quench Oil Tower,Tray Column,12-01,12
T-1202,Quench Water Tower,Packed Column,12-01,12
P-1203A,Quench Oil Circulation Pump,Centrifugal,12-01,12
P-1203B,Quench Oil Circulation Pump (spare),Centrifugal,12-01,12
P-1204A,Quench Water Pump,Centrifugal,12-01,12
K-2101,Charge Gas Compressor,Centrifugal 5-stage,21-01,21
KT-2101,Charge Gas Compressor Steam Turbine,Condensing,21-01,21
V-2102,1st Stage Suction Drum,Vertical,21-01,21
T-2103,Caustic Wash Tower,Packed Column,21-01,21
V-2104A,Cracked Gas Dryer,Molecular Sieve,21-01,21
PK-3101,Cold Box,Plate-fin,31-01,31
T-3102,Demethanizer Column,Tray Column,31-01,31
T-3103,Deethanizer Column,Tray Column,31-02,31
R-3104,Acetylene Converter,Fixed Bed Reactor,31-02,31
T-3105,C2 Splitter Column,Tray Column,31-02,31
T-3106,Depropanizer Column,Tray Column,31-02,31
K-5101,Propylene Refrigeration Compressor,Centrifugal,51-01,51
K-5102,Ethylene Refrigeration Compressor,Centrifugal,51-02,51
EA-5103,Propylene Condenser Air Cooler,Fin-Fan,51-01,51
V-5104,Propylene Accumulator,Horizontal,51-01,51
P-6101A,Boiler Feed Water Pump,Multistage,60-01,60
PK-6102,Nitrogen Generation Package,Package,60-01,60
TOTAL,,,,`;

const SUBSYSTEMS = [
  ["11-01", "کوره‌های کراکینگ", 1, "2027-09-30"],
  ["12-01", "کوئنچ روغن و آب", 2, "2027-10-31"],
  ["21-01", "کمپرسور گاز شکسته", 3, "2027-12-15"],
  ["31-01", "بخش سرد — دمتانایزر", 4, "2028-02-28"],
  ["31-02", "جداسازی C2 و C3", 5, "2028-03-31"],
  ["51-01", "تبرید پروپیلن", 4, "2028-01-31"],
  ["51-02", "تبرید اتیلن", 4, "2028-01-31"],
  ["60-01", "یوتیلیتی", 0, "2027-06-30"],
];

const db = await getDb();
try {
  const { rows: [user] } = await db.query(
    "SELECT id FROM app_user WHERE lower(email) = $1", [email]);
  if (!user) throw new Error(`no account for ${email} — run npm run auth:admin first`);
  const { rows: [p] } = await db.query(
    `SELECT p.id, p.code FROM project p JOIN project_member m ON m.project_id = p.id
      WHERE m.user_id = $1 AND p.code = 'DEMO'`, [user.id]);
  if (!p) throw new Error("this account has no DEMO project");

  await updateProjectProfile(db, { projectId: p.id, patch: {
    name: "واحد الفین — کراکر اتان و نفتا (نمایشی)",
    client_name: "کارفرمای نمایشی پتروشیمی",
    consultant_name: "مشاور نمایشی",
    contractor_name: "کنسرسیوم EPC نمایشی",
    contract_no: "OLF-EPC-DEMO-001", contract_date: "2026-02-11",
    contract_value: 1250000000, contract_currency: "EUR",
    site_location: "عسلویه — منطقهٔ ویژهٔ پارس (نمایشی)",
    start_date: "2026-03-01", planned_end_date: "2029-03-31",
    description: "کراکر بخار با خوراک اتان و نفتا: کوره‌ها، کوئنچ، کمپرسور گاز شکسته، "
      + "بخش سرد، جداسازی و تبرید. همهٔ داده‌ها نمایشی است.",
    origin_latitude: 27.48, origin_longitude: 52.61,
    grid_origin_e_mm: 0, grid_origin_n_mm: 0, plant_north_deg: 0,
    elevation_datum: "گرید ±0.00 = EL 100000 mm",
    grade_elevation_mm: 100000, min_cover_mm: 800,
  }});

  await withProject(db, p.id, async () => {
    // The earlier demo used a generic list; clear what this one replaces so
    // the screens show one coherent plant rather than two half-plants.
    const keep = parseEquipmentList(EQUIPMENT).tags.map((t) => t.tagNo);
    await db.query(
      "DELETE FROM tag WHERE project_id = $1 AND discipline = 'equipment' AND NOT (tag_no = ANY($2))",
      [p.id, keep]);

    const sub = {};
    for (const [code, name, seq, mc] of SUBSYSTEMS) {
      sub[code] = await upsertSubsystem(db, { projectId: p.id, code, name,
        handoverSeq: seq, targetMcDate: mc });
    }

    const civil = await upsertContractor(db, { projectId: p.id, code: "C-01",
      name: "سازه پاد جنوب (نمایشی)", disciplines: ["civil", "structural"],
      contactName: "مهندس احمدی", prequalifiedUntil: "2028-04-30" });
    const mech = await upsertContractor(db, { projectId: p.id, code: "C-02",
      name: "نصب گستر پارس (نمایشی)", disciplines: ["piping", "equipment"],
      contactName: "مهندس رضایی", prequalifiedUntil: "2026-05-01" });
    await upsertContractor(db, { projectId: p.id, code: "C-03",
      name: "برق و کنترل آریا (نمایشی)", disciplines: ["electrical", "instrumentation"],
      status: "prospective", prequalifiedUntil: "2028-01-01" });

    await upsertPackage(db, { projectId: p.id, contractorId: civil.id, code: "PKG-CIV-01",
      title: "فونداسیون کل واحد", discipline: "civil", value: 42000000, currency: "EUR" });
    await upsertPackage(db, { projectId: p.id, contractorId: civil.id, code: "PKG-STR-01",
      title: "اسکلت فلزی کوره‌ها", discipline: "structural", subsystemId: sub["11-01"].id,
      value: 68000000, currency: "EUR" });
    await upsertPackage(db, { projectId: p.id, contractorId: mech.id, code: "PKG-PIP-01",
      title: "پایپینگ کل واحد", discipline: "piping", value: 115000000, currency: "EUR" });
    await upsertPackage(db, { projectId: p.id, contractorId: mech.id, code: "PKG-EQP-01",
      title: "نصب تجهیزات دوّار کمپرسورها", discipline: "equipment",
      subsystemId: sub["21-01"].id, value: 31000000, currency: "EUR" });

    const parsed = parseEquipmentList(EQUIPMENT);
    const report = await importEquipmentList(db, { projectId: p.id, tags: parsed.tags, userId: user.id });
    console.log(`equipment: ${parsed.tags.length} tags, ${report.unclassified.length} left for a person:`,
      report.unclassified.map((u) => u.tagNo).join(", "));

    // Some progress on the charge gas compressor, so its chain has a story.
    const { rows: [k2101] } = await db.query(
      "SELECT id FROM tag WHERE project_id = $1 AND tag_no = 'K-2101'", [p.id]);
    for (const [code, d, ref] of [["foundation", "2026-07-10", "POUR-2101"],
                                  ["set", "2026-08-20", "SET-2101"],
                                  ["grout", "2026-08-27", "GRT-2101"]]) {
      await recordActivity(db, { projectId: p.id, tagId: k2101.id, code, doneAt: d,
        refNo: ref, userId: user.id });
    }

    // One saved isometric register: the demo drawing, a cooling-water line.
    const { rows: existing } = await db.query(
      "SELECT id FROM document WHERE project_id = $1 AND doc_no = 'SW 265022A'", [p.id]);
    if (!existing.length) {
      const { rows: [line] } = await db.query(
        `INSERT INTO line (project_id, line_no, service) VALUES ($1,'28-CWR-10-930065A','Cooling water return')
         ON CONFLICT (project_id, line_no) DO UPDATE SET service = EXCLUDED.service RETURNING id`, [p.id]);
      await fileLine(db, { projectId: p.id, lineId: line.id, subsystemId: sub["60-01"].id });
      const { rows: [doc] } = await db.query(
        `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
         VALUES ($1,'SW 265022A','0',$2,'local://demo') RETURNING id`, [p.id, "d".repeat(64)]);
      const model = buildModel(DEMO, { gradeElevationMm: 100000 });
      const run = await createRun(db, { projectId: p.id, documentId: doc.id, lineId: line.id,
        payload: DEMO, validationChecks: model.checks, createdBy: user.id });
      await saveRegister(db, { projectId: p.id, runId: run.id, documentId: doc.id,
        lineId: line.id, model });

      const { rows: spools } = await db.query(
        "SELECT id, spool_no FROM spool WHERE project_id = $1 ORDER BY spool_no", [p.id]);
      const { rows: welds } = await db.query(
        "SELECT weld_uid, spool_id, shop_field FROM weld WHERE project_id = $1 ORDER BY weld_no", [p.id]);

      const welder = await upsertWelder(db, { projectId: p.id, stampNo: "W-12", name: "جوشکار نمایشی" });
      await addQualification(db, { projectId: p.id, welderId: welder.id, process: "GTAW",
        positions: ["6G"], couponOdMm: 219.1, couponThicknessMm: 8.18 });

      // First spool: well along. Second: fit-up only. The rest: untouched.
      const [s1, s2] = spools;
      for (const [code, d, ref] of [["released", "2026-08-01", null],
                                    ["fit_up", "2026-08-04", "FU-0101"]]) {
        await recordSpoolActivity(db, { projectId: p.id, spoolId: s1.id, code, doneAt: d,
          refNo: ref, contractorId: mech.id, userId: user.id });
      }
      for (const w of welds.filter((x) => x.spool_id === s1.id && x.shop_field === "Shop")) {
        await assignWeld(db, { projectId: p.id, weldUid: w.weld_uid, welderId: welder.id,
          weldedAt: "2026-08-06", process: "GTAW", position: "V", lineId: line.id });
        await recordNdt(db, { projectId: p.id, weldUid: w.weld_uid, method: "RT", result: "accept" });
      }
      if (s2) {
        await recordSpoolActivity(db, { projectId: p.id, spoolId: s2.id, code: "released",
          doneAt: "2026-08-10", contractorId: mech.id, userId: user.id });
      }

      const supports = [
        ["AN-0931", "anchor", null, s1?.id],
        ["G-0932", "guide", null, s1?.id],
        ["SH-0933", "spring_hanger", 18.4, s2?.id],
        ["SH-0934", "shoe", null, s2?.id],
      ];
      for (const [no, kind, load, spoolId] of supports) {
        await upsertSupport(db, { projectId: p.id, supportNo: no, kind, loadKn: load,
          lineId: line.id, spoolId, drawingRef: "STD-PS-0" + (kind === "spring_hanger" ? "7" : "2"),
          contractorId: mech.id });
      }
      const { rows: [an] } = await db.query(
        "SELECT id FROM pipe_support WHERE project_id = $1 AND support_no = 'AN-0931'", [p.id]);
      await markSupport(db, { projectId: p.id, supportId: an.id, step: "installed",
        on: "2026-08-12", userId: user.id });
      console.log(`register: ${welds.length} welds, ${spools.length} spools, ${supports.length} supports`);
    } else {
      console.log("register: already present, left as it is");
    }
  });
  console.log(`demo seeded into ${p.code}`);
} finally {
  await db.close();
}
