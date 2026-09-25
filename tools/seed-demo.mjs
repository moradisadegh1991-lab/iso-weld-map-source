/**
 * An olefin plant, so the screens can be judged against something real.
 *
 *   npm run demo:seed -- you@example.com
 *
 * Fills the signed-in user's DEMO project (created by `npm run auth:admin`)
 * with a steam cracker: siting, subsystems, contractors and their packages,
 * an equipment list, one saved isometric register, spool progress and a
 * support schedule, foundations with their concrete, and steel structures
 * with their survey and bolting. Safe to run twice — everything upserts, and the register
 * is only created if it is not already there.
 *
 * Every value here is DEMONSTRATION data. The coordinates are a round point
 * in the Asalouyeh area, not any real plant's survey origin, and must not be
 * copied into a real project.
 */
import "./env.mjs";
import { getDb } from "../lib/server/db.mjs";
import { withProject } from "../lib/db/scope.mjs";
import { updateProjectProfile, createUnit } from "../lib/db/repos/projects.mjs";
import { upsertContractor, upsertPackage } from "../lib/db/repos/contractors.mjs";
import { parseEquipmentList } from "../lib/equipment/parse.mjs";
import { importEquipmentList } from "../lib/db/repos/equipment.mjs";
import { upsertSubsystem, fileLine } from "../lib/db/repos/spine.mjs";
import { recordActivity } from "../lib/db/repos/activities.mjs";
import { createRun, saveRegister } from "../lib/db/repos/runs.mjs";
import { upsertWelder, addQualification, assignWeld, recordNdt } from "../lib/db/repos/execution.mjs";
import { recordSpoolActivity, upsertSupport, markSupport } from "../lib/db/repos/piping-execution.mjs";
import { upsertFoundation, recordPour, recordSpecimens } from "../lib/db/repos/civil.mjs";
import { upsertStructure, recordPlumbReading, recordBolting } from "../lib/db/repos/structural.mjs";
import { importCableSchedule, recordCableActivity, recordIrTest } from "../lib/db/repos/electrical.mjs";
import {
  importInstrumentIndex, correctInstrument, recordCalibration, recordInstrumentActivity, recordLoopCheck,
} from "../lib/db/repos/instrumentation.mjs";
import {
  upsertSystem, assignCoating, recordCoating, recordCoatingActivity,
} from "../lib/db/repos/coating.mjs";
import { minReadings } from "../lib/coating/coating.mjs";
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

// Units, and the one that sits on its own ground. The utilities and cooling
// water area is on a platform 1 m below the process area — the case a
// single project grade gets wrong. (Demonstration values.)
const UNITS = [
  ["11", "کراکینگ", undefined],
  ["12", "کوئنچ", undefined],
  ["21", "کمپرسور گاز شکسته", undefined],
  ["31", "بخش سرد و جداسازی", undefined],
  ["51", "تبرید", undefined],
  ["60", "یوتیلیتی و آب خنک", 99000],
];

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
    concrete_curing_days: 7,
    steel_erection_standard: "AISC303",
    // LV circuits at 400 V. The MV IR criterion is deliberately left for the
    // commissioning spec, so the demo shows an MV cable held without a verdict.
    lv_system_voltage_v: 400,
    calibration_tolerance_pct: 0.25,
  }});

  await withProject(db, p.id, async () => {
    // The earlier demo used a generic list; clear what this one replaces so
    // the screens show one coherent plant rather than two half-plants.
    const keep = parseEquipmentList(EQUIPMENT).tags.map((t) => t.tagNo);
    await db.query(
      "DELETE FROM tag WHERE project_id = $1 AND discipline = 'equipment' AND NOT (tag_no = ANY($2))",
      [p.id, keep]);

    const unit = {};
    for (const [code, name, grade] of UNITS) {
      unit[code] = await createUnit(db, { projectId: p.id, code, name, gradeElevationMm: grade });
    }

    const sub = {};
    for (const [code, name, seq, mc] of SUBSYSTEMS) {
      sub[code] = await upsertSubsystem(db, { projectId: p.id, code, name,
        unitId: unit[code.split("-")[0]]?.id || null, handoverSeq: seq, targetMcDate: mc });
    }

    const civil = await upsertContractor(db, { projectId: p.id, code: "C-01",
      name: "سازه پاد جنوب (نمایشی)", disciplines: ["civil", "structural"],
      contactName: "مهندس احمدی", prequalifiedUntil: "2028-04-30" });
    const mech = await upsertContractor(db, { projectId: p.id, code: "C-02",
      name: "نصب گستر پارس (نمایشی)", disciplines: ["piping", "equipment"],
      contactName: "مهندس رضایی", prequalifiedUntil: "2026-05-01" });
    const elec = await upsertContractor(db, { projectId: p.id, code: "C-03",
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
    // Its foundation step is civil's (FDN-K-2101 below), not a tick here.
    for (const [code, d, ref] of [["set", "2026-08-20", "SET-2101"],
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
    // ── civil: foundations, each showing one rule at work ──
    //
    //   FDN-K-2101   charge gas compressor: poured, cured, two samples for
    //                180 m³, accepted, handed over — so K-2101 can be set
    //   FDN-P-1203A  poured last week, only a 7-day break so far
    //   FDN-F-1101A  furnace: a C25 truck on a C30 foundation — held
    //   FDN-PR-01/02, FDN-P-1203B  three C30 tests each inside the individual
    //                band whose three-test average is under 30 — all held
    //   FDN-T-3102   demethanizer: rebar done, anchor bolts next
    const tagId = async (no) => (await db.query(
      "SELECT id FROM tag WHERE project_id = $1 AND tag_no = $2", [p.id, no])).rows[0]?.id || null;
    const ticks = async (fid, codes, when) => {
      for (const code of codes) {
        await recordActivity(db, { projectId: p.id, tagId: fid, code, doneAt: when, userId: user.id });
      }
    };
    // ── structural: registered before the foundations so FDN-PR-01/02 can
    //    carry the main rack ──
    //
    //   PR-2101  main pipe rack on FDN-PR-01/02 — waits on civil, whose C30
    //            class is under a low-strength investigation
    //   PR-1201  quench-area rack: plumb, fully bolted and grouted
    //   PL-2101  compressor platform: column C3 out of plumb (14 mm on a
    //            6 m column, 12 mm allowed) and one bolt lot short of Fp,C;
    //            no fireproofing required, so that step does not apply
    const STRUCTURES = [
      { no: "PR-2101", type: "pipe_rack", sub: "21-01", columns: 4, joints: 64, fp: true, t: 48,
        dwg: "ST-21-PR-001", desc: "Main pipe rack, compression" },
      { no: "PR-1201", type: "pipe_rack", sub: "12-01", columns: 6, joints: 48, fp: true, t: 62,
        dwg: "ST-12-PR-001", desc: "Pipe rack, quench area",
        manual: [["foundation", "2026-07-10"], ["erection", "2026-08-05"]],
        survey: [["A1", 7500, 4, -3], ["A2", 7500, 6, 2], ["A3", 7500, -5, 7], ["B1", 7500, 3, 3],
                 ["B2", 7500, -8, 1], ["B3", 7500, 2, -6]], surveyedOn: "2026-08-12",
        bolting: [{ jointType: "pretensioned", boltGrade: "A325M", boltSize: "M20",
          method: "calibrated_wrench", joints: 48, verifiedKn: 152, lotRef: "L-2208", inspectedOn: "2026-08-16" }],
        after: [["grout", "2026-08-20"]] },
      { no: "PL-2101", type: "platform", sub: "21-01", columns: 4, joints: 24, fp: false, t: 9,
        dwg: "ST-21-PL-004", desc: "K-2101 maintenance platform",
        manual: [["foundation", "2026-08-01"], ["erection", "2026-08-25"]],
        survey: [["C1", 6000, 5, 2], ["C2", 6000, -4, 6], ["C3", 6000, 14, 3], ["C4", 6000, 2, -2]],
        surveyedOn: "2026-09-02",
        bolting: [
          { jointType: "slip_critical", boltGrade: "8.8", boltSize: "M20", method: "torque",
            joints: 12, verifiedKn: 139, lotRef: "L-3301", inspectedOn: "2026-09-05" },
          { jointType: "slip_critical", boltGrade: "8.8", boltSize: "M20", method: "torque",
            joints: 12, verifiedKn: 131, lotRef: "L-3302", inspectedOn: "2026-09-06" }] },
    ];
    for (const st of STRUCTURES) {
      const t = await upsertStructure(db, { projectId: p.id, tagNo: st.no, structureType: st.type,
        subsystemId: sub[st.sub].id, description: st.desc, columns: st.columns, boltedJoints: st.joints,
        fireproofingRequired: st.fp, tonnageT: st.t, drawingRef: st.dwg });
      for (const [code, on] of st.manual || []) {
        await recordActivity(db, { projectId: p.id, tagId: t.id, code, doneAt: on, userId: user.id });
      }
      // Readings and bolting records are insert-only (a re-shoot is a new
      // row), so they are seeded once.
      const { rows: [n] } = await db.query(
        `SELECT (SELECT count(*) FROM plumb_reading WHERE tag_id = $1)::int
              + (SELECT count(*) FROM bolting_record WHERE tag_id = $1)::int AS n`, [t.id]);
      if (n.n === 0) {
        for (const [columnMark, heightMm, dxMm, dyMm] of st.survey || []) {
          await recordPlumbReading(db, { projectId: p.id, tagId: t.id, columnMark, heightMm, dxMm, dyMm,
            surveyedOn: st.surveyedOn, surveyor: "نقشه‌بردار نمایشی", userId: user.id });
        }
        for (const b of st.bolting || []) {
          await recordBolting(db, { projectId: p.id, tagId: t.id, ...b, userId: user.id });
        }
      }
      for (const [code, on] of st.after || []) {
        await recordActivity(db, { projectId: p.id, tagId: t.id, code, doneAt: on, userId: user.id });
      }
    }
    console.log(`structural: ${STRUCTURES.length} structures`);

    const TO_PRE = ["excavation", "blinding", "rebar", "embedments", "pre_pour"];
    const FOUNDATIONS = [
      { no: "FDN-K-2101", carries: "K-2101", cls: "C35", fc: 35, vol: 180, ab: "VND-K2101-AB-C",
        pre: "2026-06-18", pours: [["PC-2101", "2026-06-20", "C35", 35,
          [["S1", 28, [38.5, 39.5]], ["S2", 28, [37.0, 38.0]], ["S1", 7, [26.0, 27.0]]]]],
        after: ["backfill", "ready"], afterOn: "2026-07-25" },
      { no: "FDN-P-1203A", carries: "P-1203A", cls: "C30", fc: 30, vol: 12,
        pre: "2026-09-12", pours: [["PC-1203A", "2026-09-15", "C30", 30, [["S1", 7, [20.5, 21.5]]]]] },
      { no: "FDN-F-1101A", carries: "F-1101A", cls: "C30", fc: 30, vol: 95,
        pre: "2026-07-22", pours: [["PC-1101A", "2026-07-25", "C25", 25, [["S1", 28, [29.0, 30.0]]]]] },
      { no: "FDN-PR-01", carries: "PR-2101", cls: "C30", fc: 30, vol: 8,
        pre: "2026-06-29", pours: [["PC-PR01", "2026-07-01", "C30", 30, [["S1", 28, [28.5, 29.0]]]]] },
      { no: "FDN-PR-02", carries: "PR-2101", cls: "C30", fc: 30, vol: 8,
        pre: "2026-07-03", pours: [["PC-PR02", "2026-07-05", "C30", 30, [["S1", 28, [27.5, 28.5]]]]] },
      { no: "FDN-P-1203B", carries: "P-1203B", cls: "C30", fc: 30, vol: 12,
        pre: "2026-08-08", pours: [["PC-1203B", "2026-08-10", "C30", 30, [["S1", 28, [31.5, 32.5]]]]] },
      { no: "FDN-T-3102", carries: "T-3102", cls: "C35", fc: 35, vol: 210, upTo: ["excavation", "blinding", "rebar"],
        pre: "2026-09-10", pours: [] },
    ];
    for (const f of FOUNDATIONS) {
      const fdn = await upsertFoundation(db, { projectId: p.id, tagNo: f.no,
        carriesTagId: f.carries ? await tagId(f.carries) : null,
        concreteClass: f.cls, fcMpa: f.fc, volumeM3: f.vol, anchorBoltRef: f.ab || null,
        description: `فونداسیون ${f.carries}` });
      await ticks(fdn.id, f.upTo || TO_PRE, f.pre);
      for (const [pourNo, on, cls, fc, samples] of f.pours) {
        const pour = await recordPour(db, { projectId: p.id, tagId: fdn.id, pourNo, pouredOn: on,
          volumeM3: f.vol, concreteClass: cls, fcMpa: fc, contractorId: civil.id, userId: user.id });
        const { rows: [n] } = await db.query(
          "SELECT count(*)::int AS n FROM concrete_specimen WHERE pour_id = $1", [pour.id]);
        if (n.n === 0) {                       // specimens insert, so only once
          for (const [sampleNo, age, results] of samples) {
            await recordSpecimens(db, { projectId: p.id, pourId: pour.id, sampleNo,
              specimenType: "cyl150", ageDays: age, results, userId: user.id });
          }
        }
      }
      if (f.after) await ticks(fdn.id, f.after, f.afterOn);
    }
    console.log(`civil: ${FOUNDATIONS.length} foundations`);

    // ── electrical: a cable schedule, read by rule ──
    //
    //   EC-1203A-P   pump power: tested, continuity, ready to energise
    //   EC-1203A-C   pump control: one core at 0.6 MΩ — IR rejected
    //   EC-2101-P    compressor MV feeder: tested, but no MV criterion in
    //                the project spec yet — no verdict
    //   EC-LT-21     lighting panel: no tag of that number — for a person
    //   EC-9001      no voltage rating in the schedule — class unknown
    const SCHEDULE = [
      "Cable No,From,To,Cable Type,Voltage,Length (m)",
      "EC-1203A-P,MCC-12,P-1203A,3Cx35 XLPE/SWA/PVC,0.6/1kV,85",
      "EC-1203A-C,LCS-1203A,P-1203A,4x2.5 XLPE/SWA,0.6/1kV,30",
      "EC-1203B-P,MCC-12,P-1203B,3Cx35 XLPE/SWA/PVC,0.6/1kV,92",
      "EC-1204A-P,MCC-12,P-1204A,3Cx25 XLPE/SWA/PVC,0.6/1kV,70",
      "EC-2101-P,SWGR-21A,K-2101,3x1x240 XLPE/CWS,6/10kV,210",
      "EC-1104-P,SWGR-11A,FN-1104,3x1x185 XLPE/CWS,6/10kV,160",
      "EC-LT-21,DB-21,LP-21-04,4Cx16 XLPE/SWA,0.6/1kV,45",
      "EC-9001,UPS-1,JB-IS-07,2x2x1.5 armoured,,60",
    ].join("\n");
    const imp = await importCableSchedule(db, { projectId: p.id, text: SCHEDULE });
    const cable = async (no) => (await db.query(
      "SELECT id FROM cable WHERE project_id = $1 AND cable_no = $2", [p.id, no])).rows[0].id;
    const CABLE_WORK = [
      ["EC-1203A-P", ["route", "pulled", "terminated"], [[500, [">2000", ">2000", ">2000"]]], ["continuity", "ready"]],
      ["EC-1203A-C", ["route", "pulled", "terminated"], [[500, ["900", "900", "0.6", "900"]]], []],
      ["EC-1203B-P", ["route", "pulled"], [], []],
      ["EC-1204A-P", ["route"], [], []],
      ["EC-2101-P", ["route", "pulled", "terminated"], [[5000, ["25000", "31000", "28000"]]], []],
    ];
    for (const [no, before, tests, after] of CABLE_WORK) {
      const id = await cable(no);
      for (const code of before) {
        await recordCableActivity(db, { projectId: p.id, cableId: id, code, doneAt: "2026-09-10",
          contractorId: elec.id, userId: user.id });
      }
      const { rows: [n] } = await db.query("SELECT count(*)::int AS n FROM ir_test WHERE cable_id = $1", [id]);
      if (n.n === 0) {                         // tests insert, so only once
        for (const [v, readings] of tests) {
          await recordIrTest(db, { projectId: p.id, cableId: id, testVoltageV: v, readings,
            testedOn: "2026-09-12", instrumentRef: "MIT-1025 / CAL-0426", userId: user.id });
        }
      }
      for (const code of after) {
        await recordCableActivity(db, { projectId: p.id, cableId: id, code, doneAt: "2026-09-14",
          contractorId: elec.id, userId: user.id });
      }
    }
    console.log(`electrical: ${imp.imported} cables, ${imp.unmatched.length} without a tag, `
      + `${imp.problems.length} schedule problems`);

    // ── instrumentation: an index read by ISA 5.1 ──
    //
    //   loop P-1203A  PT + PI calibrated, installed, connected, loop-checked
    //   PSV-1203A     a person took it out of loop checks (no loop)
    //   FT-2101       its datasheet says ±0.1%; 0.3% at mid-span — rejected
    //   loop L-3102   level transmitter not yet wired — loop check waits
    //   PT-A12        a typo the ISA table cannot read — for a person
    const INDEX = [
      "Tag No,Service,Type,Range,Equipment,Tolerance",
      "PT-1203A,Quench oil pump discharge pressure,Smart transmitter,0-25 bar,P-1203A,",
      "PI-1203A,Quench oil pump discharge local,Bourdon gauge,0-25 bar,P-1203A,",
      "PSV-1203A,Quench oil pump casing relief,Safety valve,,P-1203A,",
      "FT-2101,Charge gas suction flow,Coriolis,0-60000 kg/h,K-2101,0.1",
      "TT-2101,Charge gas 1st stage discharge temperature,RTD transmitter,0-200 °C,K-2101,",
      "FV-2101,Anti-surge valve,Control valve,,K-2101,",
      "LT-3102,Demethanizer bottom level,Guided wave radar,0-100 %,T-3102,",
      "LG-3102,Demethanizer bottom level local,Magnetic gauge,0-100 %,T-3102,",
      "PT-A12,Unknown,Transmitter,0-10 bar,,",
    ].join("\n");
    const ii = await importInstrumentIndex(db, { projectId: p.id, text: INDEX });
    const inst = async (no) => (await db.query(
      "SELECT id FROM instrument WHERE project_id = $1 AND tag_no = $2", [p.id, no])).rows[0].id;
    await correctInstrument(db, { projectId: p.id, instrumentId: await inst("PSV-1203A"), loopNo: "" });
    const CAL = {
      "PT-1203A": "0:4.01 6.25:8.00 12.5:12.02 18.75:16.01 25:19.99",
      "PI-1203A": "0:0 6.25:6.3 12.5:12.5 18.75:18.7 25:25",
      "FT-2101": "0:4.00 15000:8.01 30000:12.05 45000:16.02 60000:20.00",
      "LT-3102": "0:4.00 25:8.00 50:12.01 75:16.00 100:20.01",
    };
    const INST_WORK = {
      "PT-1203A": ["installed", "hookup", "wired"], "PI-1203A": ["installed", "hookup", "wired"],
      "PSV-1203A": ["calibrated", "installed"], "FV-2101": ["calibrated"], "LT-3102": ["installed", "hookup"],
    };
    for (const [no, points] of Object.entries(CAL)) {
      const id = await inst(no);
      const { rows: [n] } = await db.query("SELECT count(*)::int AS n FROM calibration WHERE instrument_id = $1", [id]);
      if (n.n === 0) {
        await recordCalibration(db, { projectId: p.id, instrumentId: id, points, calibratedOn: "2026-08-25",
          calibratorRef: "Fluke 754 / CAL-0311", userId: user.id });
      }
    }
    for (const [no, codes] of Object.entries(INST_WORK)) {
      for (const code of codes) {
        await recordInstrumentActivity(db, { projectId: p.id, instrumentId: await inst(no), code,
          doneAt: "2026-09-08", contractorId: elec.id, userId: user.id });
      }
    }
    await recordLoopCheck(db, { projectId: p.id, loopNo: "P-1203A", checkedOn: "2026-09-15",
      refNo: "LC-12-0007", witnessedBy: "نمایندهٔ کارفرما", userId: user.id });
    for (const no of ["PT-1203A", "PI-1203A"]) {
      await recordInstrumentActivity(db, { projectId: p.id, instrumentId: await inst(no), code: "ready",
        doneAt: "2026-09-16", userId: user.id });
    }
    console.log(`instrumentation: ${ii.imported} instruments, ${ii.problems.length} index problems`);

    // ── painting and insulation ──
    //
    //   spool 1  PS-3 painted and handed over before its leak test — B31.3
    //            allows paint before the test, so it is not flagged
    //   spool 2  PS-HOT with 50 mm hot insulation — held until the test
    //   spool 3  primer applied with the steel 1 °C over the dew point
    //   PR-1201  prepared to St 3 where the system asks for Sa 2½
    const ps3 = await upsertSystem(db, { projectId: p.id, code: "PS-3", title: "Zinc epoxy / epoxy MIO / PU — atmospheric C5",
      prepGrade: "Sa 2½", profileMinUm: 50, profileMaxUm: 85, maxDftUm: 500,
      coats: [{ name: "Zinc-rich epoxy primer", ndftUm: 75 }, { name: "Epoxy MIO", ndftUm: 125 },
              { name: "Polyurethane finish", ndftUm: 50 }] });
    const psHot = await upsertSystem(db, { projectId: p.id, code: "PS-HOT", title: "Inorganic zinc under insulation, ≤ 400 °C",
      prepGrade: "Sa 2½", profileMinUm: 40, profileMaxUm: 75, maxDftUm: 150,
      coats: [{ name: "Inorganic zinc silicate", ndftUm: 75 }] });
    const { rows: cwSpools } = await db.query(
      `SELECT sp.id, sp.spool_no FROM spool sp JOIN document d ON d.project_id = sp.project_id
         JOIN extraction_run r ON r.id = sp.extraction_run_id AND r.document_id = d.id
        WHERE sp.project_id = $1 AND d.doc_no = 'SW 265022A' ORDER BY sp.spool_no`, [p.id]);
    const pr1201 = await tagId("PR-1201");
    if (cwSpools.length >= 3) {
      await assignCoating(db, { projectId: p.id, systemId: ps3.id, spoolIds: [cwSpools[0].id, cwSpools[2].id] });
      await assignCoating(db, { projectId: p.id, systemId: psHot.id, spoolIds: [cwSpools[1].id],
        insulation: "hot", insulationThkMm: 50 });
    }
    await assignCoating(db, { projectId: p.id, systemId: ps3.id, tagIds: [pr1201], areaM2: 310 });
    const item = async (col, id) => (await db.query(
      `SELECT id, area_m2 FROM coating_item WHERE project_id = $1 AND ${col} = $2`, [p.id, id])).rows[0];
    const gauge = (area, base) => Array.from({ length: minReadings(Number(area)) },
      (_, k) => base + ((k * 7) % 25)).join(" ");
    const good = { airC: 31, rh: 55, steelC: 34 };
    const WORK = cwSpools.length >= 3 ? [
      ["spool_id", cwSpools[0].id, [["prep", { grade: "Sa 2½", profile: "62 70 66" }],
        ["coat", { coatNo: 1, ...good, base: 80 }], ["coat", { coatNo: 2, ...good, base: 205 }],
        ["coat", { coatNo: 3, ...good, base: 255 }]], ["final_inspection", "ready"]],
      ["spool_id", cwSpools[1].id, [["prep", { grade: "Sa 2½", profile: "55 60" }],
        ["coat", { coatNo: 1, ...good, base: 80 }], ["insulation", { thicknessMm: "50 52 51 50" }]], ["final_inspection"]],
      ["spool_id", cwSpools[2].id, [["prep", { grade: "Sa 2½", profile: "64 72" }],
        ["coat", { coatNo: 1, airC: 31, rh: 88, steelC: 30, base: 80 }]], []],
    ] : [];
    WORK.push(["tag_id", pr1201, [["prep", { grade: "St 3", profile: "" }]], []]);
    for (const [col, id, records, marks] of WORK) {
      const it = await item(col, id);
      const { rows: [n] } = await db.query("SELECT count(*)::int AS n FROM coating_record WHERE item_id = $1", [it.id]);
      if (n.n === 0) {
        for (const [kind, d] of records) {
          const { base, ...rest } = d;
          await recordCoating(db, { projectId: p.id, itemId: it.id, kind, recordedOn: "2026-09-14",
            inspector: "بازرس رنگ نمایشی", userId: user.id,
            ...(base !== undefined ? { ...rest, readings: gauge(it.area_m2, base) } : rest) });
        }
      }
      for (const code of marks) {
        await recordCoatingActivity(db, { projectId: p.id, itemId: it.id, code, doneAt: "2026-09-18", userId: user.id });
      }
    }
    console.log(`coating: 2 systems, ${WORK.length} items`);

    // The cooling-water drawing belongs to the utilities unit, whose own grade
    // then applies to it — set on every run so an older demo database picks
    // it up too.
    await db.query("UPDATE document SET unit_id = $1 WHERE project_id = $2 AND doc_no = 'SW 265022A'",
      [unit["60"].id, p.id]);
  });
  console.log(`demo seeded into ${p.code}`);
} finally {
  await db.close();
}
