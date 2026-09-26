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
import { addBaseline, decideAssumption, listAssumptions } from "../lib/db/repos/assumptions.mjs";
import {
  upsertItem, receiveLot, inspectLot, reviewMtc, recordMovement, setRequirement,
} from "../lib/db/repos/warehouse.mjs";
import {
  recordManhours, reportIncident, updateIncident, requestPermit, recordGasTest, activatePermit, recordObservation,
  closeObservation,
} from "../lib/db/repos/hse.mjs";
import {
  upsertAccount, setBaseline, reportProgress, postCost, upsertRisk, closeRisk, listRisks,
} from "../lib/db/repos/controls.mjs";
import { raisePunch, punchAction, raiseNcr, ncrAction } from "../lib/db/repos/quality.mjs";
import * as insp from "../lib/db/repos/inspection.mjs";
import { upsertTemplate } from "../lib/db/repos/precom.mjs";
import { ensureUser } from "../lib/db/repos/projects.mjs";
import { upsertPipingClass } from "../lib/db/repos/piping-class.mjs";
import * as prc from "../lib/db/repos/procurement.mjs";
import * as dcr from "../lib/db/repos/doc-control.mjs";
import { setAssetMaster } from "../lib/db/repos/handover.mjs";
import * as mnt from "../lib/db/repos/maintenance.mjs";
import { upsertPackage as upsertTestPackage, addLines as addPackLines } from "../lib/db/repos/completions.mjs";
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

    // ── the master plan's baseline assumptions; the feed one approved ──
    await addBaseline(db, { projectId: p.id, userId: user.id });
    const feed = (await listAssumptions(db, { projectId: p.id })).find((a) => a.code === "A-003");
    if (feed.status === "proposed") {
      await decideAssumption(db, { projectId: p.id, assumptionId: feed.id, status: "approved", userId: user.id });
    }
    console.log("assumptions: master plan baseline");

    // ── warehouse: lots through MIR and MTC, issues to spools ──
    //
    //   H-77120  10" pipe, accepted, issued to spools 1 and 2 — then its MTC
    //            is rejected: the recall list names both spools
    //   H-88031  10" pipe, received, MIR pending — quarantine
    //   elbows   accepted but MTC not yet reviewed — not issuable
    //   cable    accepted on inspection alone (not heat-traceable)
    const ITEMS = [
      ["PIPE-10-S40-A106B", 'PIPE 10" SCH40 SMLS', "pipe", "m", "ASTM A106 Gr.B"],
      ["ELL90-10-S40-A234", 'ELBOW 90 LR 10" SCH40', "fitting", "EA", "ASTM A234 WPB"],
      ["FLG-WN-10-150", 'FLANGE WN 10" CL150 RF', "flange", "EA", "ASTM A105"],
      ["CBL-3C35-XLPE", "CABLE 3Cx35 XLPE/SWA 0.6/1kV", "cable", "m", null],
    ];
    const it = {};
    for (const [code, description, category, uom, spec] of ITEMS) {
      it[code] = await upsertItem(db, { projectId: p.id, code, description, category, uom, spec });
    }
    for (const [code, qty] of [["PIPE-10-S40-A106B", 180], ["ELL90-10-S40-A234", 24], ["FLG-WN-10-150", 16], ["CBL-3C35-XLPE", 900]]) {
      await setRequirement(db, { projectId: p.id, itemId: it[code].id, qty, source: "MTO-CW-930065 Rev.0" });
    }
    const { rows: [haveLots] } = await db.query("SELECT count(*)::int AS n FROM material_lot WHERE project_id = $1", [p.id]);
    if (haveLots.n === 0 && cwSpools.length >= 2) {
      const l1 = await receiveLot(db, { projectId: p.id, itemId: it["PIPE-10-S40-A106B"].id, receiptNo: "MRR-0012",
        poRef: "PO-P-0031", supplier: "Supplier A (demo)", receivedOn: "2026-08-02", heatNo: "H-77120",
        mtcRef: "MTC-77120", qtyReceived: 96, location: "Laydown L-3", userId: user.id });
      await inspectLot(db, { projectId: p.id, lotId: l1.id, qtyAccepted: 96, qtyRejected: 0, mirRef: "MIR-0012", inspectedOn: "2026-08-03" });
      await reviewMtc(db, { projectId: p.id, lotId: l1.id, mtcStatus: "accepted" });
      await recordMovement(db, { projectId: p.id, lotId: l1.id, kind: "issue", qty: 24, movedOn: "2026-08-05",
        refNo: "MIV-0101", spoolId: cwSpools[0].id, contractorId: mech.id, userId: user.id });
      await recordMovement(db, { projectId: p.id, lotId: l1.id, kind: "issue", qty: 18, movedOn: "2026-08-06",
        refNo: "MIV-0102", spoolId: cwSpools[1].id, contractorId: mech.id, userId: user.id });
      await reviewMtc(db, { projectId: p.id, lotId: l1.id, mtcStatus: "rejected" });   // chemistry out of spec, found late
      await receiveLot(db, { projectId: p.id, itemId: it["PIPE-10-S40-A106B"].id, receiptNo: "MRR-0019",
        poRef: "PO-P-0031", supplier: "Supplier A (demo)", receivedOn: "2026-09-20", heatNo: "H-88031",
        mtcRef: "MTC-88031", qtyReceived: 72, location: "Laydown L-3", userId: user.id });
      const l3 = await receiveLot(db, { projectId: p.id, itemId: it["ELL90-10-S40-A234"].id, receiptNo: "MRR-0015",
        poRef: "PO-P-0034", supplier: "Supplier B (demo)", receivedOn: "2026-08-20", heatNo: "E-5521",
        mtcRef: "MTC-5521", qtyReceived: 20, location: "Store S-1", userId: user.id });
      await inspectLot(db, { projectId: p.id, lotId: l3.id, qtyAccepted: 18, qtyRejected: 2, mirRef: "MIR-0015", inspectedOn: "2026-08-21" });
      const l4 = await receiveLot(db, { projectId: p.id, itemId: it["CBL-3C35-XLPE"].id, receiptNo: "MRR-0017",
        poRef: "PO-E-0007", supplier: "Supplier C (demo)", receivedOn: "2026-09-01", qtyReceived: 1000,
        location: "Cable yard", userId: user.id });
      await inspectLot(db, { projectId: p.id, lotId: l4.id, qtyAccepted: 1000, mirRef: "MIR-0017", inspectedOn: "2026-09-02" });
      await recordMovement(db, { projectId: p.id, lotId: l4.id, kind: "issue", qty: 115, movedOn: "2026-09-09",
        refNo: "MIV-0203", purpose: "EC-1203A-P", contractorId: elec.id, userId: user.id });
    }
    console.log("warehouse: 4 items, lots through MIR/MTC, one late-rejected heat");

    // ── HSE: hours, incidents as facts, permits around "now", observations ──
    //
    //   INC-0001  pinched finger, first an MTC, then two days off → LWC
    //   INC-0004  injury reported, treatment not yet known → no class
    //   HW-0099   yesterday's hot work, issued and never closed → expired
    //   HW-0101   hot work at F-1101A, gas test passed, issued
    //   CS-0102   firebox entry at F-1101A, no standby named → not issuable,
    //             and SIMOPS with HW-0101
    //
    // Gas limits are the demo's own figures, stated as a project would; the
    // engine has no defaults for them.
    await updateProjectProfile(db, { projectId: p.id, patch: {
      hse_o2_min_pct: 19.5, hse_o2_max_pct: 23.5, hse_lel_max_pct: 0, hse_h2s_max_ppm: 5, hse_co_max_ppm: 25,
      hse_gas_test_validity_min: 120, hse_permit_max_hours: 12 } });
    const day0 = new Date();
    for (let d = 30; d >= 1; d--) {
      const workDate = new Date(day0.getTime() - d * 86_400_000).toISOString().slice(0, 10);
      if (new Date(workDate).getUTCDay() === 5) continue;          // Friday off
      for (const [c, heads, h] of [[civil, 900, 10], [mech, 1400, 10], [elec, 350, 10], [null, 250, 9]]) {
        await recordManhours(db, { projectId: p.id, contractorId: c?.id || null, workDate, hours: heads * h, headcount: heads, userId: user.id });
      }
    }
    const ago = (days, hour = 9) => {
      const t = new Date(day0.getTime() - days * 86_400_000); t.setUTCHours(hour, 0, 0, 0); return t.toISOString();
    };
    const { rows: [haveInc] } = await db.query("SELECT count(*)::int AS n FROM hse_incident WHERE project_id = $1", [p.id]);
    if (haveInc.n === 0) {
      const i1 = await reportIncident(db, { projectId: p.id, refNo: "INC-0001", occurredAt: ago(21), area: "Pipe shop",
        contractorId: mech.id, description: "Fitter's finger pinched between flange faces during fit-up",
        injured: true, fatal: false, daysAway: 0, restrictedDays: 0, treatment: "medical", userId: user.id });
      await updateIncident(db, { projectId: p.id, incidentId: i1.id, patch: { daysAway: 2 },
        reason: "Clinic note: two days off work after the day of injury", userId: user.id });
      await reportIncident(db, { projectId: p.id, refNo: "INC-0002", occurredAt: ago(14), area: "FDN-PR-01",
        contractorId: civil.id, description: "Slip on formwork oil, grazed hand", injured: true, fatal: false,
        daysAway: 0, restrictedDays: 0, treatment: "first_aid", userId: user.id });
      await reportIncident(db, { projectId: p.id, refNo: "INC-0003", occurredAt: ago(9), area: "PR-1201",
        contractorId: mech.id, description: "Spanner dropped from rack level 2 into barricaded zone", injured: false,
        userId: user.id });
      await reportIncident(db, { projectId: p.id, refNo: "INC-0004", occurredAt: ago(1, 14), area: "Cable yard",
        contractorId: elec.id, description: "Back strain pulling cable drum", injured: true, fatal: false, userId: user.id });
    }
    const { rows: [havePtw] } = await db.query("SELECT count(*)::int AS n FROM hse_permit WHERE project_id = $1", [p.id]);
    if (havePtw.n === 0) {
      const at = (h) => new Date(day0.getTime() + h * 3_600_000).toISOString();
      const clean = { o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0, testerName: "Gas tester (demo)", instrument: "4-gas detector GD-07" };
      const old = await requestPermit(db, { projectId: p.id, permitNo: "HW-0099", type: "hot", area: "PR-1201",
        description: "Weld shoe supports on rack level 1", contractorId: mech.id, requesterName: "C-02 foreman",
        validFrom: at(-30), validTo: at(-20) });
      await recordGasTest(db, { projectId: p.id, permitId: old.id, testedAt: at(-30.2), ...clean, userId: user.id });
      await activatePermit(db, { projectId: p.id, permitId: old.id, userId: user.id, now: at(-29.9) });
      const hw = await requestPermit(db, { projectId: p.id, permitNo: "HW-0101", type: "hot", area: "F-1101A",
        description: "Grind and weld convection section access door hinges", contractorId: mech.id,
        requesterName: "C-02 foreman", validFrom: at(-1), validTo: at(7) });
      await recordGasTest(db, { projectId: p.id, permitId: hw.id, testedAt: at(-0.2), ...clean, userId: user.id });
      await activatePermit(db, { projectId: p.id, permitId: hw.id, userId: user.id });
      await requestPermit(db, { projectId: p.id, permitNo: "CS-0102", type: "confined_space", area: "F-1101A",
        description: "Firebox entry to inspect refractory anchors", contractorId: civil.id,
        requesterName: "C-01 supervisor", validFrom: at(2), validTo: at(10) });
      await requestPermit(db, { projectId: p.id, permitNo: "EI-0103", type: "electrical_isolation", area: "SS-01",
        description: "Terminate EC-1203A-P at MCC", contractorId: elec.id, requesterName: "C-03 electrician",
        validFrom: at(1), validTo: at(9), isolationRef: "LOTO-0045" });
    }
    const { rows: [haveObs] } = await db.query("SELECT count(*)::int AS n FROM hse_observation WHERE project_id = $1", [p.id]);
    if (haveObs.n === 0) {
      const d = (k) => new Date(day0.getTime() + k * 86_400_000).toISOString().slice(0, 10);
      await recordObservation(db, { projectId: p.id, observedOn: d(-8), kind: "unsafe_condition", severity: "high",
        area: "PR-1201", contractorId: mech.id, description: "Toe board missing on rack level 2 walkway",
        action: "Fit toe boards before any work above", dueOn: d(-6), userId: user.id });
      await recordObservation(db, { projectId: p.id, observedOn: d(-2), kind: "unsafe_act", severity: "medium",
        area: "Pipe shop", contractorId: mech.id, description: "Grinding without face shield",
        action: "Toolbox talk; face shields at every grinding station", dueOn: d(3), userId: user.id });
      const o3 = await recordObservation(db, { projectId: p.id, observedOn: d(-12), kind: "unsafe_condition", severity: "low",
        area: "FDN-PR-02", contractorId: civil.id, description: "Rebar ends without caps",
        action: "Cap all protruding rebar", dueOn: d(-10), userId: user.id });
      await closeObservation(db, { projectId: p.id, observationId: o3.id, closedOn: d(-11), note: "Caps fitted, checked by HSE" });
      await recordObservation(db, { projectId: p.id, observedOn: d(-5), kind: "good_practice", area: "PR-1201",
        contractorId: mech.id, description: "Radiography barricade and signage exemplary", userId: user.id });
    }
    console.log("hse: 30 days of hours, 4 incidents, 4 permits (one expired, one SIMOPS), 4 observations");

    // ── project controls: accounts, S-curves around today, cost, risks ──
    //
    //   civil and furnace mechanical: EV reported (progress report no.)
    //   CW piping, electrical, instruments: EV counted by the platform under
    //   a stated rule of credit (piping 70/30, E&I 60/40)
    //   one invoice reversed as a duplicate
    const dd = (k) => new Date(day0.getTime() + k * 86_400_000).toISOString().slice(0, 10);
    const scurve = (start, end) => {
      const span = end - start;
      return [[0, 0], [0.1, 3], [0.25, 12], [0.45, 35], [0.65, 62], [0.85, 88], [1, 100]]
        .map(([f, v]) => ({ date: dd(Math.round(start + f * span)), pct: v }));
    };
    const ACCOUNTS = [
      ["CA-10-CIV", "Civil works & foundations", civil, 95_000_000, "manual", null, null, -330, 180],
      ["CA-11-MEC", "Cracking furnaces — mechanical erection", mech, 180_000_000, "manual", null, null, -160, 330],
      ["CA-60-PIP", "Cooling water piping (U-60)", mech, 42_000_000, "platform", "piping", 70, -150, 150],
      ["CA-70-ELE", "Electrical installation", elec, 36_000_000, "platform", "electrical", 60, -200, 150],
      ["CA-80-INS", "Instrumentation", elec, 28_000_000, "platform", "instrumentation", 60, -190, 150],
    ];
    const acc = {};
    for (const [code, title, c, bac, evMethod, evDiscipline, credit, s0, s1] of ACCOUNTS) {
      acc[code] = await upsertAccount(db, { projectId: p.id, code, title, contractorId: c.id, bac, evMethod, evDiscipline,
        creditInstalledPct: credit });
      if (!acc[code].baseline_rev) {
        acc[code] = await setBaseline(db, { projectId: p.id, accountId: acc[code].id, points: scurve(s0, s1),
          revision: "0", reason: "Level-3 schedule, IFC issue", userId: user.id });
      }
    }
    const { rows: [haveCost] } = await db.query("SELECT count(*)::int AS n FROM cost_entry WHERE project_id = $1", [p.id]);
    if (haveCost.n === 0) {
      const COSTS = [
        ["CA-10-CIV", -300, 6_500_000, "INV-C01-001"], ["CA-10-CIV", -210, 14_200_000, "INV-C01-004"],
        ["CA-10-CIV", -120, 19_800_000, "INV-C01-007"], ["CA-10-CIV", -30, 16_400_000, "INV-C01-010"],
        ["CA-11-MEC", -130, 9_000_000, "INV-C02-002"], ["CA-11-MEC", -40, 27_500_000, "INV-C02-005"],
        ["CA-60-PIP", -90, 5_800_000, "INV-C02-003"], ["CA-60-PIP", -20, 8_300_000, "INV-C02-006"],
        ["CA-70-ELE", -120, 4_600_000, "INV-C03-001"], ["CA-70-ELE", -30, 8_900_000, "INV-C03-004"],
        ["CA-80-INS", -100, 3_700_000, "INV-C03-002"], ["CA-80-INS", -25, 6_600_000, "INV-C03-005"],
      ];
      for (const [code, k, amount, refNo] of COSTS) {
        await postCost(db, { projectId: p.id, accountId: acc[code].id, postedOn: dd(k), amount, refNo, userId: user.id });
      }
      await postCost(db, { projectId: p.id, accountId: acc["CA-11-MEC"].id, postedOn: dd(-10), amount: -2_500_000,
        refNo: "CN-C02-001", note: "INV-C02-005 line 4 billed twice (scaffolding)", userId: user.id });
      for (const [code, k, pct, source] of [["CA-10-CIV", -35, 58, "PR-W32"], ["CA-10-CIV", -7, 64, "PR-W36"],
        ["CA-11-MEC", -7, 18, "PR-W36"]]) {
        await reportProgress(db, { projectId: p.id, accountId: acc[code].id, asOf: dd(k), pct, source, userId: user.id });
      }
    }
    const RISKS = [
      ["R-01", "Late delivery of furnace radiant coils (centrifugally cast alloy, long lead)", "Procurement", "Procurement manager",
        "CA-11-MEC", 4, 5, "Expedite at foundry; weekly vendor inspection; re-sequence convection module erection", dd(-4), 3, 4],
      ["R-02", "Summer heat and dust storms cut productivity (Asalouyeh, Jun–Sep)", "Site", "Construction manager",
        null, 4, 3, "Night shift for heavy lifts and concrete pours; shaded rest areas", dd(40), 3, 2],
      ["R-03", "Charge gas compressor vendor data late — foundation design on hold", "Engineering", "Rotating equipment lead",
        "CA-10-CIV", 3, 4, null, null, null, null],
      ["R-04", "EUR/IRR movement on local purchases", "Commercial", "Project controls manager",
        null, 3, 3, "Price local packages in EUR where possible; monthly exposure report", dd(25), 2, 3],
      ["R-05", "Shortage of 6G GTAW-qualified welders for alloy piping", "Resources", "Welding coordinator",
        "CA-60-PIP", 3, 4, "Qualify 12 additional welders at site test shop", dd(-20), 1, 4],
    ];
    for (const [code, title, category, owner, a, P, I, response, dueOn, rp, ri] of RISKS) {
      await upsertRisk(db, { projectId: p.id, code, title, category, owner, accountId: a ? acc[a].id : null,
        probability: P, impact: I, response, dueOn, residualP: rp, residualI: ri });
    }
    const r5 = (await listRisks(db, { projectId: p.id, today: dd(0) })).find((r) => r.code === "R-05");
    if (r5.status === "open") await closeRisk(db, { projectId: p.id, riskId: r5.id, closedOn: dd(-18) });
    console.log("controls: 5 accounts (2 reported, 3 platform-counted), cost with one reversal, 5 risks");

    // ── punch and NCR ─────────────────────────────────────────────────────
    //
    // Two named site people who cannot log in: a walkdown needs a clearer
    // and a verifier who are not the same person, and the seeding account
    // is only one.
    const qcInsp = await ensureUser(db, { subject: "demo|qc-inspector", displayName: "بازرس QC (دمو)" });
    const supv = await ensureUser(db, { subject: "demo|c02-supervisor", displayName: "سرپرست C-02 (دمو)" });
    const tagOf = async (no) => (await db.query("SELECT id FROM tag WHERE project_id = $1 AND tag_no = $2", [p.id, no])).rows[0].id;
    const { rows: [havePunch] } = await db.query("SELECT count(*)::int AS n FROM punch_item WHERE project_id = $1", [p.id]);
    if (havePunch.n === 0) {
      const PUNCH = [
        // tag, cat, description, contractor, raised (days ago), due (days from now), then: clear? verify?
        ["K-2101", "A", "Lube oil console: flushing certificate missing", mech, -12, -2, false, false],
        ["K-2101", "A", "Coupling guard not installed (DE side)", mech, -12, 5, true, false],
        ["KT-2101", "B", "Insulation damaged at steam inlet flange", mech, -9, 10, false, false],
        ["V-2102", "C", "Nameplate paint overspray", mech, -9, 30, false, false],
        ["T-2103", "A", "Davit not load tested", mech, -20, -6, true, true],
        ["P-1203A", "A", "Baseplate grouting voids at anchor bolt 3", civil, -15, -1, false, false],
        ["P-1203B", "B", "Seal flush line support missing", mech, -15, 7, false, false],
        ["F-1101A", "A", "Burner BR-12 pilot line not connected", mech, -5, 12, false, false],
        ["F-1101A", "B", "Peep door gasket missing (arch level)", mech, -5, 20, true, false],
        ["P-6101A", "C", "Drain funnel to be relocated 150 mm", mech, -30, 15, true, true],
      ];
      for (const [no, cat, description, c, r, d, clear, verify] of PUNCH) {
        const item = await raisePunch(db, { projectId: p.id, tagId: await tagOf(no), category: cat, description,
          actionContractorId: c.id, raisedOn: dd(r), dueOn: dd(d), userId: qcInsp.id });
        if (clear) await punchAction(db, { projectId: p.id, punchId: item.id, action: "clear", note: "Done, see photo", onDate: dd(r + 3), userId: supv.id });
        if (verify) await punchAction(db, { projectId: p.id, punchId: item.id, action: "verify", onDate: dd(r + 4), userId: qcInsp.id });
      }
      const x = await raisePunch(db, { projectId: p.id, tagId: await tagOf("V-2104A"), category: "A",
        description: "Molecular sieve loading record not signed", actionContractorId: mech.id, raisedOn: dd(-4), userId: qcInsp.id });
      await punchAction(db, { projectId: p.id, punchId: x.id, action: "recategorise", category: "B",
        note: "Loading record is a pre-commissioning item per MC procedure §4.2", userId: user.id });
    }
    const { rows: [haveNcr] } = await db.query("SELECT count(*)::int AS n FROM ncr WHERE project_id = $1", [p.id]);
    if (haveNcr.n === 0) {
      const n1 = await raiseNcr(db, { projectId: p.id, title: "Anchor bolt projection short on K-2101 foundation",
        description: "4 of 16 bolts 12–18 mm short of the projection on the foundation drawing",
        requirement: "Foundation drawing 21-CV-DW-0104 note 6", source: "Survey before grouting", severity: "major",
        discipline: "civil", tagId: await tagOf("K-2101"), contractorId: civil.id, raisedOn: dd(-45), responseDue: dd(-35), userId: qcInsp.id });
      await ncrAction(db, { projectId: p.id, ncrId: n1.id, action: "propose", disposition: "repair",
        dispositionNote: "Coupler nuts per vendor-approved detail", userId: supv.id });
      await ncrAction(db, { projectId: p.id, ncrId: n1.id, action: "approve", userId: user.id, actorIsEngineer: true });
      await ncrAction(db, { projectId: p.id, ncrId: n1.id, action: "implement", note: "Couplers fitted, torque recorded",
        rootCause: "Template shifted during pour; no check after vibration", correctiveAction: "Template re-survey after vibration added to pour checklist",
        userId: supv.id });
      await ncrAction(db, { projectId: p.id, ncrId: n1.id, action: "close", userId: qcInsp.id });
      await raiseNcr(db, { projectId: p.id, title: "Wrong gasket material on quench oil pump suction",
        description: "SS316 spiral wound fitted; class sheet calls for inner ring 321", requirement: "Piping class DX01",
        source: "Walkdown", severity: "major", discipline: "piping", tagId: await tagOf("P-1203A"), contractorId: mech.id,
        raisedOn: dd(-28), responseDue: dd(-21), userId: qcInsp.id });
      const n3 = await raiseNcr(db, { projectId: p.id, title: "DFT below minimum on pipe rack PR-01 bay 4",
        description: "Readings 180–205 µm against 250 µm specified", requirement: "Painting spec, system C4-H",
        source: "Coating inspection", severity: "minor", discipline: "structural", subsystemId: sub["60-01"].id,
        contractorId: mech.id, raisedOn: dd(-10), responseDue: dd(4), userId: qcInsp.id });
      await ncrAction(db, { projectId: p.id, ncrId: n3.id, action: "propose", disposition: "rework",
        dispositionNote: "Apply an extra coat of topcoat after sweep blast", userId: supv.id });
    }
    console.log("quality: 11 punch items (one recategorised A→B), 3 NCRs (one closed, one overdue)");

    // ── completions: the cooling-water line's class and its test package ──
    //
    //   TP-60-001  hydrostatic, Rr 1.0 stated: the test pressure is known
    //              (1.5 × 10 × 1.0 = 15 barg), and the walkdown lists what
    //              holds it — welds, NDT, supports
    //   TP-60-002  an instrument-air header with no drawing yet and no Rr:
    //              no test pressure, and "unknown" rather than "nothing to do"
    const cw = await upsertPipingClass(db, { projectId: p.id, code: "A1CW", description: "Cooling water, CS, 150#",
      serviceCategory: "category_d", materialSpec: "A106 Gr.B", corrosionAllowMm: 3, designTempC: 65, designPressBarg: 10 });
    await db.query("UPDATE line SET piping_class_id = $2 WHERE project_id = $1 AND line_no = '28-CWR-10-930065A'", [p.id, cw.id]);
    const { rows: [cwLine] } = await db.query("SELECT id FROM line WHERE project_id = $1 AND line_no = '28-CWR-10-930065A'", [p.id]);
    const { rows: [iaLine] } = await db.query(
      `INSERT INTO line (project_id, line_no, service, piping_class) VALUES ($1,'2-IA-60-0012','Instrument air','A1CW')
       ON CONFLICT (project_id, line_no) DO UPDATE SET service = EXCLUDED.service RETURNING id`, [p.id]);
    await fileLine(db, { projectId: p.id, lineId: iaLine.id, subsystemId: sub["60-01"].id });
    const tp1 = await upsertTestPackage(db, { projectId: p.id, packNo: "TP-60-001", subsystemId: sub["60-01"].id,
      medium: "hydrostatic", stressRatio: 1, description: "Cooling water return, rack PR-01", userId: user.id });
    const tp2 = await upsertTestPackage(db, { projectId: p.id, packNo: "TP-60-002", subsystemId: sub["60-01"].id,
      medium: "hydrostatic", description: "Instrument air header", userId: user.id });
    const { rows: inPack } = await db.query("SELECT line_id FROM test_package_line WHERE project_id = $1", [p.id]);
    const packed = new Set(inPack.map((r) => r.line_id));
    if (!packed.has(cwLine.id)) await addPackLines(db, { projectId: p.id, packageId: tp1.id, lineIds: [cwLine.id] });
    if (!packed.has(iaLine.id)) await addPackLines(db, { projectId: p.id, packageId: tp2.id, lineIds: [iaLine.id] });
    console.log("completions: class A1CW (10 barg), TP-60-001 (15 barg, held by the walkdown), TP-60-002 (no Rr, no drawing)");

    // ── procurement: POs behind the warehouse receipts and the machines ──
    //
    //   PO-P-0031  10" pipe, 300 m: the two receipts already in the
    //              warehouse (96 + 72 m) are linked to it; 132 m still coming
    //   PO-E-0007  cable, fully received
    //   PO-M-0101  quench-oil pumps: ITP returned code 3 and not resubmitted,
    //              so no FAT; forecast after the site's need — float negative
    //   PO-M-0102  charge gas compressor: FAT passed, shipped, arrived
    //   PO-M-0103  propylene compressor: no need date — float unknown
    const { rows: [havePo] } = await db.query("SELECT count(*)::int AS n FROM purchase_order WHERE project_id = $1", [p.id]);
    if (havePo.n === 0) {
      const V = {};
      for (const [code, name, country] of [["V-PIPE", "Supplier A (demo)", "IR"], ["V-CBL", "Supplier C (demo)", "IR"],
        ["V-PUMP", "Pump vendor (demo)", "IT"], ["V-COMP", "Compressor vendor (demo)", "DE"]]) {
        V[code] = await prc.upsertVendor(db, { projectId: p.id, code, name, country });
      }
      const mkPo = (poNo, v, title, currency, placed) => prc.createPo(db, { projectId: p.id, poNo, vendorId: V[v].id, title,
        currency, placedOn: dd(placed), userId: user.id });
      const tagOf2 = async (no) => (await db.query("SELECT id FROM tag WHERE project_id = $1 AND tag_no = $2", [p.id, no])).rows[0].id;

      const poPipe = await mkPo("PO-P-0031", "V-PIPE", "Carbon steel pipe, CW system", "EUR", -120);
      const lPipe = await prc.addPoLine(db, { projectId: p.id, poId: poPipe.id, itemId: it["PIPE-10-S40-A106B"].id, qty: 300,
        unitPrice: 118, promisedOn: dd(-40), needOn: dd(10) });
      await prc.setForecast(db, { projectId: p.id, poLineId: lPipe.id, forecastOn: dd(12), source: "Mill schedule, week 38", userId: user.id });
      await db.query("UPDATE material_lot SET po_line_id = $2 WHERE project_id = $1 AND po_ref = 'PO-P-0031'", [p.id, lPipe.id]);

      const poCbl = await mkPo("PO-E-0007", "V-CBL", "LV power cable", "EUR", -90);
      const lCbl = await prc.addPoLine(db, { projectId: p.id, poId: poCbl.id, itemId: it["CBL-3C35-XLPE"].id, qty: 1000,
        promisedOn: dd(-30), needOn: dd(-10) });
      await db.query("UPDATE material_lot SET po_line_id = $2 WHERE project_id = $1 AND po_ref = 'PO-E-0007'", [p.id, lCbl.id]);

      const poPump = await mkPo("PO-M-0101", "V-PUMP", "Quench oil circulation pumps", "EUR", -200);
      const pumpLines = [];
      for (const no of ["P-1203A", "P-1203B"]) {
        pumpLines.push(await prc.addPoLine(db, { projectId: p.id, poId: poPump.id, tagId: await tagOf2(no), qty: 1,
          unitPrice: 412000, promisedOn: dd(-5), needOn: dd(10), fatRequired: true }));
      }
      for (const l of pumpLines) {
        await prc.setForecast(db, { projectId: p.id, poLineId: l.id, forecastOn: dd(6), source: "Vendor progress report #7", userId: user.id });
        await prc.setForecast(db, { projectId: p.id, poLineId: l.id, forecastOn: dd(20), source: "Casting re-poured after RT — expediting visit", userId: user.id });
      }
      const ds = await prc.addVendorDoc(db, { projectId: p.id, poId: poPump.id, docCode: "DS", title: "Pump datasheet", dueOn: dd(-150) });
      await prc.submitDoc(db, { projectId: p.id, docId: ds.id, revision: "0", submittedOn: dd(-155), userId: user.id });
      await prc.returnDoc(db, { projectId: p.id, docId: ds.id, returnedOn: dd(-140), code: 1 });
      const itp = await prc.addVendorDoc(db, { projectId: p.id, poId: poPump.id, docCode: "ITP", title: "Inspection and test plan (API 610 performance test)",
        dueOn: dd(-60), beforeFat: true });
      await prc.submitDoc(db, { projectId: p.id, docId: itp.id, revision: "A", submittedOn: dd(-50), userId: user.id });
      await prc.returnDoc(db, { projectId: p.id, docId: itp.id, returnedOn: dd(-35), code: 3, comment: "NPSH test and 4-hour mechanical run missing" });
      await prc.addVendorDoc(db, { projectId: p.id, poId: poPump.id, docCode: "IOM", title: "Installation, operation and maintenance manual", dueOn: dd(-3) });

      const poComp = await mkPo("PO-M-0102", "V-COMP", "Charge gas compressor train", "EUR", -400);
      const lComp = await prc.addPoLine(db, { projectId: p.id, poId: poComp.id, tagId: await tagOf2("K-2101"), qty: 1,
        promisedOn: dd(-60), needOn: dd(-45), fatRequired: true });
      const ga = await prc.addVendorDoc(db, { projectId: p.id, poId: poComp.id, docCode: "ITP", title: "Inspection and test plan", dueOn: dd(-300), beforeFat: true });
      await prc.submitDoc(db, { projectId: p.id, docId: ga.id, revision: "0", submittedOn: dd(-310), userId: user.id });
      await prc.returnDoc(db, { projectId: p.id, docId: ga.id, returnedOn: dd(-290), code: 2, comment: "Minor comments" });
      await prc.recordFat(db, { projectId: p.id, poLineId: lComp.id, inspectedOn: dd(-90), result: "pass", irnNo: "IRN-M-0102-01",
        inspector: "TPI (demo)", userId: user.id });
      const shp = await prc.createShipment(db, { projectId: p.id, shipmentNo: "BL-HAM-2026-0417", poId: poComp.id, mode: "sea",
        shippedOn: dd(-80), etaOn: dd(-50), lines: [{ poLineId: lComp.id, qty: 1 }], userId: user.id });
      await prc.arriveShipment(db, { projectId: p.id, shipmentId: shp.id, arrivedOn: dd(-48) });

      const poRef = await mkPo("PO-M-0103", "V-COMP", "Propylene refrigeration compressor", "EUR", -150);
      await prc.addPoLine(db, { projectId: p.id, poId: poRef.id, tagId: await tagOf2("K-5101"), qty: 1, promisedOn: dd(120), fatRequired: true });
    }
    console.log("procurement: 5 POs, pipe and cable receipts linked, pump ITP returned code 3, compressor arrived");

    // ── document control: the register the uploaded drawing is checked against ──
    //
    //   SW 265022A      the demo isometric: Rev 0 IFC two months ago, Rev 1
    //                   IFC five days ago — the saved weld register was
    //                   extracted from Rev 0, and the page says so
    //   60-PID-001      client approval required: IFA returned code 2, then IFC
    //   21-PID-001      IFA sent, the client's response is overdue
    //   11-GA-F1101A    vendor GA, planned IFC passed with nothing issued
    const { rows: [haveMdr] } = await db.query("SELECT count(*)::int AS n FROM mdr_document WHERE project_id = $1", [p.id]);
    if (haveMdr.n === 0) {
      const iso = await dcr.upsertMdr(db, { projectId: p.id, docNo: "SW 265022A", title: "Isometric — cooling water return 28\"",
        discipline: "piping", docType: "ISO", originator: "EPC", subsystemId: sub["60-01"].id, plannedIfcOn: dd(-70) });
      await dcr.issueRevision(db, { projectId: p.id, mdrId: iso.id, revision: "0", purpose: "IFC", issuedOn: dd(-60), userId: user.id });
      await dcr.issueRevision(db, { projectId: p.id, mdrId: iso.id, revision: "1", purpose: "IFC", issuedOn: dd(-5),
        note: "Support SH-0933 moved 600 mm; field weld FW-3 relocated", userId: user.id });

      const pid60 = await dcr.upsertMdr(db, { projectId: p.id, docNo: "60-PID-001", title: "P&ID — cooling water supply and return",
        discipline: "process", docType: "P&ID", originator: "EPC", subsystemId: sub["60-01"].id, approvalRequired: true, plannedIfcOn: dd(-90) });
      const rB = await dcr.issueRevision(db, { projectId: p.id, mdrId: pid60.id, revision: "B", purpose: "IFA", issuedOn: dd(-120), userId: user.id });
      const t1 = await dcr.createTransmittal(db, { projectId: p.id, transmittalNo: "TR-EPC-CL-0041", toParty: "Client",
        purpose: "approval", sentOn: dd(-119), responseDue: dd(-105), revisionIds: [rB.id], userId: user.id });
      const [i1] = (await dcr.transmittals(db, { projectId: p.id })).find((x) => x.id === t1.id).items;
      await dcr.recordReturn(db, { projectId: p.id, itemId: i1.id, code: 2, returnedOn: dd(-100), comment: "Add high-point vents" });
      await dcr.issueRevision(db, { projectId: p.id, mdrId: pid60.id, revision: "0", purpose: "IFC", issuedOn: dd(-85), userId: user.id });

      const pid21 = await dcr.upsertMdr(db, { projectId: p.id, docNo: "21-PID-001", title: "P&ID — charge gas compressor first stage",
        discipline: "process", docType: "P&ID", originator: "EPC", subsystemId: sub["21-01"].id, approvalRequired: true, plannedIfcOn: dd(-10) });
      const r21 = await dcr.issueRevision(db, { projectId: p.id, mdrId: pid21.id, revision: "A", purpose: "IFA", issuedOn: dd(-30), userId: user.id });
      await dcr.createTransmittal(db, { projectId: p.id, transmittalNo: "TR-EPC-CL-0057", toParty: "Client", purpose: "approval",
        sentOn: dd(-29), responseDue: dd(-15), revisionIds: [r21.id], userId: user.id });

      await dcr.upsertMdr(db, { projectId: p.id, docNo: "11-GA-F1101A", title: "General arrangement — cracking furnace F-1101A",
        discipline: "mechanical", docType: "GA", originator: "vendor", subsystemId: sub["11-01"].id, plannedIfcOn: dd(-20) });
    }
    console.log("documents: 4 in the register — the demo isometric superseded by Rev 1, one client response overdue");

    // ── handover to maintenance ───────────────────────────────────────────
    //
    //   The CMMS conventions are set only where the project has none, so an
    //   owner's own settings survive a re-seed.
    //   K-2101   complete nameplate, IOM accepted — held only by MC
    //   P-1203A  class and criticality, no serial yet, IOM not approved
    //   P-6101A  class only
    await db.query(
      `UPDATE project SET cmms_plant_code = COALESCE(cmms_plant_code, 'KPC-OLF'),
                          floc_template = COALESCE(floc_template, '{plant}-{unit}-{tag}'),
                          criticality_levels = COALESCE(criticality_levels, 'A, B, C')
        WHERE id = $1`, [p.id]);
    const { rows: [haveMaster] } = await db.query("SELECT count(*)::int AS n FROM asset_master WHERE project_id = $1", [p.id]);
    if (haveMaster.n === 0) {
      const tid = async (no) => (await db.query("SELECT id FROM tag WHERE project_id = $1 AND tag_no = $2", [p.id, no])).rows[0].id;
      await setAssetMaster(db, { projectId: p.id, tagId: await tid("K-2101"), isoClass: "CO", criticality: "A",
        criticalityBasis: "Criticality assessment CA-OLF-2026-03 (production loss, single train)", manufacturer: "Compressor vendor (demo)",
        model: "5-stage centrifugal, barrel", serialNo: "C-2101-0417", yearBuilt: 2026, userId: user.id });
      await setAssetMaster(db, { projectId: p.id, tagId: await tid("P-1203A"), isoClass: "PU", criticality: "A",
        criticalityBasis: "CA-OLF-2026-03", manufacturer: "Pump vendor (demo)", model: "API 610 OH2", userId: user.id });
      await setAssetMaster(db, { projectId: p.id, tagId: await tid("P-6101A"), isoClass: "PU", userId: user.id });
      const { rows: [po102] } = await db.query("SELECT id FROM purchase_order WHERE project_id = $1 AND po_no = 'PO-M-0102'", [p.id]);
      if (po102) {
        const d = await prc.addVendorDoc(db, { projectId: p.id, poId: po102.id, docCode: "IOM", title: "Operation and maintenance manual", dueOn: dd(-60) });
        await prc.submitDoc(db, { projectId: p.id, docId: d.id, revision: "0", submittedOn: dd(-70), userId: user.id });
        await prc.returnDoc(db, { projectId: p.id, docId: d.id, returnedOn: dd(-55), code: 1 });
      }
    }
    console.log("handover: FLOC {plant}-{unit}-{tag}, criticality A/B/C, 3 asset masters (K-2101 held only by MC)");

    // ── handover phase 2: the maintenance plan, spare parts, calibration ──
    //
    //   Intervals cite a (demo) source — the platform proposes none. Tasks
    //   are prepared by the QC inspector and approved by the admin; the seal
    //   inspection on P-1203A is left as a draft awaiting approval. The
    //   commissioning seal is short (nothing received); PI-1203A's monthly
    //   plan makes it overdue.
    const { rows: [havePm] } = await db.query("SELECT count(*)::int AS n FROM pm_task WHERE project_id = $1", [p.id]);
    if (havePm.n === 0) {
      const tid = async (no) => (await db.query("SELECT id FROM tag WHERE project_id = $1 AND tag_no = $2", [p.id, no])).rows[0]?.id;
      const task = async (tag, t, approve = true) => {
        const tagId = await tid(tag);
        if (!tagId) return;
        const row = await mnt.savePmTask(db, { projectId: p.id, tagId, ...t, userId: qcInsp.id });
        if (approve) await mnt.approvePmTask(db, { projectId: p.id, taskId: row.id, userId: user.id });
      };
      await task("K-2101", { taskCode: "PM-01", title: "Lube oil sample and analysis", strategy: "condition_based", intervalValue: 1, intervalUnit: "month",
        craft: "mechanical", durationH: 0.5, source: "oem", sourceRef: "Compressor IOM (demo) §8.3" });
      await task("K-2101", { taskCode: "PM-02", title: "Vibration route (bearings, casing)", strategy: "condition_based", intervalValue: 1, intervalUnit: "month",
        craft: "instrument", durationH: 1, source: "company", sourceRef: "ENG-STD-ROT-02 (demo) §4" });
      await task("K-2101", { taskCode: "PM-03", title: "Major overhaul", strategy: "time_based", intervalValue: 40000, intervalUnit: "run_hours",
        craft: "mechanical", durationH: 480, source: "oem", sourceRef: "Compressor IOM (demo) §9.1" });
      await task("P-1203A", { taskCode: "PM-01", title: "Bearing housing oil change", strategy: "time_based", intervalValue: 3, intervalUnit: "month",
        craft: "mechanical", durationH: 1, source: "oem", sourceRef: "Pump IOM (demo) §6.1" });
      await task("P-1203A", { taskCode: "PM-02", title: "Mechanical seal leak check", strategy: "condition_based", intervalValue: 1, intervalUnit: "week",
        craft: "operations", durationH: 0.2, source: "rcm", sourceRef: "RCM-OLF-12 (demo) row 7" }, false);
      const seal = await upsertItem(db, { projectId: p.id, code: "SEAL-OH2-65", description: "Mechanical seal cartridge, OH2 65 mm", category: "other", uom: "EA" });
      const spare = async (tag, s) => { const tagId = await tid(tag); if (tagId) await mnt.saveSpare(db, { projectId: p.id, tagId, ...s, userId: user.id }); };
      await spare("P-1203A", { partNo: "SC-65-OH2", manufacturer: "Seal vendor (demo)", description: "Mechanical seal cartridge", category: "commissioning",
        qtyInstalled: 1, qtyRecommended: 1, qtyApproved: 1, itemId: seal.id, spirRef: "SPIR-P-1203 (demo)" });
      await spare("P-1203A", { partNo: "SC-65-OH2", manufacturer: "Seal vendor (demo)", description: "Mechanical seal cartridge", category: "operational",
        qtyInstalled: 1, qtyRecommended: 2, qtyApproved: 1, itemId: seal.id, spirRef: "SPIR-P-1203 (demo)" });
      await spare("P-1203A", { partNo: "6310-C3", manufacturer: "SKF", description: "Radial bearing", category: "operational",
        qtyInstalled: 2, qtyRecommended: 4, qtyApproved: 2, spirRef: "SPIR-P-1203 (demo)" });
      await spare("P-1203B", { partNo: "SC-65-OH2", manufacturer: "Seal vendor (demo)", description: "Mechanical seal cartridge", category: "operational",
        qtyInstalled: 1, qtyRecommended: 2, qtyApproved: 1, itemId: seal.id, spirRef: "SPIR-P-1203 (demo)" });
      await spare("K-2101", { partNo: "DGS-2101", manufacturer: "Compressor vendor (demo)", description: "Dry gas seal, tandem", category: "capital",
        qtyInstalled: 2, qtyRecommended: 1, qtyApproved: 1, spirRef: "SPIR-K-2101 (demo)" });
      const iid = async (no) => (await db.query("SELECT id FROM instrument WHERE project_id = $1 AND tag_no = $2", [p.id, no])).rows[0]?.id;
      for (const [no, months, source, ref] of [["PT-1203A", 12, "company", "ENG-STD-INST-04 (demo) §3"], ["FT-2101", 6, "statutory", "Custody transfer rule (demo)"],
        ["LT-3102", 12, "company", "ENG-STD-INST-04 (demo) §3"], ["PI-1203A", 1, "company", "ENG-STD-INST-04 (demo) §5 — local gauges on quench oil"],
        ["PSV-1203A", 24, "statutory", "Pressure equipment inspection rule (demo)"]]) {
        const id = await iid(no);
        if (id) await mnt.setCalibrationPlan(db, { projectId: p.id, instrumentId: id, intervalMonths: months, source, sourceRef: ref, userId: user.id });
      }
    }
    console.log("maintenance: PM plan on K-2101 and P-1203A (one draft), SPIR with a short commissioning seal, 5 calibration plans (PI-1203A overdue)");

    // ── inspection ────────────────────────────────────────────────────────
    //
    //   ITP-CIV-001  foundations: rebar (W company), pre-pour (H contractor
    //                and company, W TPI), delivery tickets (R), backfill (S)
    //   ITP-PIP-001  spools: fit-up (W company), supports (W company)
    //   FDN-P-1203A  pre-pour released last week (TPI absent after 48 h notice)
    //   FDN-T-3102   rebar done — pre-pour requested for tomorrow morning
    //   spool 3      fit-up rejected (gap over tolerance), NCR raised,
    //                re-inspection requested
    //   spool 2      fit-up requested for this afternoon
    //
    //   The seeding account signs for the contractor; a company inspector
    //   and a TPI who cannot log in sign the rest.
    await db.query("UPDATE project SET inspection_notice_hours = COALESCE(inspection_notice_hours, 24) WHERE id = $1", [p.id]);
    const coInsp = await ensureUser(db, { subject: "demo|company-inspector", displayName: "بازرس کارفرما (دمو)" });
    const tpiInsp = await ensureUser(db, { subject: "demo|tpi-inspector", displayName: "بازرس TPI (دمو)" });
    for (const [u, role, party] of [[user, null, "contractor"], [qcInsp, "qc", "contractor"], [coInsp, "qc", "company"], [tpiInsp, "qc", "tpi"]]) {
      if (role) await db.query(`INSERT INTO project_member (project_id, user_id, role) VALUES ($1,$2,$3)
                                ON CONFLICT (project_id, user_id) DO NOTHING`, [p.id, u.id, role]);
      await db.query("UPDATE project_member SET inspection_party = COALESCE(inspection_party, $3) WHERE project_id = $1 AND user_id = $2",
        [p.id, u.id, party]);
    }
    const { rows: [haveItp] } = await db.query("SELECT count(*)::int AS n FROM itp WHERE project_id = $1", [p.id]);
    if (haveItp.n === 0) {
      const civ = await insp.createItp(db, { projectId: p.id, itpNo: "ITP-CIV-001", revision: "0", title: "Foundations — reinforced concrete",
        scope: "foundation", userId: qcInsp.id });
      for (const a of [
        { seq: 10, title: "Excavation and formation level", stepCode: "excavation", reference: "Spec CV-01 §5", criteria: "level ±25 mm, no soft spots",
          record: "ITR-C-01", points: { contractor: "H", company: "S" } },
        { seq: 20, title: "Reinforcement and formwork", stepCode: "rebar", reference: "ACI 318 §26.6 · drawing", criteria: "bar size, spacing, laps, cover",
          record: "ITR-C-02", points: { contractor: "H", company: "W" } },
        { seq: 30, title: "Pre-pour inspection (embedments, anchor bolts, cover)", stepCode: "pre_pour", reference: "ACI 318 §26.5 · vendor AB template",
          criteria: "anchor bolts ±3 mm, projection per drawing, cover blocks in place", record: "ITR-C-03", points: { contractor: "H", company: "H", tpi: "W" } },
        { seq: 40, title: "Concrete delivery tickets and slump", reference: "ASTM C143", criteria: "slump per mix design", record: "Delivery tickets",
          points: { contractor: "H", company: "R" } },
        { seq: 50, title: "Backfill and compaction", stepCode: "backfill", reference: "Spec CV-01 §9", criteria: "95 % MDD", record: "ITR-C-05",
          points: { contractor: "H", company: "S" } },
      ]) await insp.saveActivity(db, { projectId: p.id, itpId: civ.id, ...a });
      await insp.approveItp(db, { projectId: p.id, itpId: civ.id, userId: user.id, onDate: dd(-60) });
      const pip = await insp.createItp(db, { projectId: p.id, itpNo: "ITP-PIP-001", revision: "0", title: "Piping — spool fabrication and erection",
        scope: "piping_spool", userId: qcInsp.id });
      for (const a of [
        { seq: 10, title: "Fit-up (gap, alignment, bevel)", stepCode: "fit_up", reference: "ASME B31.3 §328.4", criteria: "root gap per WPS, hi-lo ≤ 1.5 mm",
          record: "ITR-P-01", points: { contractor: "H", company: "W" } },
        { seq: 20, title: "Visual inspection of welds", reference: "ASME B31.3 §341.4", criteria: "Table 341.3.2", record: "ITR-P-02",
          points: { contractor: "H", company: "S" } },
        { seq: 30, title: "Permanent supports", stepCode: "supports", reference: "Support drawings", criteria: "type and location per drawing",
          record: "ITR-P-05", points: { contractor: "H", company: "W" } },
      ]) await insp.saveActivity(db, { projectId: p.id, itpId: pip.id, ...a });
      await insp.approveItp(db, { projectId: p.id, itpId: pip.id, userId: user.id, onDate: dd(-60) });

      const acts = await insp.listItps(db, { projectId: p.id });
      const act = (no, seq) => acts.find((i) => i.itp_no === no).activities.find((a) => a.seq === seq).id;
      const contractor = { inspection_party: "contractor" };
      const at = (days, hour) => { const d = new Date(Date.now() + days * 86_400_000); d.setHours(hour, 0, 0, 0); return d; };
      const sign = (irId, m, outcome, when, extra = {}) =>
        insp.recordResult(db, { projectId: p.id, irId, outcome, membership: { inspection_party: m.party }, userId: m.id, now: when, ...extra });
      const CON = { id: qcInsp.id, party: "contractor" }, CO = { id: coInsp.id, party: "company" };

      const f1203 = await tagId("FDN-P-1203A");
      const done = await insp.raiseIr(db, { projectId: p.id, activityId: act("ITP-CIV-001", 30), itemKind: "tag", itemId: f1203,
        plannedAt: at(-13, 9), location: "Unit 12, pump row", membership: contractor, userId: qcInsp.id, now: at(-15, 9) });
      await sign(done.id, CON, "accepted", at(-13, 9));
      await sign(done.id, CON, "not_attended", at(-13, 10), { aboutParty: "tpi" });
      await sign(done.id, CO, "accepted_comments", at(-13, 10), { comments: "Cover 45 mm at the north face — within tolerance", inspectorName: "M. Rahimi" });

      const t3102 = await tagId("FDN-T-3102");
      await insp.raiseIr(db, { projectId: p.id, activityId: act("ITP-CIV-001", 30), itemKind: "tag", itemId: t3102,
        plannedAt: at(1, 9), location: "Unit 31, demethanizer", note: "Pour planned for the afternoon if released",
        membership: contractor, userId: qcInsp.id, now: at(-1, 8) });

      const { rows: spoolsNow } = await db.query("SELECT id FROM spool WHERE project_id = $1 ORDER BY spool_no", [p.id]);
      if (spoolsNow[2]) {
        const rej = await insp.raiseIr(db, { projectId: p.id, activityId: act("ITP-PIP-001", 10), itemKind: "spool", itemId: spoolsNow[2].id,
          plannedAt: at(-2, 10), location: "Fabrication shop bay 2", membership: contractor, userId: qcInsp.id, now: at(-4, 10) });
        await sign(rej.id, CO, "rejected", at(-2, 11), { comments: "Root gap 4.5 mm at joint 3, WPS allows 2–3 mm", inspectorName: "M. Rahimi" });
        await insp.ncrFromIr(db, { projectId: p.id, irId: rej.id, severity: "minor", userId: qcInsp.id, raiseNcr });
        await insp.raiseIr(db, { projectId: p.id, activityId: act("ITP-PIP-001", 10), itemKind: "spool", itemId: spoolsNow[2].id,
          plannedAt: at(1, 14), location: "Fabrication shop bay 2", reinspectionOf: rej.id, membership: contractor, userId: qcInsp.id, now: at(-1, 9) });
      }
      if (spoolsNow[1]) {
        await insp.raiseIr(db, { projectId: p.id, activityId: act("ITP-PIP-001", 10), itemKind: "spool", itemId: spoolsNow[1].id,
          plannedAt: at(0, 23), location: "Fabrication shop bay 1", membership: contractor, userId: qcInsp.id, now: at(-1, 15) });
      }
    }
    console.log("inspection: 2 ITPs, 24 h notice; pre-pour released on FDN-P-1203A, requested on FDN-T-3102; a rejected fit-up with its NCR and re-inspection");

    //   Material receiving under its own ITP. Lots already through MIR stay
    //   as they were (inspected before this ITP was in force); the pipe that
    //   arrived on MRR-0019 has not been, so accepting it now waits on its IR.
    const { rows: [haveMat] } = await db.query("SELECT count(*)::int AS n FROM itp WHERE project_id = $1 AND itp_no = 'ITP-MAT-001'", [p.id]);
    if (haveMat.n === 0) {
      const mat = await insp.createItp(db, { projectId: p.id, itpNo: "ITP-MAT-001", revision: "0",
        title: "Material receiving — piping and electrical bulk", scope: "material", userId: qcInsp.id });
      for (const a of [
        { seq: 10, title: "Visual, dimensional and quantity check against PO and packing list", stepCode: "mir",
          reference: "PO · MSS SP-25 marking", criteria: "quantity per packing list, no damage, markings legible", record: "MIR",
          points: { contractor: "H", company: "W" } },
        { seq: 20, title: "MTC review: chemistry and mechanicals against the material spec, heat traceability", stepCode: "mtc_review",
          reference: "EN 10204 3.1 · ASTM material spec", criteria: "within spec; heat on MTC = heat stencilled on the material",
          record: "MTC review sheet", points: { contractor: "H", company: "R" } },
        { seq: 30, title: "PMI of alloy materials", reference: "API RP 578", criteria: "alloying elements per spec",
          record: "PMI report", points: { contractor: "H", company: "W" } },
      ]) await insp.saveActivity(db, { projectId: p.id, itpId: mat.id, ...a });
      await insp.approveItp(db, { projectId: p.id, itpId: mat.id, userId: user.id, onDate: dd(-10) });
      const { rows: [lot19] } = await db.query("SELECT id FROM material_lot WHERE project_id = $1 AND receipt_no = 'MRR-0019'", [p.id]);
      if (lot19) {
        const [matItp] = (await insp.listItps(db, { projectId: p.id })).filter((i) => i.itp_no === "ITP-MAT-001");
        const when = (days, hour) => { const d = new Date(Date.now() + days * 86_400_000); d.setHours(hour, 0, 0, 0); return d; };
        await insp.raiseIr(db, { projectId: p.id, activityId: matItp.activities.find((a) => a.seq === 10).id, itemKind: "lot", itemId: lot19.id,
          plannedAt: when(1, 8), location: "Laydown L-3", membership: { inspection_party: "contractor" }, userId: qcInsp.id, now: when(-1, 8) });
      }
    }
    console.log("inspection: material receiving ITP; MRR-0019 waits on its receipt inspection");

    // ── pre-commissioning checklists ──────────────────────────────────────
    //
    //   Declared from the (demo) commissioning procedure. No subsystem has an
    //   accepted MC yet, so nothing is recorded against them: the RFSU board
    //   shows every subsystem waiting on MC, which is where the plant is.
    for (const t of [
      { code: "B-SYS-01", title: "Flushing and air blowing", appliesTo: "subsystem", criteria: "Target plate clean after 3 blows (procedure CP-03 §4)" },
      { code: "B-PIP-01", title: "Reinstatement after test (blinds out, gaskets per class)", appliesTo: "line", criteria: "Blind list closed out" },
      { code: "B-MEC-01", title: "Motor solo run", appliesTo: "rotating", criteria: "4 h; vibration per vendor limit; direction checked" },
      { code: "B-MEC-02", title: "Internal inspection and box-up", appliesTo: "static", criteria: "Internals per GA, clean, witnessed closure" },
      { code: "B-ELE-01", title: "Energisation check", appliesTo: "cable", criteria: "Protection settings applied, phase rotation" },
      { code: "B-INS-01", title: "Loop function test with DCS", appliesTo: "loop", criteria: "Alarms and trips at set points, graphics tag correct" },
    ]) await upsertTemplate(db, { projectId: p.id, ...t });
    console.log("pre-commissioning: 6 checklists declared; nothing recorded until a subsystem's MC is accepted");

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
