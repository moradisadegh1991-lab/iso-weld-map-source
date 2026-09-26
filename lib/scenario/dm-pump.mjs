/**
 * A whole job, start to finish, on one small system: a DM-water transfer
 * pump P-7001 that sends demineralised water to drum D-7002 — from the day
 * the designer's documents reach site to the day the system is ready for
 * start-up and handed to maintenance.
 *
 * One list of steps is used three ways, so they cannot drift apart:
 *   - the guide a person follows in the platform (docs/digital-epc/
 *     03-scenario-dm-pump.md, written from this file by
 *     `npm run scenario:dm -- --doc`);
 *   - the auto-play that brings a project to any step, so a person can jump
 *     to a stage and look (`npm run scenario:dm -- you@… --upto 7.3`);
 *   - the test that plays every step and every refusal on an empty
 *     database (db/test/scenario-dm.mjs).
 *
 * Each step says who does it, where in the platform, what to enter, and
 * what the platform must then show. The «آزمون منفی» steps are the gates:
 * the step tries something the platform must refuse, and the refusal —
 * with its reason — is the expected result.
 *
 * Every value is scenario data, not any real plant's.
 */
import { updateProjectProfile, createUnit, setInspectionParty } from "../db/repos/projects.mjs";
import { upsertContractor, upsertPackage } from "../db/repos/contractors.mjs";
import { parseEquipmentList } from "../equipment/parse.mjs";
import { importEquipmentList } from "../db/repos/equipment.mjs";
import { upsertSubsystem } from "../db/repos/spine.mjs";
import * as dcr from "../db/repos/doc-control.mjs";
import * as incoming from "../db/repos/incoming.mjs";
import * as tender from "../db/repos/tender.mjs";
import * as prc from "../db/repos/procurement.mjs";
import * as wh from "../db/repos/warehouse.mjs";
import { upsertFoundation, recordPour, recordSpecimens } from "../db/repos/civil.mjs";
import { recordActivity, tagStatus } from "../db/repos/activities.mjs";
import * as insp from "../db/repos/inspection.mjs";
import { upsertPipingClass } from "../db/repos/piping-class.mjs";
import { registerDocument } from "../db/repos/documents.mjs";
import { createRun, saveRegister, approveRun } from "../db/repos/runs.mjs";
import { lineForRegister, tieInRefsOf } from "../db/repos/spine.mjs";
import { buildModel } from "../engine.js";
import { upsertWelder, addQualification, assignWeld, recordNdt } from "../db/repos/execution.mjs";
import { recordSpoolActivity, upsertSupport, markSupport, spoolStatus } from "../db/repos/piping-execution.mjs";
import { requestPermit, recordGasTest, activatePermit, closePermit } from "../db/repos/hse.mjs";
import { upsertSystem, assignCoating, recordCoating, recordCoatingActivity } from "../db/repos/coating.mjs";
import { minReadings } from "../coating/coating.mjs";
import { importCableSchedule, recordCableActivity, recordIrTest, cableStatus } from "../db/repos/electrical.mjs";
import { importInstrumentIndex, recordCalibration, recordInstrumentActivity, recordLoopCheck } from "../db/repos/instrumentation.mjs";
import { raisePunch, punchAction } from "../db/repos/quality.mjs";
import * as precom from "../db/repos/precom.mjs";
import { setAssetMaster, addDcsPoint, datasheetRevisions, exportHandover } from "../db/repos/handover.mjs";
import * as mnt from "../db/repos/maintenance.mjs";
import * as pf from "../db/repos/performance.mjs";
import { subsystemMc, signMc, acceptMc } from "../db/repos/completions.mjs";
import { upsertPackage as upsertTestPackage, addLines as addPackLines, recordTest as recordPressureTest, acceptTest as acceptPressureTest }
  from "../db/repos/completions.mjs";

export const SCENARIO = {
  code: "DMW",
  name: "سناریوی آزمون — انتقال آب DM به درام (P-7001 → D-7002)",
  unit: { code: "70", name: "آب دمین (DM Water)" },
  subsystem: { code: "70-01", system: "70", name: "انتقال آب DM به درام", mcDate: 120 },
};

/**
 * The people. The platform will not let the one who signs also accept, so
 * the scenario needs three: the EPC's project engineer (you, the admin),
 * the EPC's QC inspector, and the client's representative who accepts.
 */
export const PEOPLE = {
  pm:     { key: "pm", title: "مهندس پروژهٔ EPC (شما — مدیر پروژه)", role: "admin", party: "contractor" },
  qc:     { key: "qc", title: "بازرس QC پیمانکار", role: "qc", party: "contractor", email: "qc.dmw@scenario.test", name: "بازرس QC (سناریو)" },
  client: { key: "client", title: "نمایندهٔ کارفرما", role: "engineer", party: "company", email: "client.dmw@scenario.test", name: "نمایندهٔ کارفرما (سناریو)" },
};

export const PHASES = [
  ["0", "آماده‌سازی پروژه"],
  ["1", "مدارک طراح: از ترانسمیتال ورودی تا IFC"],
  ["2", "خرید: پمپ از مناقصه تا سایت، لوله تا انبار"],
  ["3", "سیویل: فونداسیون پمپ و درام"],
  ["4", "نصب تجهیزات و نقطهٔ توقف ITP"],
  ["5", "پایپینگ: ایزومتریک تا تست فشار"],
  ["6", "رنگ، برق و ابزار دقیق"],
  ["7", "آمادگی تجهیزات، پانچ و تکمیل مکانیکی (MC)"],
  ["8", "پیش‌راه‌اندازی، RFC، راه‌اندازی و RFSU"],
  ["9", "تحویل به نگهداری و آزمون عملکرد"],
];

const EQUIPMENT_LIST = `Tag No,Description,Type,Subsystem,Unit
P-7001,DM Water Transfer Pump,Centrifugal,70-01,70
D-7002,DM Water Drum,Horizontal,70-01,70`;

const DOCS = [
  // [doc no, title, discipline, type, tag, approval required]
  ["DMW-PID-7001", "P&ID — DM water transfer to drum", "process", "P&ID", null, true],
  ["DMW-DS-P-7001", "Datasheet — DM water transfer pump P-7001", "mechanical", "DS", "P-7001", true],
  ["DMW-DS-D-7002", "Datasheet — DM water drum D-7002", "mechanical", "DS", "D-7002", true],
  ["DMW-ISO-7001", "Isometric — 70-DMW-7001 pump discharge to drum", "piping", "ISO", null, false],
];

/**
 * The isometric of line 70-DMW-7001, as it would be read off the drawing:
 * pump discharge nozzle up, across the rack, down to the drum's inlet
 * nozzle. Pasted as JSON on the piping page it gives 6 welds (3 shop, 3
 * field) in 2 spools.
 */
export const ISO_7001 = {
  meta: { drawingNo: "DMW-ISO-7001", rev: "0", sheet: "1/1", lineNo: "70-DMW-7001", unit: "70", pipingClass: "A1DM",
    nps: 3, schedule: "SCH 40", testFluid: "H (Hydrostatic)", testPressureBarg: 24, insulation: "N", heatTrace: "NONE",
    pipeSpec: "ASTM A106 Gr.B SMLS, BE, SCH 40", fittingSpec: "ASTM A234 WPB, BW, B16.9, SCH 40" },
  bom: [
    { pt: 1, group: "PIPE", description: "Pipe 3\" SCH40 SMLS A106 Gr.B", diam: 3, stockCode: "PIPE-3-S40-A106B", qty: 11.8 },
    { pt: 2, group: "FITTINGS", description: "Elbow 90 LR 3\" SCH40 A234 WPB", diam: 3, stockCode: "ELL90-3-S40", qty: 2 },
  ],
  nodes: [
    { id: "N1", type: "tie-in", ref: "P-7001 discharge N2", E: 10000, N: 20000, EL: 100600 },
    { id: "N2", type: "elbow90", ref: "", E: 10000, N: 20000, EL: 103500 },
    { id: "N3", type: "elbow90", ref: "", E: 10000, N: 28000, EL: 103500 },
    { id: "N4", type: "tie-in", ref: "D-7002 inlet N1", E: 10000, N: 28000, EL: 102200 },
  ],
  edges: [{ from: "N1", to: "N2", nps: 3 }, { from: "N2", to: "N3", nps: 3 }, { from: "N3", to: "N4", nps: 3 }],
  notes: ["Hydrotest per test pack TP-70-01."],
};

/**
 * The steps. `run(x)` does what the step says, through the same functions
 * the platform's forms call; `x` carries the database, the project, the
 * people, the scenario calendar (x.d(n) is day n of the job) and what
 * earlier steps made (x.ids).
 */
export const STEPS = [
  // ── 0 ─────────────────────────────────────────────────────────────────
  {
    id: "0.1", phase: "0", who: "pm", title: "ساخت پروژه، واحد، ساب‌سیستم و افراد",
    where: "با اسکریپت: npm run scenario:dm -- <ایمیل شما>",
    do: [
      "پروژهٔ DMW ساخته می‌شود و شما مدیر آن هستید؛ واحد 70 و ساب‌سیستم 70-01 «انتقال آب DM به درام».",
      "دو حساب دیگر ساخته و رمزشان یک بار چاپ می‌شود: بازرس QC پیمانکار و نمایندهٔ کارفرما (پذیرندهٔ امضاها).",
      "سه پیمانکار با پکیج‌هایشان: C-CIV (سیویل)، C-MEC (مکانیک، پایپینگ و رنگ) و C-EI (برق و ابزار دقیق).",
    ],
    expect: [
      "در نوار بالا پروژهٔ «DMW» را انتخاب کنید؛ پروژه › سیستم و ساب‌سیستم: 70-01 دیده می‌شود.",
      "پروژه › فرضیات و اطلاعات ناقص: فهرست بلندی از «اطلاعات ناقص» — هنوز هیچ مشخصاتی ثبت نشده.",
    ],
    baseline: true,
    run: async (x) => {
      const unit = await createUnit(x.db, { projectId: x.P, code: SCENARIO.unit.code, name: SCENARIO.unit.name });
      x.ids.unit = unit.id;
      const s = SCENARIO.subsystem;
      x.ids.sub = (await upsertSubsystem(x.db, { projectId: x.P, code: s.code, systemCode: s.system, name: s.name,
        unitId: unit.id, handoverSeq: 1, targetMcDate: x.d(s.mcDate) })).id;
      x.ids.cCiv = (await upsertContractor(x.db, { projectId: x.P, code: "C-CIV", name: "پیمانکار سیویل (سناریو)",
        disciplines: ["civil"], prequalifiedUntil: x.d(400) })).id;
      x.ids.cMec = (await upsertContractor(x.db, { projectId: x.P, code: "C-MEC", name: "پیمانکار مکانیک و پایپینگ (سناریو)",
        disciplines: ["piping", "equipment", "coating"], prequalifiedUntil: x.d(400) })).id;
      x.ids.cEi = (await upsertContractor(x.db, { projectId: x.P, code: "C-EI", name: "پیمانکار برق و ابزار دقیق (سناریو)",
        disciplines: ["electrical", "instrumentation"], prequalifiedUntil: x.d(400) })).id;
      for (const [c, code, d] of [["cCiv", "PKG-70-CIV", "civil"], ["cMec", "PKG-70-PIP", "piping"], ["cMec", "PKG-70-EQP", "equipment"],
        ["cEi", "PKG-70-ELE", "electrical"], ["cEi", "PKG-70-INS", "instrumentation"]]) {
        await upsertPackage(x.db, { projectId: x.P, contractorId: x.ids[c], code, discipline: d, subsystemId: x.ids.sub });
      }
      for (const p of Object.values(PEOPLE)) {
        if (x.users[p.key]) await setInspectionParty(x.db, { projectId: x.P, userId: x.users[p.key], party: p.party });
      }
    },
  },
  {
    id: "0.2", phase: "0", who: "pm", title: "ثبت مشخصات پروژه — هر عددی که موتورها با آن حکم می‌دهند",
    where: "پروژه › مشخصات پروژه (تب «مشخصات و قواعد پروژه») › ذخیره",
    do: [
      "ارز قرارداد: EUR · تراز گرید: 100000 mm · حداقل پوشش خاک: 800 mm",
      "بتن: مدت عمل‌آوری 7 روز · برق: ولتاژ LV 400 V · ابزار دقیق: تلورانس کالیبراسیون 0.25 %",
      "بازرسی: پیش‌آگهی 24 ساعت · رنگ: حداکثر رطوبت 85 %",
      "HSE: O₂ بین 19.5 و 23.5 %، LEL حداکثر 10 %، H₂S حداکثر 10 ppm، CO حداکثر 25 ppm، اعتبار تست گاز 120 دقیقه، حداکثر مجوز 12 ساعت؛ فاصلهٔ بازرسی داربست 7 روز، جرثقیل 30 روز، حداکثر ریسک باقیماندهٔ JSA: 8",
      "کیفیت: تشدید NCR پس از 14 روز · مدارک: مهلت بررسی 10 روز، ارسال مجدد VDRL 14 روز",
      "تحویل: کد پلنت CMMS «DMW»، قالب مکان عملیاتی «{plant}-{unit}-{tag}»، سطوح بحرانیت A,B,C",
    ],
    expect: [
      "فرضیات و اطلاعات ناقص: بیشتر ردیف‌ها رفته‌اند. آنچه می‌ماند (مثلاً معیار IR ولتاژ متوسط) در این سناریو لازم نیست.",
    ],
    baseline: false,
    run: async (x) => {
      await updateProjectProfile(x.db, { projectId: x.P, patch: {
        name: SCENARIO.name, contract_currency: "EUR", contract_value: 4200000,
        grade_elevation_mm: 100000, min_cover_mm: 800, concrete_curing_days: 7,
        lv_system_voltage_v: 400, calibration_tolerance_pct: 0.25, inspection_notice_hours: 24, coating_max_rh_pct: 85,
        hse_o2_min_pct: 19.5, hse_o2_max_pct: 23.5, hse_lel_max_pct: 10, hse_h2s_max_ppm: 10, hse_co_max_ppm: 25,
        hse_gas_test_validity_min: 120, hse_permit_max_hours: 12, hse_scaffold_inspection_days: 7,
        hse_crane_inspection_days: 30, hse_risk_max_residual: 8, ncr_escalation_days: 14,
        doc_review_days: 10, vdrl_resubmit_days: 14,
        cmms_plant_code: "DMW", floc_template: "{plant}-{unit}-{tag}", criticality_levels: "A,B,C",
      } });
    },
  },
  {
    id: "0.3", phase: "0", who: "pm", title: "فهرست تجهیزات: پمپ و درام",
    where: "اجرا › تجهیزات، رنگ و عایق › تب «تجهیزات» › ورود لیست تجهیزات (فایل CSV)",
    do: [
      "فایلی با این محتوا بسازید و وارد کنید (ستون‌ها: Tag No, Description, Type, Subsystem, Unit):",
      "P-7001, DM Water Transfer Pump, Centrifugal, 70-01, 70",
      "D-7002, DM Water Drum, Horizontal, 70-01, 70",
    ],
    expect: [
      "دو تگ ساخته می‌شود؛ P-7001 «تجهیز دوّار» و D-7002 «تجهیز ثابت» — نوع از شرح تشخیص داده می‌شود، نه انتخاب.",
      "در زنجیرهٔ P-7001 اولین کار «فونداسیون و بولت» است و هنوز هیچ مرحله‌ای ممکن نیست.",
    ],
    run: async (x) => {
      const parsed = parseEquipmentList(EQUIPMENT_LIST);
      await importEquipmentList(x.db, { projectId: x.P, tags: parsed.tags, userId: x.users.pm });
      const { rows } = await x.db.query("SELECT id, tag_no, kind FROM tag WHERE project_id = $1 AND tag_no = ANY($2)", [x.P, ["P-7001", "D-7002"]]);
      for (const r of rows) x.ids[r.tag_no] = r.id;
      x.check(rows.find((r) => r.tag_no === "P-7001")?.kind === "rotating", "P-7001 is rotating equipment");
      x.check(rows.find((r) => r.tag_no === "D-7002")?.kind === "static", "D-7002 is static equipment");
    },
  },

  // ── 1 ─────────────────────────────────────────────────────────────────
  {
    id: "1.1", phase: "1", who: "pm", title: "رجیستر مدارک (MDR) برای این سیستم",
    where: "مدیریت پروژه › مدارک › رجیستر مدارک (MDR) › «+ مدرک جدید در رجیستر»",
    do: DOCS.map(([no, title, disc, type, tag, appr]) =>
      `${no} — ${title} · رشته ${disc} · نوع ${type}${tag ? ` · تگ ${tag}` : ""}${appr ? " · «تأیید کارفرما پیش از IFC لازم است» را تیک بزنید" : ""}`),
    expect: ["چهار ردیف در رجیستر، همه بدون رویژن جاری و «رویژن ساخت: ندارد»."],
    run: async (x) => {
      for (const [docNo, title, discipline, docType, tag, approvalRequired] of DOCS) {
        const d = await dcr.upsertMdr(x.db, { projectId: x.P, docNo, title, discipline, docType, originator: "Designer",
          subsystemId: x.ids.sub, tagId: tag ? x.ids[tag] : null, approvalRequired, plannedIfcOn: x.d(30) });
        x.ids[docNo] = d.id;
      }
    },
  },
  {
    id: "1.2", phase: "1", who: "pm", title: "ترانسمیتال ورودی طراح: DES-TR-7001 برای بررسی (IFR)",
    where: "مدیریت پروژه › مدارک › تب «ترانسمیتال‌های ورودی از طراح» › «+ ثبت ترانسمیتال ورودی»",
    do: [
      "شماره DES-TR-7001 · فرستنده «Designer» · هدف «برای بررسی» · تاریخ ارسال: روز 1 · تاریخ دریافت: روز 2",
      "ردیف‌ها: DMW-PID-7001 Rev.A (IFR)، DMW-DS-P-7001 Rev.A (IFR)، DMW-DS-D-7002 Rev.A (IFR) — فایل PDF هر رویژن را پیوست کنید (بدون فایل هم ثبت می‌شود، با برچسب «بدون فایل»)",
    ],
    expect: [
      "ترانسمیتال با «مهلت پاسخ» = تاریخ دریافت + 10 روز (از مشخصات پروژه) ثبت می‌شود.",
      "در رجیستر، رویژن جاری هر سه مدرک Rev.A · IFR است.",
    ],
    run: async (x) => {
      const t = await incoming.registerIncoming(x.db, { projectId: x.P, transmittalNo: "DES-TR-7001", fromParty: "Designer",
        sentOn: x.d(1), receivedOn: x.d(2), purpose: "review", userId: x.users.pm,
        items: ["DMW-PID-7001", "DMW-DS-P-7001", "DMW-DS-D-7002"].map((docNo) => ({ docNo, revision: "A", purpose: "IFR" })) });
      x.ids.tr1 = t.transmittal?.id ?? t.id;
      x.ids.tr1Items = await itemsOf(x, x.ids.tr1);
    },
  },
  {
    id: "1.3", phase: "1", who: "pm", title: "توزیع بین رشته‌ها و کامنت روی دیتاشیت پمپ",
    where: "مدارک › ترانسمیتال‌های ورودی › DES-TR-7001 › هر ردیف: توزیع (IDC) و کامنت",
    do: [
      "DMW-DS-P-7001: توزیع به «mechanical» و «electrical»؛ کامنت مکانیک: «NPSHr at rated flow missing; state it on the curve».",
      "بررسی هر دو رشته را «پایان» بزنید.",
      "P&ID و دیتاشیت درام: توزیع به «process» و پایان بدون کامنت.",
    ],
    expect: ["روی دیتاشیت پمپ یک کامنت باز دیده می‌شود."],
    run: async (x) => {
      const it = x.ids.tr1Items;
      const pumpItem = it["DMW-DS-P-7001"];
      const reviews = await incoming.assignReview(x.db, { projectId: x.P, itemId: pumpItem, disciplines: ["mechanical", "electrical"], userId: x.users.pm });
      x.ids.cNpsh = (await incoming.raiseComment(x.db, { projectId: x.P, itemId: pumpItem, discipline: "mechanical",
        ref: "Sec. 4", text: "NPSHr at rated flow missing; state it on the curve", userId: x.users.pm })).id;
      for (const r of reviews) await incoming.finishReview(x.db, { projectId: x.P, reviewId: r.id, userId: x.users.pm });
      for (const no of ["DMW-PID-7001", "DMW-DS-D-7002"]) {
        const [r] = await incoming.assignReview(x.db, { projectId: x.P, itemId: it[no], disciplines: ["process"], userId: x.users.pm });
        await incoming.finishReview(x.db, { projectId: x.P, reviewId: r.id, userId: x.users.pm });
      }
    },
  },
  {
    id: "1.4", phase: "1", who: "pm", title: "آزمون منفی: کد ۱ برای مدرکی که کامنت باز دارد",
    where: "مدارک › ترانسمیتال‌های ورودی › DES-TR-7001 › «پاسخ به DES-TR-7001»",
    do: ["برای DMW-DS-P-7001 کد 1 (تأیید بدون کامنت) بدهید."],
    expect: ["رد می‌شود: «۱ کامنت باز روی این مدرک هست — کد ۱ یعنی بدون کامنت؛ کد ۲ بدهید یا کامنت‌ها را ببندید»."],
    negative: true,
    run: async (x) => {
      await x.refused(() => incoming.sendReply(x.db, { projectId: x.P, incomingId: x.ids.tr1, replyNo: "EPC-RT-7001", sentOn: x.d(8),
        codes: [{ itemId: x.ids.tr1Items["DMW-DS-P-7001"], code: 1 }], userId: x.users.pm }), /کامنت باز/);
    },
  },
  {
    id: "1.5", phase: "1", who: "pm", title: "پاسخ به طراح: EPC-RT-7001",
    where: "همان‌جا › «پاسخ به DES-TR-7001»",
    do: ["P&ID: کد 1 · دیتاشیت درام: کد 1 · دیتاشیت پمپ: کد 2 (تأیید با کامنت) · تاریخ: روز 8"],
    expect: ["ترانسمیتال پاسخ ثبت می‌شود؛ کامنت دیتاشیت پمپ همچنان باز است و با مدرک به رویژن بعد می‌رود."],
    run: async (x) => {
      const it = x.ids.tr1Items;
      await incoming.sendReply(x.db, { projectId: x.P, incomingId: x.ids.tr1, replyNo: "EPC-RT-7001", sentOn: x.d(8), userId: x.users.pm,
        codes: [{ itemId: it["DMW-PID-7001"], code: 1 }, { itemId: it["DMW-DS-D-7002"], code: 1 }, { itemId: it["DMW-DS-P-7001"], code: 2 }] });
    },
  },
  {
    id: "1.6", phase: "1", who: "pm", title: "طراح رویژن 0 را برای ساخت (IFC) می‌فرستد: DES-TR-7002",
    where: "مدارک › ترانسمیتال‌های ورودی › «+ ثبت ترانسمیتال ورودی»",
    do: [
      "DES-TR-7002 · هدف «برای ساخت» · ارسال روز 14 · دریافت روز 15",
      "ردیف‌ها: هر چهار مدرک (P&ID، دو دیتاشیت، ایزومتریک DMW-ISO-7001) Rev.0 با هدف IFC",
      "پس از ثبت: کامنت NPSHr را با پاسخ طراح «NPSHr 2.1 m added to curve, Rev.0» ببندید؛ سپس به هر چهار ردیف کد 1 بدهید (پاسخ EPC-RT-7002، روز 18).",
    ],
    expect: [
      "رجیستر: هر چهار مدرک «رویژن ساخت: Rev.0» دارند — مجوز ساخت از همین‌جاست.",
      "شیت پاسخ کامنت (CRS) دیتاشیت پمپ: یک ردیف، بسته روی Rev.0.",
    ],
    run: async (x) => {
      const t = await incoming.registerIncoming(x.db, { projectId: x.P, transmittalNo: "DES-TR-7002", fromParty: "Designer",
        sentOn: x.d(14), receivedOn: x.d(15), purpose: "construction", userId: x.users.pm,
        items: DOCS.map(([docNo]) => ({ docNo, revision: "0", purpose: "IFC" })) });
      x.ids.tr2 = t.transmittal?.id ?? t.id;
      const it = await itemsOf(x, x.ids.tr2);
      await incoming.closeComment(x.db, { projectId: x.P, commentId: x.ids.cNpsh, designerReply: "NPSHr 2.1 m added to curve, Rev.0",
        onItemId: it["DMW-DS-P-7001"], userId: x.users.pm });
      await incoming.sendReply(x.db, { projectId: x.P, incomingId: x.ids.tr2, replyNo: "EPC-RT-7002", sentOn: x.d(18), userId: x.users.pm,
        codes: Object.values(it).map((itemId) => ({ itemId, code: 1 })) });
      const board = await dcr.registerBoard(x.db, { projectId: x.P });
      const ours = board.documents.filter((d) => DOCS.some(([no]) => no === d.doc_no));
      x.check(ours.length === 4 && ours.every((d) => d.construction?.revision === "0"), "all four documents are IFC Rev.0");
    },
  },

  // ── 2 ─────────────────────────────────────────────────────────────────
  {
    id: "2.1", phase: "2", who: "pm", title: "درخواست خرید پمپ (MR) و صدور برای استعلام",
    where: "مدیریت پروژه › خرید و انبار › تب «خرید و پیگیری» › تب «درخواست خرید و مناقصه» › «+ درخواست خرید جدید»",
    do: [
      "MR-7001 · عنوان «DM water transfer pump» · رشته mechanical",
      "ردیف: تگ P-7001 · مقدار 1 · نیاز سایت: روز 70 · «FAT لازم است» را تیک بزنید",
      "صدور با دلیل «برای استعلام».",
    ],
    expect: ["MR-7001 Rev 0 صادر شده؛ ستون FAT ردیف «لازم»."],
    run: async (x) => {
      const mr = await tender.createMr(x.db, { projectId: x.P, mrNo: "MR-7001", title: "DM water transfer pump", discipline: "mechanical", userId: x.users.pm });
      x.ids.mr = mr.id;
      await tender.addMrLine(x.db, { projectId: x.P, mrId: mr.id, tagId: x.ids["P-7001"], qty: 1, needOn: x.d(70), fatRequired: true });
      await tender.issueMr(x.db, { projectId: x.P, mrId: mr.id, reason: "برای استعلام", userId: x.users.pm });
    },
  },
  {
    id: "2.2", phase: "2", who: "pm", title: "دو پیشنهاد و ارزیابی فنی",
    where: "همان MR › «ثبت پیشنهاد» (دو بار) و ارزیابی فنی هر پیشنهاد",
    do: [
      "فروشندهٔ V-PMP-A «Pump Maker A»: 38,000 EUR · تحویل 10 هفته · اعتبار تا یک سال بعد · فنی: قابل‌قبول",
      "فروشندهٔ V-PMP-B «Pump Maker B»: 41,500 EUR · تحویل 8 هفته · اعتبار تا یک سال بعد · فنی: قابل‌قبول",
      "(فروشنده‌ها را در صفحهٔ خرید با «PO یا فروشندهٔ جدید» بسازید.)",
    ],
    expect: ["جدول مناقصه: هر دو قابل ارزیابی؛ V-PMP-A کمترین قیمت است."],
    run: async (x) => {
      for (const [code, name, price, weeks] of [["V-PMP-A", "Pump Maker A", 38000, 10], ["V-PMP-B", "Pump Maker B", 41500, 8]]) {
        const v = await prc.upsertVendor(x.db, { projectId: x.P, code, name, country: "DE" });
        x.ids[code] = v.id;
        const b = await tender.recordBid(x.db, { projectId: x.P, mrId: x.ids.mr, vendorId: v.id, bidRef: `${code}-Q1`, receivedOn: x.d(20),
          validUntil: x.d(500), currency: "EUR", totalPrice: price, deliveryWeeks: weeks, userId: x.users.pm });
        x.ids[`bid-${code}`] = b.id;
        await tender.evaluateBid(x.db, { projectId: x.P, bidId: b.id, techStatus: "acceptable", userId: x.users.pm });
      }
    },
  },
  {
    id: "2.3", phase: "2", who: "pm", title: "آزمون منفی: واگذاری به پیشنهاد گران‌تر بدون دلیل",
    where: "همان MR › «واگذاری و صدور PO»",
    do: ["پیشنهاد V-PMP-B را بدون نوشتن دلیل انتخاب کنید (PO-7001)."],
    expect: ["رد می‌شود: «این پیشنهاد کمترین قیمت نیست — دلیل انتخاب را بنویسید»."],
    negative: true,
    run: async (x) => {
      await x.refused(() => tender.awardMr(x.db, { projectId: x.P, mrId: x.ids.mr, bidId: x.ids["bid-V-PMP-B"], poNo: "PO-7001",
        placedOn: x.d(25), userId: x.users.pm }), /کمترین قیمت نیست/);
    },
  },
  {
    id: "2.4", phase: "2", who: "pm", title: "واگذاری به کمترین قیمت و صدور PO-7001",
    where: "همان‌جا",
    do: ["پیشنهاد V-PMP-A · PO-7001 · تاریخ روز 25"],
    expect: ["PO-7001 در «خرید و پیگیری» با ردیف P-7001، «FAT لازم» (منتقل‌شده از MR)."],
    run: async (x) => {
      const { po } = await tender.awardMr(x.db, { projectId: x.P, mrId: x.ids.mr, bidId: x.ids["bid-V-PMP-A"], poNo: "PO-7001",
        placedOn: x.d(25), userId: x.users.pm });
      x.ids.po = po.id;
      const { rows: [l] } = await x.db.query("SELECT id, fat_required FROM po_line WHERE po_id = $1", [po.id]);
      x.ids.poLine = l.id;
      x.check(l.fat_required === true, "the PO line made by the award requires FAT, as the MR line said");
    },
  },
  {
    id: "2.5", phase: "2", who: "pm", title: "مدارک فروشنده (VDRL): GA و منحنی عملکرد پیش از FAT",
    where: "خرید و پیگیری › PO-7001 › «جزئیات» › مدارک فروشنده",
    do: [
      "VD-01 «General arrangement drawing» · «پیش از FAT لازم است» · مهلت روز 40",
      "VD-02 «Performance curve & FAT procedure» · «پیش از FAT لازم است» · مهلت روز 40",
      "ارسال فروشنده: هر دو Rev.A در روز 35",
    ],
    expect: ["هر دو «در حال بررسی»."],
    run: async (x) => {
      for (const [code, title] of [["VD-01", "General arrangement drawing"], ["VD-02", "Performance curve & FAT procedure"]]) {
        const d = await prc.addVendorDoc(x.db, { projectId: x.P, poId: x.ids.po, docCode: code, title, dueOn: x.d(40), beforeFat: true });
        x.ids[code] = d.id;
        await prc.submitDoc(x.db, { projectId: x.P, docId: d.id, revision: "A", submittedOn: x.d(35), userId: x.users.pm });
      }
    },
  },
  {
    id: "2.6", phase: "2", who: "qc", title: "آزمون منفی: FAT پیش از تأیید مدارک فروشنده",
    where: "خرید و پیگیری › PO-7001 › ردیف P-7001 › «FAT»",
    do: ["نتیجه «قبول» با IRN-7001 در روز 45 ثبت کنید."],
    expect: ["رد می‌شود: «مدارک پیش از FAT تأیید نشده: VD-01، VD-02»."],
    negative: true,
    run: async (x) => {
      await x.refused(() => prc.recordFat(x.db, { projectId: x.P, poLineId: x.ids.poLine, inspectedOn: x.d(45), result: "pass",
        irnNo: "IRN-7001", userId: x.users.qc }), /مدارک پیش از FAT تأیید نشده/);
    },
  },
  {
    id: "2.7", phase: "2", who: "pm", title: "بررسی مدارک فروشنده و FAT",
    where: "PO-7001 › مدارک فروشنده › برگشت با کد؛ سپس ردیف P-7001 › FAT",
    do: [
      "VD-01 و VD-02: کد 1 (بدون کامنت) در روز 40.",
      "FAT (بازرس QC): «قبول» · IRN-7001 · روز 45 · بازرس «TPI inspector»",
    ],
    expect: ["ردیف P-7001: FAT قبول · IRN-7001؛ مرحله «آمادهٔ حمل»."],
    run: async (x) => {
      for (const k of ["VD-01", "VD-02"]) await prc.returnDoc(x.db, { projectId: x.P, docId: x.ids[k], returnedOn: x.d(40), code: 1 });
      await prc.recordFat(x.db, { projectId: x.P, poLineId: x.ids.poLine, inspectedOn: x.d(45), result: "pass", irnNo: "IRN-7001",
        inspector: "TPI inspector", userId: x.users.qc });
    },
  },
  {
    id: "2.8", phase: "2", who: "pm", title: "حمل و ورود پمپ به سایت",
    where: "PO-7001 › «جزئیات» › محموله",
    do: ["محمولهٔ SH-7001 · حمل روز 50 · ETA روز 58 · ردیف P-7001 مقدار 1؛ سپس «ورود» در روز 58."],
    expect: ["فهرست پیگیری: P-7001 «رسیده به سایت»؛ شناوری نسبت به نیاز روز 70 مثبت."],
    run: async (x) => {
      const sh = await prc.createShipment(x.db, { projectId: x.P, shipmentNo: "SH-7001", poId: x.ids.po, shippedOn: x.d(50), etaOn: x.d(58),
        mode: "road", lines: [{ poLineId: x.ids.poLine, qty: 1 }], userId: x.users.pm });
      await prc.arriveShipment(x.db, { projectId: x.P, shipmentId: (sh.shipment || sh).id, arrivedOn: x.d(58) });
    },
  },
  {
    id: "2.9", phase: "2", who: "pm", title: "لولهٔ خط: کالا، PO مستقیم و رسید در انبار",
    where: "خرید و انبار › «انبار و مواد» › «+ کالای جدید»؛ سپس «خرید و پیگیری» › «PO یا فروشندهٔ جدید»",
    do: [
      "کالا PIPE-3-S40-A106B · «Pipe 3\" SCH40 SMLS A106 Gr.B» · دسته «لوله» · واحد m",
      "فروشندهٔ V-PIPE؛ PO-7002 روز 30 با ردیف PIPE-3-S40-A106B مقدار 36 m",
      "رسید در برابر PO: MRR-7001 · روز 55 · 36 m · Heat H-70011 · MTC MTC-70011 · محل «Laydown A»",
    ],
    expect: ["انبار: لات MRR-7001 «منتظر MIR» و MTC «بررسی‌نشده» — هنوز قابل حواله نیست."],
    run: async (x) => {
      const item = await wh.upsertItem(x.db, { projectId: x.P, code: "PIPE-3-S40-A106B", description: "Pipe 3\" SCH40 SMLS A106 Gr.B",
        category: "pipe", uom: "m", spec: "ASTM A106 Gr.B" });
      x.ids.pipeItem = item.id;
      const v = await prc.upsertVendor(x.db, { projectId: x.P, code: "V-PIPE", name: "Pipe Stockist", country: "IR" });
      const po = await prc.createPo(x.db, { projectId: x.P, poNo: "PO-7002", vendorId: v.id, title: "Line pipe 3in", currency: "EUR", placedOn: x.d(30), userId: x.users.pm });
      const pl = await prc.addPoLine(x.db, { projectId: x.P, poId: po.id, itemId: item.id, qty: 36, uom: "m", promisedOn: x.d(55), needOn: x.d(60) });
      const lot = await prc.receiveAgainstPo(x.db, { projectId: x.P, poLineId: pl.id, receiptNo: "MRR-7001", receivedOn: x.d(55), qty: 36,
        heatNo: "H-70011", mtcRef: "MTC-70011", location: "Laydown A", userId: x.users.pm });
      x.ids.pipeLot = lot.id;
    },
  },
  {
    id: "2.10", phase: "2", who: "qc", title: "MIR و بررسی MTC لوله",
    where: "انبار و مواد › موجودی به تفکیک لات › MRR-7001 › «جزئیات»",
    do: ["MIR-7001: پذیرفته 36 · رد 0 · روز 56", "MTC: MTC-70011 با ذوب H-70011 — «پذیرفته»"],
    expect: ["لات MRR-7001: «قابل حواله» 36 m؛ پیگرد ذوب H-70011 به همین لات می‌رسد."],
    run: async (x) => {
      await wh.inspectLot(x.db, { projectId: x.P, lotId: x.ids.pipeLot, qtyAccepted: 36, qtyRejected: 0, mirRef: "MIR-7001", inspectedOn: x.d(56) });
      await wh.reviewMtc(x.db, { projectId: x.P, lotId: x.ids.pipeLot, mtcRef: "MTC-70011", heatNo: "H-70011", mtcStatus: "accepted" });
    },
  },

  // ── 3 ─────────────────────────────────────────────────────────────────
  {
    id: "3.1", phase: "3", who: "pm", title: "ثبت فونداسیون‌ها",
    where: "اجرا › سیویل و سازه › تب «سیویل» › «+ ثبت فونداسیون جدید»",
    do: [
      "FDN-P-7001 · تجهیز P-7001 · بتن C30 با f′c = 30 MPa · حجم 6 m³ · انکر بولت «VND-P7001-AB» (از GA فروشنده)",
      "FDN-D-7002 · تجهیز D-7002 · بتن C30 با f′c = 30 MPa · حجم 10 m³",
    ],
    expect: ["هر دو در فهرست فونداسیون‌ها؛ «امروز می‌شود»: خاک‌برداری."],
    run: async (x) => {
      for (const [no, tag, vol, ab] of [["FDN-P-7001", "P-7001", 6, "VND-P7001-AB"], ["FDN-D-7002", "D-7002", 10, null]]) {
        const f = await upsertFoundation(x.db, { projectId: x.P, tagNo: no, carriesTagId: x.ids[tag], subsystemId: x.ids.sub,
          concreteClass: "C30", fcMpa: 30, volumeM3: vol, anchorBoltRef: ab, description: `فونداسیون ${tag}` });
        x.ids[no] = f.id;
      }
    },
  },
  {
    id: "3.2", phase: "3", who: "pm", title: "کارهای پیش از بتن‌ریزی",
    where: "سیویل › ردیف هر فونداسیون › «جزئیات» › ثبت مرحله",
    do: ["برای هر دو فونداسیون به ترتیب: خاک‌برداری (روز 52)، بتن مگر (53)، آرماتور و قالب (55)، انکر بولت (56)، بازرسی پیش از بتن‌ریزی (58)"],
    expect: ["«امروز می‌شود»: بتن‌ریزی."],
    run: async (x) => {
      for (const f of ["FDN-P-7001", "FDN-D-7002"]) {
        for (const [code, day] of [["excavation", 52], ["blinding", 53], ["rebar", 55], ["embedments", 56], ["pre_pour", 58]]) {
          await recordActivity(x.db, { projectId: x.P, tagId: x.ids[f], code, doneAt: x.d(day), userId: x.users.pm });
        }
      }
    },
  },
  {
    id: "3.3", phase: "3", who: "pm", title: "آزمون منفی: تیک زدن «بتن‌ریزی» به‌جای ثبت بتن",
    where: "سیویل › FDN-P-7001 › ثبت مرحله «بتن‌ریزی»",
    do: ["مرحلهٔ بتن‌ریزی را دستی «انجام شد» بزنید."],
    expect: ["رد می‌شود: «مرحلهٔ «بتن‌ریزی» از داده خوانده می‌شود و دستی ثبت نمی‌شود» — بتن‌ریزی از برگهٔ بتن ثبت می‌شود."],
    negative: true,
    run: async (x) => {
      await x.refused(() => recordActivity(x.db, { projectId: x.P, tagId: x.ids["FDN-P-7001"], code: "pour", doneAt: x.d(60), userId: x.users.pm }),
        /از داده خوانده می‌شود/);
    },
  },
  {
    id: "3.4", phase: "3", who: "qc", title: "بتن‌ریزی و نمونه‌های مقاومت",
    where: "سیویل › فونداسیون › «جزئیات» › ثبت بتن‌ریزی؛ سپس نمونه‌ها زیر همان بتن‌ریزی",
    do: [
      "PC-P-7001 روز 60 · 6 m³ · C30 / 30 MPa · پیمانکار C-CIV — نمونهٔ S1 (استوانه 150×300): 7 روزه 22.0 و 23.0؛ 28 روزه 36.5 و 37.5 MPa",
      "PC-D-7002 روز 60 · 10 m³ · C30 / 30 MPa — نمونهٔ S1: 28 روزه 35.0 و 36.0 MPa",
    ],
    expect: ["ستون «مقاومت»: پذیرفته (ACI 318)؛ عمل‌آوری 7 روزه پس از روز 67 کامل است."],
    run: async (x) => {
      for (const [f, pourNo, vol, results] of [["FDN-P-7001", "PC-P-7001", 6, [[7, [22.0, 23.0]], [28, [36.5, 37.5]]]],
        ["FDN-D-7002", "PC-D-7002", 10, [[28, [35.0, 36.0]]]]]) {
        const pour = await recordPour(x.db, { projectId: x.P, tagId: x.ids[f], pourNo, pouredOn: x.d(60), volumeM3: vol,
          concreteClass: "C30", fcMpa: 30, contractorId: x.ids.cCiv, userId: x.users.qc });
        for (const [age, r] of results) {
          await recordSpecimens(x.db, { projectId: x.P, pourId: pour.id, sampleNo: "S1", specimenType: "cyl150", ageDays: age,
            results: r, testedOn: x.d(60 + age), labRef: `LAB-${pourNo}-${age}`, userId: x.users.qc });
        }
      }
    },
  },
  {
    id: "3.5", phase: "3", who: "pm", title: "خاک‌ریزی و تحویل فونداسیون به مکانیک",
    where: "سیویل › فونداسیون › ثبت مرحله",
    do: ["برای هر دو: باز کردن قالب و خاک‌ریزی (روز 70)، تحویل به مکانیک (روز 89)"],
    expect: ["در زنجیرهٔ P-7001 و D-7002 مرحلهٔ «فونداسیون و بولت» خودبه‌خود انجام‌شده است (از سیویل خوانده می‌شود)."],
    run: async (x) => {
      for (const f of ["FDN-P-7001", "FDN-D-7002"]) {
        await recordActivity(x.db, { projectId: x.P, tagId: x.ids[f], code: "backfill", doneAt: x.d(70), userId: x.users.pm });
        await recordActivity(x.db, { projectId: x.P, tagId: x.ids[f], code: "ready", doneAt: x.d(89), userId: x.users.pm });
      }
      for (const t of ["P-7001", "D-7002"]) {
        const st = await tagStatus(x.db, { projectId: x.P, tagId: x.ids[t] });
        x.check(stepDone(st, "foundation"), `${t}: the foundation step reads done from civil`);
      }
    },
  },

  // ── 4 ─────────────────────────────────────────────────────────────────
  {
    id: "4.1", phase: "4", who: "pm", title: "ITP تجهیز دوّار با نقطهٔ توقف کارفرما روی الایمنت",
    where: "کیفیت و تکمیل › کیفیت و بازرسی › تب «بازرسی (ITP و IR)» › تب «ITP» › «ITP یا رویژن جدید»",
    do: [
      "ITP-ROT-70 · رویژن 0 · «Rotating equipment installation» · نوع کار: تجهیز دوّار",
      "فعالیت 10: «Cold alignment check» · مرحلهٔ زنجیره: الایمنت سرد · معیار «≤0.05 mm TIR» · کارفرما: H (توقف)",
      "«تأیید و اجرا» را اول با حساب خودتان بزنید، سپس با حساب نمایندهٔ کارفرما.",
    ],
    expect: [
      "تأیید شما رد می‌شود: تهیه‌کننده ITP را تأیید نمی‌کند.",
      "با حساب کارفرما: ITP-ROT-70 «در حال اجرا»؛ از این لحظه الایمنت هر پمپ پشت این نقطهٔ توقف است.",
    ],
    run: async (x) => {
      const itp = await insp.createItp(x.db, { projectId: x.P, itpNo: "ITP-ROT-70", revision: "0", title: "Rotating equipment installation",
        scope: "rotating", userId: x.users.pm });
      x.ids.itpRot = itp.id;
      const a = await insp.saveActivity(x.db, { projectId: x.P, itpId: itp.id, seq: 10, title: "Cold alignment check", stepCode: "align",
        reference: "API 686 ch.7", criteria: "≤0.05 mm TIR", record: "ALN-form", points: { company: "H" } });
      x.ids.itpAlign = a.id;
      await x.refused(() => insp.approveItp(x.db, { projectId: x.P, itpId: itp.id, userId: x.users.pm, onDate: x.d(85) }), /تهیه|تأیید/);
      await insp.approveItp(x.db, { projectId: x.P, itpId: itp.id, userId: x.users.client, onDate: x.d(85) });
    },
  },
  {
    id: "4.2", phase: "4", who: "pm", title: "استقرار و گروت پمپ و درام",
    where: "اجرا › تجهیزات، رنگ و عایق › تب «تجهیزات» › ردیف تگ › ثبت مرحله",
    do: [
      "P-7001: استقرار و تراز بیس‌پلیت (روز 90، SET-7001)، گروت‌ریزی (روز 92، GRT-7001)",
      "D-7002: استقرار و تراز (روز 90)، گروت‌ریزی (روز 92)",
    ],
    expect: ["P-7001: «امروز می‌شود»: الایمنت سرد — با برچسب نقطهٔ توقف ITP."],
    run: async (x) => {
      for (const t of ["P-7001", "D-7002"]) {
        await recordActivity(x.db, { projectId: x.P, tagId: x.ids[t], code: "set", doneAt: x.d(90), refNo: `SET-${t}`, userId: x.users.pm });
        await recordActivity(x.db, { projectId: x.P, tagId: x.ids[t], code: "grout", doneAt: x.d(92), refNo: `GRT-${t}`, userId: x.users.pm });
      }
    },
  },
  {
    id: "4.3", phase: "4", who: "pm", title: "آزمون منفی: الایمنت پیش از آزاد شدن نقطهٔ توقف",
    where: "تجهیزات › P-7001 › ثبت مرحلهٔ «الایمنت سرد»",
    do: ["الایمنت را «انجام شد» بزنید (روز 94)."],
    expect: ["رد می‌شود: فعالیت ITP-ROT-70 ردیف 10 (H: کارفرما) «آزاد نشده»."],
    negative: true,
    run: async (x) => {
      await x.refused(() => recordActivity(x.db, { projectId: x.P, tagId: x.ids["P-7001"], code: "align", doneAt: x.d(94), userId: x.users.pm }),
        /آزاد نشده|ITP-ROT-70/);
    },
  },
  {
    id: "4.4", phase: "4", who: "qc", title: "درخواست بازرسی (IR) و پذیرش کارفرما",
    where: "بازرسی (ITP و IR) › تب «درخواست‌های بازرسی» › «درخواست بازرسی جدید»؛ سپس با حساب کارفرما › ثبت نتیجه",
    do: [
      "بازرس QC: ITP-ROT-70 ردیف 10 · آیتم P-7001 · زمان: فردا ساعت 9 (در اجرای دستی: یک زمان واقعی در آینده) · محل «Unit 70, pump bay»",
      "نمایندهٔ کارفرما: نتیجه «پذیرفته» · بازرس «Client mech. inspector»",
    ],
    expect: ["IR «آزاد شد»؛ برچسب توقف از الایمنت P-7001 برداشته می‌شود."],
    run: async (x) => {
      const ir = await insp.raiseIr(x.db, { projectId: x.P, activityId: x.ids.itpAlign, itemKind: "tag", itemId: x.ids["P-7001"],
        plannedAt: x.at(96, 9), location: "Unit 70, pump bay", membership: { inspection_party: "contractor" }, userId: x.users.qc, now: new Date(x.at(94, 15)) });
      x.ids.irAlign = ir.id;
      await insp.recordResult(x.db, { projectId: x.P, irId: ir.id, outcome: "accepted", inspectorName: "Client mech. inspector",
        membership: { inspection_party: "company" }, userId: x.users.client, now: new Date(x.at(96, 11)) });
    },
  },
  {
    id: "4.5", phase: "4", who: "pm", title: "الایمنت سرد",
    where: "تجهیزات › P-7001 › ثبت مرحله",
    do: ["الایمنت سرد: روز 96 · مرجع ALN-7001"],
    expect: ["P-7001: فونداسیون، استقرار، گروت و الایمنت انجام شده؛ «اتصال پایپینگ» منتظر خط است."],
    run: async (x) => {
      await recordActivity(x.db, { projectId: x.P, tagId: x.ids["P-7001"], code: "align", doneAt: x.d(96), refNo: "ALN-7001", userId: x.users.pm });
    },
  },

  // ── 5 ─────────────────────────────────────────────────────────────────
  {
    id: "5.1", phase: "5", who: "pm", title: "کلاس لولهٔ A1DM",
    where: "اجرا › پایپینگ › تب «ایزومتریک و رجیستر جوش» › کلاس‌های لوله",
    do: ["A1DM · «DM water, CS, 150#» · سرویس Category D · A106 Gr.B · خوردگی مجاز 1.5 mm · دمای طراحی 60 °C · فشار طراحی 16 barg"],
    expect: ["فشار تست هر پکیجی که این خط را دارد از همین کلاس حساب می‌شود (B31.3: ۱٫۵ × P × Rr)."],
    run: async (x) => {
      x.ids.classA1 = (await upsertPipingClass(x.db, { projectId: x.P, code: "A1DM", description: "DM water, CS, 150#",
        serviceCategory: "category_d", materialSpec: "A106 Gr.B", corrosionAllowMm: 1.5, designTempC: 60, designPressBarg: 16 })).id;
    },
  },
  {
    id: "5.2", phase: "5", who: "pm", title: "رجیستر جوش ایزومتریک DMW-ISO-7001",
    where: "پایپینگ › ایزومتریک و رجیستر جوش › (بدون کلید مدل:) تب JSON › چسباندن JSON سناریو › «اعمال» › «ذخیره» › «تأیید رجیستر (مهندس)»",
    do: [
      "PDF ایزومتریک را اگر دارید بارگذاری کنید؛ استخراج با مدل نیاز به کلید دارد، پس JSON آمادهٔ همین خط را در تب JSON بچسبانید (در پیوست همین راهنما).",
      "ذخیره، سپس «تأیید رجیستر».",
    ],
    expect: [
      "6 جوش: W-01، W-05، W-06 سایت (تای‌این و کلوژر، RT 100%) و W-02 تا W-04 کارگاهی؛ اسپول‌های SP-01 و SP-02.",
      "خط 70-DMW-7001 ساخته می‌شود و — چون ایزومتریکش در MDR زیر 70-01 است — خودش زیر ساب‌سیستم 70-01 می‌رود؛ تجهیزش P-7001 است، از اولین تای‌این نقشه.",
    ],
    run: async (x) => {
      const doc = await registerDocument(x.db, { projectId: x.P, docNo: "DMW-ISO-7001", revision: "0", sheetNo: "1/1",
        fileSha256: "7".repeat(64), storageUri: "scenario://DMW-ISO-7001", contentType: "application/pdf", createdBy: x.users.pm });
      const docId = (doc.document || doc).id;
      const model = buildModel(ISO_7001, {});
      const line = await lineForRegister(x.db, { projectId: x.P, lineNo: ISO_7001.meta.lineNo, docNo: ISO_7001.meta.drawingNo,
        unitCode: ISO_7001.meta.unit, pipingClass: ISO_7001.meta.pipingClass, tieInRefs: tieInRefsOf(ISO_7001) });
      x.ids.line = line.id;
      const run = await createRun(x.db, { projectId: x.P, documentId: docId, lineId: line.id, payload: ISO_7001,
        validationChecks: model.checks, createdBy: x.users.pm });
      await saveRegister(x.db, { projectId: x.P, runId: run.id, documentId: docId, lineId: line.id, model });
      await approveRun(x.db, { projectId: x.P, runId: run.id, userId: x.users.pm });
      const { rows: [l] } = await x.db.query("SELECT subsystem_id FROM line WHERE id = $1", [line.id]);
      x.check(l.subsystem_id === x.ids.sub, "the line went under 70-01 from the drawing's MDR row");
      x.check(line.tag_id === x.ids["P-7001"], "the line belongs to P-7001, named on its first tie-in");
      const { rows: welds } = await x.db.query("SELECT weld_uid, weld_no, shop_field, spool_id FROM weld WHERE line_id = $1 ORDER BY weld_no", [line.id]);
      x.check(welds.length === 6, "6 welds on the line");
      x.ids.welds = welds;
      const { rows: spools } = await x.db.query("SELECT id, spool_no FROM spool WHERE line_id = $1 ORDER BY spool_no", [line.id]);
      x.ids.spools = Object.fromEntries(spools.map((r) => [r.spool_no, r.id]));
    },
  },
  {
    id: "5.3", phase: "5", who: "qc", title: "جوشکار و صلاحیتش",
    where: "پایپینگ › تب «NDT و جوشکار» (یا فرم جوشکار در صفحهٔ ایزومتریک)",
    do: ["جوشکار W-701 «جوشکار سناریو» · صلاحیت GTAW، وضعیت 6G، کوپن OD 88.9 mm، ضخامت 5.49 mm"],
    expect: ["W-701 برای جوش 3 اینچ SCH40 صلاحیت دارد."],
    run: async (x) => {
      const w = await upsertWelder(x.db, { projectId: x.P, stampNo: "W-701", name: "جوشکار سناریو", employer: "C-MEC" });
      x.ids.welder = w.id;
      await addQualification(x.db, { projectId: x.P, welderId: w.id, process: "GTAW", positions: ["6G"], couponOdMm: 88.9, couponThicknessMm: 5.49 });
    },
  },
  {
    id: "5.4", phase: "5", who: "qc", title: "ساخت اسپول‌ها در کارگاه: صدور، فیت‌آپ، جوش و RT",
    where: "پایپینگ › تب «اجرا: اسپول و ساپورت» (مراحل)؛ جوش و NDT در رجیستر جوش",
    do: [
      "SP-01 و SP-02: صدور به کارگاه (روز 62)، فیت‌آپ (روز 64، FU-7001/FU-7002)",
      "جوش‌های کارگاهی W-02، W-03، W-04: جوشکار W-701، روز 66، GTAW، وضعیت V",
      "RT هر سه: پذیرفته، گزارش RT-7001، روز 68",
      "حوالهٔ لوله از انبار: 12 m از لات MRR-7001 به اسپول SP-01 (روز 61)",
    ],
    expect: ["«جوشکاری کارگاهی» و «NDT کارگاهی» خودشان انجام‌شده می‌شوند (از رکورد جوش و NDT)؛ قدم بعد: نصب در محل."],
    run: async (x) => {
      await wh.recordMovement(x.db, { projectId: x.P, lotId: x.ids.pipeLot, kind: "issue", qty: 12, movedOn: x.d(61), refNo: "MIV-7001",
        contractorId: x.ids.cMec, spoolId: x.ids.spools["SP-01"], userId: x.users.qc });
      for (const [sp, fu] of [["SP-01", "FU-7001"], ["SP-02", "FU-7002"]]) {
        await recordSpoolActivity(x.db, { projectId: x.P, spoolId: x.ids.spools[sp], code: "released", doneAt: x.d(62), contractorId: x.ids.cMec, userId: x.users.qc });
        await recordSpoolActivity(x.db, { projectId: x.P, spoolId: x.ids.spools[sp], code: "fit_up", doneAt: x.d(64), refNo: fu, contractorId: x.ids.cMec, userId: x.users.qc });
      }
      for (const w of x.ids.welds.filter((y) => y.shop_field === "Shop")) {
        await assignWeld(x.db, { projectId: x.P, weldUid: w.weld_uid, welderId: x.ids.welder, weldedAt: x.d(66), process: "GTAW", position: "V",
          lineId: x.ids.line, userId: x.users.qc });
        await recordNdt(x.db, { projectId: x.P, weldUid: w.weld_uid, method: "RT", result: "accept", reportNo: "RT-7001", inspectedAt: x.d(68), userId: x.users.qc });
      }
    },
  },
  {
    id: "5.5", phase: "5", who: "pm", title: "مجوز کار گرم برای جوش‌های سایت",
    where: "مدیریت پروژه › HSE › تب «مجوز کار (PTW)» › «درخواست مجوز کار»؛ سپس تست گاز و «صدور»",
    do: [
      "HW-7001 · کار گرم · محدوده «Unit 70 pipe rack» · «Field welds W-01, W-05, W-06» · پیمانکار C-MEC · اعتبار روز 93 ساعت 7 تا 17",
      "تست گاز روز 93 ساعت 7:30: O₂ 20.9 %، LEL 0، H₂S 0، CO 0 · تستر «Gas tester» · دستگاه «GD-701»",
      "صدور (با حساب خودتان — صادرکننده درخواست‌دهنده نیست).",
    ],
    expect: ["پیش از تست گاز «صدور» رد می‌شود؛ پس از آن مجوز «فعال» است."],
    run: async (x) => {
      const hw = await requestPermit(x.db, { projectId: x.P, permitNo: "HW-7001", type: "hot", area: "Unit 70 pipe rack",
        description: "Field welds W-01, W-05, W-06 on 70-DMW-7001", contractorId: x.ids.cMec, requesterName: "C-MEC foreman",
        validFrom: x.at(93, 7), validTo: x.at(93, 17) });
      x.ids.hw = hw.id;
      await x.refused(() => activatePermit(x.db, { projectId: x.P, permitId: hw.id, userId: x.users.pm, now: x.at(93, 7) }), /گاز|gas/i);
      await recordGasTest(x.db, { projectId: x.P, permitId: hw.id, testedAt: x.at(93, 7.5), o2Pct: 20.9, lelPct: 0, h2sPpm: 0, coPpm: 0,
        testerName: "Gas tester", instrument: "GD-701", userId: x.users.qc });
      await activatePermit(x.db, { projectId: x.P, permitId: hw.id, userId: x.users.pm, now: x.at(93, 8) });
    },
  },
  {
    id: "5.6", phase: "5", who: "qc", title: "نصب در محل، جوش‌های سایت و ساپورت‌ها",
    where: "پایپینگ › اجرا: اسپول و ساپورت؛ رجیستر جوش؛ «+ ساپورت جدید»",
    do: [
      "SP-01 و SP-02: نصب در محل (روز 92)",
      "جوش‌های سایت W-01، W-05، W-06: جوشکار W-701، روز 93، وضعیت V؛ RT هر سه پذیرفته، RT-7002، روز 94",
      "ساپورت‌ها: G-7001 (Guide) روی SP-01 و SH-7002 (Shoe) روی SP-02 — «نصب شد» روز 94 و «بازرسی شد» روز 95",
      "مجوز HW-7001 را پایان روز ببندید.",
    ],
    expect: ["هر دو اسپول: «جوش و NDT سایت» و «ساپورت» انجام؛ قدم بعد: تست فشار."],
    run: async (x) => {
      for (const sp of ["SP-01", "SP-02"]) {
        await recordSpoolActivity(x.db, { projectId: x.P, spoolId: x.ids.spools[sp], code: "erected", doneAt: x.d(92), contractorId: x.ids.cMec, userId: x.users.qc });
      }
      for (const w of x.ids.welds.filter((y) => y.shop_field !== "Shop")) {
        await assignWeld(x.db, { projectId: x.P, weldUid: w.weld_uid, welderId: x.ids.welder, weldedAt: x.d(93), process: "GTAW", position: "V",
          lineId: x.ids.line, userId: x.users.qc });
        await recordNdt(x.db, { projectId: x.P, weldUid: w.weld_uid, method: "RT", result: "accept", reportNo: "RT-7002", inspectedAt: x.d(94), userId: x.users.qc });
      }
      for (const [no, kind, sp] of [["G-7001", "guide", "SP-01"], ["SH-7002", "shoe", "SP-02"]]) {
        const s = await upsertSupport(x.db, { projectId: x.P, supportNo: no, kind, lineId: x.ids.line, spoolId: x.ids.spools[sp],
          drawingRef: "STD-PS-02", contractorId: x.ids.cMec });
        await markSupport(x.db, { projectId: x.P, supportId: s.id, step: "installed", on: x.d(94), userId: x.users.qc });
        await markSupport(x.db, { projectId: x.P, supportId: s.id, step: "inspected", on: x.d(95), userId: x.users.qc });
      }
      await closePermit(x.db, { projectId: x.P, permitId: x.ids.hw, userId: x.users.pm, now: x.at(93, 16) });
    },
  },
  {
    id: "5.7", phase: "5", who: "pm", title: "پکیج تست TP-70-01",
    where: "کیفیت و تکمیل › تکمیل و راه‌اندازی › تب «تست فشار و MC» › «+ پکیج تست جدید»",
    do: ["TP-70-01 · ساب‌سیستم 70-01 · هیدرواستاتیک · Rr = 1.0 · خط 70-DMW-7001"],
    expect: ["فشار تست محاسبه‌شده: 1.5 × 16 × 1.0 = 24 barg · وضعیت «آمادهٔ تست»."],
    run: async (x) => {
      const pk = await upsertTestPackage(x.db, { projectId: x.P, packNo: "TP-70-01", subsystemId: x.ids.sub, medium: "hydrostatic",
        stressRatio: 1.0, description: "DM water pump discharge to drum", userId: x.users.pm });
      x.ids.pack = pk.id;
      await addPackLines(x.db, { projectId: x.P, packageId: pk.id, lineIds: [x.ids.line] });
    },
  },
  {
    id: "5.8", phase: "5", who: "qc", title: "آزمون منفی: تست با فشار کمتر از لازم",
    where: "تست فشار و MC › TP-70-01 › «جزئیات» › ثبت تست؛ سپس پذیرش با حساب کارفرما",
    do: ["فشار به‌دست‌آمده 20 barg، نگه‌داشت 30 دقیقه، گیج PG-CAL-701، روز 97", "نمایندهٔ کارفرما این تست را بپذیرد."],
    expect: [
      "تست ثبت می‌شود اما با حکم «مردود» و دلیلش (کمتر از 24 barg) — حکم را سامانه می‌دهد، نه ثبت‌کننده.",
      "پذیرش رد می‌شود: «تست مردود پذیرفته نمی‌شود».",
    ],
    negative: true,
    run: async (x) => {
      const r = await recordPressureTest(x.db, { projectId: x.P, packageId: x.ids.pack, testedOn: x.d(97), achievedBarg: 20, holdMin: 30,
        gaugeCert: "PG-CAL-701", userId: x.users.qc });
      x.check(r.verdict === "fail", "20 barg against 24 required is judged a fail");
      await x.refused(() => acceptPressureTest(x.db, { projectId: x.P, recordId: r.id, userId: x.users.client }), /مردود/);
    },
  },
  {
    id: "5.9", phase: "5", who: "qc", title: "تست هیدرو و پذیرش کارفرما",
    where: "همان‌جا؛ پذیرش با حساب نمایندهٔ کارفرما",
    do: [
      "ثبت تست: 24.5 barg · نگه‌داشت 30 دقیقه · گیج PG-CAL-701 · بدون نشتی · شاهد «Client» · روز 98",
      "پذیرش: اول با حساب بازرس QC (ثبت‌کننده) امتحان کنید، سپس با حساب نمایندهٔ کارفرما.",
    ],
    expect: [
      "پذیرش ثبت‌کننده رد می‌شود: «ثبت‌کنندهٔ تست، آن را نمی‌پذیرد».",
      "TP-70-01 «پذیرفته»؛ مرحلهٔ «تست فشار» هر دو اسپول انجام‌شده.",
    ],
    run: async (x) => {
      const rec = await recordPressureTest(x.db, { projectId: x.P, packageId: x.ids.pack, testedOn: x.d(98), achievedBarg: 24.5, holdMin: 30,
        gaugeCert: "PG-CAL-701", leaks: false, witness: "Client", userId: x.users.qc });
      x.check(rec.verdict === "pass", "24.5 barg held 30 min without leaks passes");
      await x.refused(() => acceptPressureTest(x.db, { projectId: x.P, recordId: rec.id, userId: x.users.qc }), /ثبت‌کنندهٔ تست/);
      await acceptPressureTest(x.db, { projectId: x.P, recordId: rec.id, userId: x.users.client });
      for (const sp of ["SP-01", "SP-02"]) {
        const st = await spoolStatus(x.db, { projectId: x.P, spoolId: x.ids.spools[sp] });
        x.check(stepDone(st, "test"), `${sp}: the pressure test step reads done from the accepted pack`);
      }
    },
  },

  // ── 6 ─────────────────────────────────────────────────────────────────
  {
    id: "6.1", phase: "6", who: "qc", title: "رنگ اسپول‌ها پس از تست فشار",
    where: "اجرا › تجهیزات، رنگ و عایق › تب «رنگ و عایق» › سیستم رنگ جدید؛ «تخصیص سیستم رنگ و عایق»؛ ثبت رکوردها در «جزئیات» هر آیتم",
    do: [
      "سیستم CS-DM-01 «Epoxy primer / epoxy finish, C3» · Sa 2½ · پروفیل 40 تا 75 µm · لایه‌ها: «Epoxy zinc phosphate primer: 75» و «Epoxy finish: 125» · حداکثر DFT 350",
      "تخصیص به SP-01 و SP-02، مساحت هر کدام 3 m²",
      "روز 100: آماده‌سازی Sa 2½ با پروفیل «55 60 58»؛ لایهٔ 1 و 2 با هوا 30 °C، رطوبت 55 %، فولاد 33 °C و قرائت‌های DFT؛ روز 102 بازرسی نهایی",
    ],
    expect: ["هر دو آیتم «تحویل رنگ» — و مرحلهٔ «رنگ و عایق» اسپول‌ها انجام‌شده."],
    run: async (x) => {
      const cs = await upsertSystem(x.db, { projectId: x.P, code: "CS-DM-01", title: "Epoxy primer / epoxy finish, C3", prepGrade: "Sa 2½",
        profileMinUm: 40, profileMaxUm: 75, maxDftUm: 350,
        coats: [{ name: "Epoxy zinc phosphate primer", ndftUm: 75 }, { name: "Epoxy finish", ndftUm: 125 }] });
      await assignCoating(x.db, { projectId: x.P, systemId: cs.id, spoolIds: Object.values(x.ids.spools), areaM2: 3 });
      const gauge = (base) => Array.from({ length: minReadings(3) }, (_, k) => base + ((k * 7) % 20)).join(" ");
      const { rows: items } = await x.db.query("SELECT id FROM coating_item WHERE project_id = $1 AND spool_id = ANY($2)", [x.P, Object.values(x.ids.spools)]);
      const air = { airC: 30, rh: 55, steelC: 33 };
      for (const it of items) {
        await recordCoating(x.db, { projectId: x.P, itemId: it.id, kind: "prep", recordedOn: x.d(100), inspector: "Coating inspector", userId: x.users.qc,
          grade: "Sa 2½", profile: "55 60 58" });
        await recordCoating(x.db, { projectId: x.P, itemId: it.id, kind: "coat", coatNo: 1, recordedOn: x.d(100), inspector: "Coating inspector",
          userId: x.users.qc, ...air, readings: gauge(80) });
        await recordCoating(x.db, { projectId: x.P, itemId: it.id, kind: "coat", coatNo: 2, recordedOn: x.d(101), inspector: "Coating inspector",
          userId: x.users.qc, ...air, readings: gauge(205) });
        for (const code of ["final_inspection", "ready"]) {
          await recordCoatingActivity(x.db, { projectId: x.P, itemId: it.id, code, doneAt: x.d(102), contractorId: x.ids.cMec, userId: x.users.qc });
        }
      }
    },
  },
  {
    id: "6.2", phase: "6", who: "pm", title: "لیست کابل: کابل قدرت موتور پمپ",
    where: "اجرا › برق و ابزار دقیق › تب «برق» › «ورود لیست کابل»",
    do: [
      "متن CSV: «Cable No,From,To,Cable Type,Voltage,Length (m)» و ردیف «CBL-P-7001,MCC-70,P-7001,3Cx16 XLPE/SWA/PVC,0.6/1kV,60»",
    ],
    expect: ["CBL-P-7001 به تگ P-7001 وصل شد؛ ردهٔ LV، تست IR با 500 V (IEC 60364-6، سیستم 400 V)."],
    run: async (x) => {
      const r = await importCableSchedule(x.db, { projectId: x.P, text: [
        "Cable No,From,To,Cable Type,Voltage,Length (m)",
        "CBL-P-7001,MCC-70,P-7001,3Cx16 XLPE/SWA/PVC,0.6/1kV,60",
      ].join("\n") });
      x.check(r.imported === 1 && !r.unmatched.length, "the motor cable is matched to P-7001");
      x.ids.cable = (await x.db.query("SELECT id FROM cable WHERE project_id = $1 AND cable_no = 'CBL-P-7001'", [x.P])).rows[0].id;
    },
  },
  {
    id: "6.3", phase: "6", who: "qc", title: "کابل‌کشی، ترمینیشن و آزمون منفی IR",
    where: "برق › CBL-P-7001 › «جزئیات»",
    do: [
      "مسیر (روز 94)، کابل‌کشی (95)، ترمینیشن دو سر (97)",
      "IR اول: 500 V با قرائت‌های «300 0.4 280» MΩ، روز 98 — یک رشته زیر حد است",
      "پس از تعمیر سر کابل: IR دوم 500 V با «>2000 >2000 >2000»، روز 99؛ پیوستگی و توالی فاز (روز 99)",
    ],
    expect: [
      "IR اول «رد» با نام رشتهٔ معیوب — مرحلهٔ IR انجام‌شده حساب نمی‌شود.",
      "پس از IR دوم: «آماده برای برق‌دار شدن» ممکن است؛ در زنجیرهٔ P-7001 «ترمینیشن برق» از کابل خوانده می‌شود.",
    ],
    run: async (x) => {
      for (const [code, day] of [["route", 94], ["pulled", 95], ["terminated", 97]]) {
        await recordCableActivity(x.db, { projectId: x.P, cableId: x.ids.cable, code, doneAt: x.d(day), contractorId: x.ids.cEi, userId: x.users.qc });
      }
      await recordIrTest(x.db, { projectId: x.P, cableId: x.ids.cable, testVoltageV: 500, readings: ["300", "0.4", "280"],
        testedOn: x.d(98), instrumentRef: "MIT-525 / CAL-701", tester: "C-EI tester", userId: x.users.qc });
      x.check(!stepDone(await cableStatus(x.db, { projectId: x.P, cableId: x.ids.cable }), "ir"), "a 0.4 MΩ core fails the IR test: the IR step is not done");
      await recordIrTest(x.db, { projectId: x.P, cableId: x.ids.cable, testVoltageV: 500, readings: [">2000", ">2000", ">2000"],
        testedOn: x.d(99), instrumentRef: "MIT-525 / CAL-701", tester: "C-EI tester", userId: x.users.qc });
      x.check(stepDone(await cableStatus(x.db, { projectId: x.P, cableId: x.ids.cable }), "ir"), "the second IR test passes: the IR step is done");
      await recordCableActivity(x.db, { projectId: x.P, cableId: x.ids.cable, code: "continuity", doneAt: x.d(99), contractorId: x.ids.cEi, userId: x.users.qc });
      await recordCableActivity(x.db, { projectId: x.P, cableId: x.ids.cable, code: "ready", doneAt: x.d(100), contractorId: x.ids.cEi, userId: x.users.qc });
    },
  },
  {
    id: "6.4", phase: "6", who: "pm", title: "فهرست ابزار: فلو ترانسمیتر خروجی پمپ و لول ترانسمیتر درام",
    where: "برق و ابزار دقیق › تب «ابزار دقیق» › «ورود لیست ابزار (Instrument Index)»",
    do: [
      "«Tag No,Service,Type,Range,Equipment,Tolerance»",
      "«FT-7001,DM water pump discharge flow,Magnetic flowmeter,0-40 m3/h,P-7001,»",
      "«LT-7002,DM water drum level,Guided wave radar,0-100 %,D-7002,»",
    ],
    expect: ["دو ابزار، هر کدام زیر لوپ تجهیز خودش؛ تلورانس از مشخصات پروژه (0.25 %)."],
    run: async (x) => {
      const r = await importInstrumentIndex(x.db, { projectId: x.P, text: [
        "Tag No,Service,Type,Range,Equipment,Tolerance",
        "FT-7001,DM water pump discharge flow,Magnetic flowmeter,0-40 m3/h,P-7001,",
        "LT-7002,DM water drum level,Guided wave radar,0-100 %,D-7002,",
      ].join("\n") });
      x.check(r.imported === 2, "two instruments imported");
      const { rows } = await x.db.query("SELECT id, tag_no, loop_no FROM instrument WHERE project_id = $1", [x.P]);
      for (const i of rows) { x.ids[i.tag_no] = i.id; x.ids[`loop-${i.tag_no}`] = i.loop_no; }
    },
  },
  {
    id: "6.5", phase: "6", who: "qc", title: "کالیبراسیون، نصب، هوک‌آپ، سیم‌بندی و لوپ چک",
    where: "ابزار دقیق › هر ابزار › «جزئیات»؛ لوپ‌ها › لوپ چک",
    do: [
      "کالیبراسیون روز 85 با «Fluke 754 / CAL-702»: FT-7001 «0:4.00 10:8.00 20:12.01 30:16.00 40:20.00»؛ LT-7002 «0:4.00 25:8.01 50:12.00 75:16.00 100:20.00»",
      "هر دو: نصب (95)، هوک‌آپ (96)، سیم‌بندی (97)",
      "لوپ چک هر لوپ در روز 103 با شاهد «Client» (مرجع LC-7001 و LC-7002)",
    ],
    expect: ["هر دو ابزار «آماده برای راه‌اندازی»؛ در زنجیرهٔ P-7001 و D-7002 «ابزار دقیق» از همین‌جا خوانده می‌شود."],
    run: async (x) => {
      const CAL = { "FT-7001": "0:4.00 10:8.00 20:12.01 30:16.00 40:20.00", "LT-7002": "0:4.00 25:8.01 50:12.00 75:16.00 100:20.00" };
      for (const [tag, points] of Object.entries(CAL)) {
        await recordCalibration(x.db, { projectId: x.P, instrumentId: x.ids[tag], points, calibratedOn: x.d(85), calibratorRef: "Fluke 754 / CAL-702", userId: x.users.qc });
        for (const [code, day] of [["installed", 95], ["hookup", 96], ["wired", 97]]) {
          await recordInstrumentActivity(x.db, { projectId: x.P, instrumentId: x.ids[tag], code, doneAt: x.d(day), contractorId: x.ids.cEi, userId: x.users.qc });
        }
      }
      const loops = [...new Set(["FT-7001", "LT-7002"].map((t) => x.ids[`loop-${t}`]).filter(Boolean))];
      x.check(loops.length === 2, `each instrument has its loop (${loops.join(", ")})`);
      for (const [k, loopNo] of loops.entries()) {
        await recordLoopCheck(x.db, { projectId: x.P, loopNo, checkedOn: x.d(103), refNo: `LC-700${k + 1}`, witnessedBy: "Client", userId: x.users.qc });
      }
      for (const tag of ["FT-7001", "LT-7002"]) {
        await recordInstrumentActivity(x.db, { projectId: x.P, instrumentId: x.ids[tag], code: "ready", doneAt: x.d(104), userId: x.users.qc });
      }
    },
  },

  // ── 7 ─────────────────────────────────────────────────────────────────
  {
    id: "7.1", phase: "7", who: "pm", title: "کنترل تنش لوله، الایمنت نهایی و آمادگی تجهیزات",
    where: "تجهیزات › P-7001 و D-7002 › ثبت مرحله",
    do: [
      "ببینید «اتصال پایپینگ»، «ترمینیشن برق» و «ابزار دقیق» خودشان انجام‌شده‌اند (از پکیج تست، کابل و لوپ).",
      "P-7001: کنترل تنش لوله و الایمنت نهایی (روز 104، STR-7001)؛ آمادگی راه‌اندازی (روز 105)",
      "D-7002: این خط از پمپ شروع می‌شود، پس «اتصال پایپینگ» درام دستی ثبت می‌شود (روز 99)؛ سپس آمادگی راه‌اندازی (روز 105)",
    ],
    expect: ["هر دو تگ «آماده»؛ در شناسنامهٔ تجهیز P-7001 همهٔ رشته‌ها سبز."],
    run: async (x) => {
      await recordActivity(x.db, { projectId: x.P, tagId: x.ids["P-7001"], code: "strain", doneAt: x.d(104), refNo: "STR-7001", userId: x.users.pm });
      await recordActivity(x.db, { projectId: x.P, tagId: x.ids["D-7002"], code: "piping", doneAt: x.d(99), refNo: "70-DMW-7001", userId: x.users.pm });
      for (const t of ["P-7001", "D-7002"]) {
        const st = await tagStatus(x.db, { projectId: x.P, tagId: x.ids[t] });
        for (const c of t === "P-7001" ? ["piping", "electrical", "instrument"] : ["instrument"]) {
          x.check(stepDone(st, c), `${t}: «${c}» reads done from its discipline`);
        }
        await recordActivity(x.db, { projectId: x.P, tagId: x.ids[t], code: "ready", doneAt: x.d(105), userId: x.users.pm });
      }
    },
  },
  {
    id: "7.2", phase: "7", who: "qc", title: "بازدید MC (Walk-down) و پانچ‌ها",
    where: "کیفیت و تکمیل › کیفیت و بازرسی › تب «Punch و NCR» › «+ ثبت Punch جدید»",
    do: [
      "A: «Coupling guard not installed» روی P-7001 · اقدام C-MEC · روز 106",
      "B: «Drum nameplate photo missing in dossier» روی D-7002 · اقدام C-MEC · روز 106",
      "C: «Touch-up paint at shoe SH-7002» روی ساب‌سیستم 70-01 · روز 106",
    ],
    expect: ["ساب‌سیستم 70-01: Punch A (مانع MC) = 1، A+B (مانع RFSU) = 2، C = 1."],
    run: async (x) => {
      const raise = (tag, category, description) => raisePunch(x.db, { projectId: x.P, subsystemId: tag ? null : x.ids.sub, tagId: tag ? x.ids[tag] : null,
        category, description, actionContractorId: x.ids.cMec, raisedOn: x.d(106), dueOn: x.d(110), userId: x.users.qc });
      x.ids.punchA = (await raise("P-7001", "A", "Coupling guard not installed")).id;
      x.ids.punchB = (await raise("D-7002", "B", "Drum nameplate photo missing in dossier")).id;
      x.ids.punchC = (await raise(null, "C", "Touch-up paint at shoe SH-7002")).id;
    },
  },
  {
    id: "7.3", phase: "7", who: "pm", title: "آزمون منفی: امضای MC با Punch A باز",
    where: "تکمیل و راه‌اندازی › تب «تست فشار و MC» › ساب‌سیستم 70-01 › «امضای MC»",
    do: ["دکمهٔ امضای MC را بزنید."],
    expect: ["دکمه غیرفعال است و ستون «باز» می‌گوید: «Punch A باز · 1 — Coupling guard not installed»؛ اگر از API هم بخواهید، رد می‌شود."],
    negative: true,
    run: async (x) => {
      const mc = await subsystemMc(x.db, { projectId: x.P, subsystemId: x.ids.sub });
      x.check(mc.blockers.length === 1 && mc.blockers[0].kind === "punch_a", `only the open punch A holds MC (${mc.blockers.map((b) => b.kind).join(", ")})`);
      await x.refused(() => signMc(x.db, { projectId: x.P, subsystemId: x.ids.sub, userId: x.users.pm }), /Punch|MC/);
    },
  },
  {
    id: "7.4", phase: "7", who: "qc", title: "رفع و تأیید پانچ A",
    where: "Punch و NCR › ردیف پانچ A › «رفع» (پیمانکار) سپس «تأیید» (بازرس)",
    do: ["رفع: «Guard fitted, photo attached» روز 107 (با حساب خودتان به‌جای سرپرست پیمانکار)", "تأیید: بازرس QC، روز 107"],
    expect: ["Punch A بسته؛ ستون «باز» ساب‌سیستم 70-01 در صفحهٔ MC خالی — «چیزی باز نیست»."],
    run: async (x) => {
      await punchAction(x.db, { projectId: x.P, punchId: x.ids.punchA, action: "clear", note: "Guard fitted, photo attached", onDate: x.d(107), userId: x.users.pm });
      await punchAction(x.db, { projectId: x.P, punchId: x.ids.punchA, action: "verify", onDate: x.d(107), userId: x.users.qc });
    },
  },
  {
    id: "7.5", phase: "7", who: "pm", title: "امضای MC و پذیرش کارفرما",
    where: "تست فشار و MC › 70-01 › «امضای MC»؛ سپس با حساب کارفرما «پذیرش کارفرما»",
    do: ["امضا: شما، روز 108.", "پذیرش: اول با حساب خودتان امتحان کنید، سپس نمایندهٔ کارفرما."],
    expect: [
      "پذیرش امضاکننده رد می‌شود (امضاکننده و پذیرنده دو نفرند).",
      "70-01: «MC پذیرفته — نمایندهٔ کارفرما»؛ Punch B و C به پیش‌راه‌اندازی منتقل می‌شوند.",
    ],
    run: async (x) => {
      await signMc(x.db, { projectId: x.P, subsystemId: x.ids.sub, userId: x.users.pm });
      await x.refused(() => acceptMc(x.db, { projectId: x.P, subsystemId: x.ids.sub, userId: x.users.pm }), /./);
      await acceptMc(x.db, { projectId: x.P, subsystemId: x.ids.sub, userId: x.users.client });
    },
  },

  // ── 8 ─────────────────────────────────────────────────────────────────
  {
    id: "8.1", phase: "8", who: "pm", title: "چک‌لیست‌های پیش‌راه‌اندازی و روال‌های راه‌اندازی",
    where: "کیفیت و تکمیل › تکمیل و راه‌اندازی › تب «پیش‌راه‌اندازی تا RFSU» › «+ چک‌لیست جدید»",
    do: [
      "B-PIP-01 «Line flushing with DM water & reinstatement» · پیش‌راه‌اندازی · خط · معیار «Clear water at outlet, no debris on temporary strainer»",
      "B-ROT-01 «Motor solo run & rotation check» · پیش‌راه‌اندازی · تجهیز دوّار · معیار «Rotation per arrow; vibration < 2.8 mm/s»",
      "C-ROT-01 «Pump run test on DM water, 4 h» · راه‌اندازی · تجهیز دوّار · معیار «Flow ≥ 30 m³/h at rated head; bearing temp < 80 °C»",
      "C-SUB-01 «Drum level control in automatic» · راه‌اندازی · ساب‌سیستم · معیار «LT-7002 holds 50 % ± 5 % for 30 min»",
    ],
    expect: ["سرِ صفحه: 2 چک‌لیست پیش‌راه‌اندازی · 2 روال راه‌اندازی."],
    run: async (x) => {
      for (const [code, title, appliesTo, phase, criteria] of [
        ["B-PIP-01", "Line flushing with DM water & reinstatement", "line", "precom", "Clear water at outlet, no debris on temporary strainer"],
        ["B-ROT-01", "Motor solo run & rotation check", "rotating", "precom", "Rotation per arrow; vibration < 2.8 mm/s"],
        ["C-ROT-01", "Pump run test on DM water, 4 h", "rotating", "commissioning", "Flow ≥ 30 m³/h at rated head; bearing temp < 80 °C"],
        ["C-SUB-01", "Drum level control in automatic", "subsystem", "commissioning", "LT-7002 holds 50 % ± 5 % for 30 min"],
      ]) {
        x.ids[code] = (await precom.upsertTemplate(x.db, { projectId: x.P, code, title, appliesTo, phase, criteria })).id;
      }
    },
  },
  {
    id: "8.2", phase: "8", who: "qc", title: "آزمون منفی: روال راه‌اندازی پیش از RFC",
    where: "پیش‌راه‌اندازی تا RFSU › ساب‌سیستم 70-01 › «جزئیات» › روال‌های راه‌اندازی",
    do: ["برای C-ROT-01 روی P-7001 نتیجهٔ «قبول» ثبت کنید."],
    expect: ["جای ثبت خالی است: «پس از پذیرش RFC ثبت می‌شود»؛ از API هم رد می‌شود."],
    negative: true,
    run: async (x) => {
      await x.refused(() => precom.recordAttempt(x.db, { projectId: x.P, subsystemId: x.ids.sub, templateId: x.ids["C-ROT-01"],
        itemRef: x.ids["P-7001"], result: "pass", performedOn: x.d(109), userId: x.users.qc, today: x.d(109) }), /RFC/);
    },
  },
  {
    id: "8.3", phase: "8", who: "qc", title: "پیش‌راه‌اندازی: فلاشینگ خط و سولو ران موتور",
    where: "همان پنل › چک‌لیست‌های پیش‌راه‌اندازی؛ پذیرش با حساب کارفرما",
    do: [
      "B-PIP-01 روی 70-DMW-7001: قبول (روز 109، شاهد «Client»)",
      "B-ROT-01 روی P-7001: اول «رد» با یادداشت «Reverse rotation — phases swapped at MCC» (روز 109)، بعد از جابه‌جایی فاز «قبول» (روز 110)",
      "نمایندهٔ کارفرما هر دو «قبول» را بپذیرد (ثبت‌کننده نمی‌پذیرد).",
    ],
    expect: ["سابقهٔ B-ROT-01 هر دو تلاش را نشان می‌دهد؛ ستون پیش‌راه‌اندازی 2/2؛ RFC: «چیزی باز نیست»."],
    run: async (x) => {
      const att = (templateId, itemRef, result, day, note = null) => precom.recordAttempt(x.db, { projectId: x.P, subsystemId: x.ids.sub, templateId,
        itemRef, result, performedOn: x.d(day), witnessedBy: "Client", note, userId: x.users.qc, today: x.d(day) });
      const a1 = await att(x.ids["B-PIP-01"], x.ids.line, "pass", 109);
      await att(x.ids["B-ROT-01"], x.ids["P-7001"], "fail", 109, "Reverse rotation — phases swapped at MCC");
      const a2 = await att(x.ids["B-ROT-01"], x.ids["P-7001"], "pass", 110);
      await x.refused(() => precom.acceptAttempt(x.db, { projectId: x.P, attemptId: a1.id, userId: x.users.qc }), /./);
      for (const a of [a1, a2]) await precom.acceptAttempt(x.db, { projectId: x.P, attemptId: a.id, userId: x.users.client });
    },
  },
  {
    id: "8.4", phase: "8", who: "pm", title: "RFC: امضا و پذیرش",
    where: "پیش‌راه‌اندازی تا RFSU › 70-01 › «جزئیات» › «امضای RFC»؛ پذیرش با حساب کارفرما",
    do: ["امضا: شما، روز 111 · پذیرش: نمایندهٔ کارفرما"],
    expect: ["ستون RFC: «پذیرفته»؛ حالا روال‌های راه‌اندازی قابل ثبت‌اند."],
    run: async (x) => {
      await precom.signRfc(x.db, { projectId: x.P, subsystemId: x.ids.sub, userId: x.users.pm });
      await precom.acceptRfc(x.db, { projectId: x.P, subsystemId: x.ids.sub, userId: x.users.client });
    },
  },
  {
    id: "8.5", phase: "8", who: "qc", title: "راه‌اندازی: ران تست پمپ و کنترل سطح درام",
    where: "همان پنل › روال‌های راه‌اندازی",
    do: [
      "C-ROT-01 روی P-7001: قبول (روز 114، «Flow 32 m³/h, bearing 61 °C»)",
      "C-SUB-01 روی 70-01: قبول (روز 115)",
      "پذیرش هر دو: نمایندهٔ کارفرما",
    ],
    expect: ["ستون راه‌اندازی 2/2."],
    run: async (x) => {
      const att = (templateId, itemRef, day, note = null) => precom.recordAttempt(x.db, { projectId: x.P, subsystemId: x.ids.sub, templateId,
        itemRef, result: "pass", performedOn: x.d(day), witnessedBy: "Client", note, userId: x.users.qc, today: x.d(day) });
      const a = await att(x.ids["C-ROT-01"], x.ids["P-7001"], 114, "Flow 32 m3/h, bearing 61 °C");
      const b = await att(x.ids["C-SUB-01"], x.ids.sub, 115);
      for (const t of [a, b]) await precom.acceptAttempt(x.db, { projectId: x.P, attemptId: t.id, userId: x.users.client });
    },
  },
  {
    id: "8.6", phase: "8", who: "pm", title: "آزمون منفی: RFSU با Punch B باز",
    where: "پیش‌راه‌اندازی تا RFSU › 70-01 › «امضای RFSU»",
    do: ["RFSU را امضا کنید."],
    expect: ["رد می‌شود: «RFSU امضا نمی‌شود — باز: Punch A/B باز (1)» — پانچ B درام («Drum nameplate photo missing in dossier») RFSU را نگه داشته است."],
    negative: true,
    run: async (x) => {
      await x.refused(() => precom.signRfsu(x.db, { projectId: x.P, subsystemId: x.ids.sub, userId: x.users.pm }), /Punch A\/B باز \(1\)/);
    },
  },
  {
    id: "8.7", phase: "8", who: "pm", title: "بستن Punch B و RFSU",
    where: "Punch و NCR › پانچ B › رفع و تأیید؛ سپس پیش‌راه‌اندازی تا RFSU › «امضای RFSU» و پذیرش کارفرما",
    do: ["رفع: «Photo added to dossier» (روز 116)، تأیید: بازرس QC", "RFSU: امضا روز 117 (شما)، پذیرش (نمایندهٔ کارفرما)"],
    expect: ["70-01: RFSU پذیرفته — سیستم آمادهٔ راه‌اندازی با سیال فرایندی است. Punch C باز می‌ماند و به تحویل می‌رود."],
    run: async (x) => {
      await punchAction(x.db, { projectId: x.P, punchId: x.ids.punchB, action: "clear", note: "Photo added to dossier", onDate: x.d(116), userId: x.users.pm });
      await punchAction(x.db, { projectId: x.P, punchId: x.ids.punchB, action: "verify", onDate: x.d(116), userId: x.users.qc });
      await precom.signRfsu(x.db, { projectId: x.P, subsystemId: x.ids.sub, userId: x.users.pm });
      await precom.acceptRfsu(x.db, { projectId: x.P, subsystemId: x.ids.sub, userId: x.users.client });
    },
  },

  // ── 9 ─────────────────────────────────────────────────────────────────
  {
    id: "9.0", phase: "9", who: "pm", title: "دفترچهٔ O&M فروشنده (IOM)",
    where: "خرید و پیگیری › PO-7001 › «جزئیات» › مدارک فروشنده",
    do: ["مدرک با کد دقیقاً «IOM» · «Operation and maintenance manual» · مهلت روز 110 · ارسال Rev.0 روز 105 · برگشت کد 1 روز 108"],
    expect: ["در «تحویل به نگهداری»، ردیف P-7001 دیگر «دفترچهٔ O&M فروشنده (IOM)» را کم ندارد — تحویل به نگهداری بدون دفترچهٔ فروشنده ممکن نیست."],
    run: async (x) => {
      const d = await prc.addVendorDoc(x.db, { projectId: x.P, poId: x.ids.po, docCode: "IOM", title: "Operation and maintenance manual", dueOn: x.d(110) });
      await prc.submitDoc(x.db, { projectId: x.P, docId: d.id, revision: "0", submittedOn: x.d(105), userId: x.users.pm });
      await prc.returnDoc(x.db, { projectId: x.P, docId: d.id, returnedOn: x.d(108), code: 1 });
    },
  },
  {
    id: "9.1", phase: "9", who: "pm", title: "شناسنامهٔ نگهداری پمپ (Asset Master)",
    where: "کیفیت و تکمیل › تکمیل و راه‌اندازی › تب «تحویل به نگهداری» › ردیف P-7001 › «ویرایش»",
    do: [
      "کلاس ISO 14224: PU · بحرانیت A · مبنا «CA-DMW-01 (boiler feed make-up, single pump)»",
      "سازنده «Pump Maker A» · مدل «ISO 2858 end-suction 50-32-200» · سریال «PMA-24-7001» · سال 2026",
      "شرایط طراحی: 16 barg، 5 تا 60 °C · رویژن دیتاشیت: DMW-DS-P-7001 Rev.0",
      "شناسه‌های DCS/Historian: «Discharge flow» 70FT7001.PV / DMW:70FT7001.PV (m³/h) و «Run status» P7001_RUN.STS",
    ],
    expect: ["شرایط طراحی فقط با رویژن دیتاشیتِ همین تگ پذیرفته می‌شود؛ شناسنامهٔ تجهیز P-7001 همهٔ این‌ها را نشان می‌دهد."],
    run: async (x) => {
      const revs = await datasheetRevisions(x.db, { projectId: x.P, tagId: x.ids["P-7001"] });
      const r0 = (revs.revisions || revs).find((r) => String(r.revision) === "0" && (r.docNo || r.doc_no) === "DMW-DS-P-7001");
      x.check(!!r0, "the pump's IFC datasheet revision is offered for its design conditions");
      await setAssetMaster(x.db, { projectId: x.P, tagId: x.ids["P-7001"], isoClass: "PU", criticality: "A",
        criticalityBasis: "CA-DMW-01 (boiler feed make-up, single pump)", manufacturer: "Pump Maker A", model: "ISO 2858 end-suction 50-32-200",
        serialNo: "PMA-24-7001", yearBuilt: 2026, designPressureBarg: 16, designTempMinC: 5, designTempMaxC: 60,
        datasheetRevisionId: r0.id, userId: x.users.pm });
      await addDcsPoint(x.db, { projectId: x.P, tagId: x.ids["P-7001"], label: "Discharge flow", dcsTag: "70FT7001.PV",
        historianTag: "DMW:70FT7001.PV", uom: "m3/h", userId: x.users.pm });
      await addDcsPoint(x.db, { projectId: x.P, tagId: x.ids["P-7001"], label: "Run status", dcsTag: "P7001_RUN.STS", userId: x.users.pm });
      await setAssetMaster(x.db, { projectId: x.P, tagId: x.ids["D-7002"], isoClass: "VE", criticality: "B",
        criticalityBasis: "CA-DMW-01", manufacturer: "Local fabricator", userId: x.users.pm });
    },
  },
  {
    id: "9.2", phase: "9", who: "qc", title: "برنامهٔ PM و قطعات یدکی",
    where: "تحویل به نگهداری › تب «برنامهٔ PM» و «قطعات یدکی (SPIR)»",
    do: [
      "PM-01 «Bearing lubrication» · زمانی · هر 3 ماه · مکانیک · 1 ساعت · منبع: دستورالعمل سازنده «IOM PMA §6.2» — پیش‌نویس توسط بازرس QC، تأیید توسط شما",
      "یدکی: «MS-50-PMA» سیل مکانیکی · دسته راه‌اندازی · نصب 1، پیشنهاد 1، تأیید 1 · SPIR «SPIR-P-7001»",
    ],
    expect: ["PM-01 «تأییدشده»؛ قطعهٔ یدکی در فهرست SPIR پمپ."],
    run: async (x) => {
      const t = await mnt.savePmTask(x.db, { projectId: x.P, tagId: x.ids["P-7001"], taskCode: "PM-01", title: "Bearing lubrication", strategy: "time_based",
        intervalValue: 3, intervalUnit: "month", craft: "mechanical", durationH: 1, source: "oem", sourceRef: "IOM PMA §6.2", userId: x.users.qc });
      await mnt.approvePmTask(x.db, { projectId: x.P, taskId: t.id, userId: x.users.pm });
      await mnt.saveSpare(x.db, { projectId: x.P, tagId: x.ids["P-7001"], partNo: "MS-50-PMA", manufacturer: "Pump Maker A",
        description: "Mechanical seal cartridge", category: "commissioning", qtyInstalled: 1, qtyRecommended: 1, qtyApproved: 1,
        spirRef: "SPIR-P-7001", userId: x.users.pm });
    },
  },
  {
    id: "9.3", phase: "9", who: "pm", title: "خروجی تحویل به CMMS",
    where: "تحویل به نگهداری › «خروجی»",
    do: ["خروجی CSV را بگیرید."],
    expect: [
      "P-7001 با مکان عملیاتی DMW-70-P-7001 و «ready = yes».",
      "D-7002 هنوز «no»: مدل، سریال و دفترچهٔ فروشنده ندارد — خروجی می‌گوید چه چیزی کم است، به‌جای این‌که خالی بگذارد.",
    ],
    run: async (x) => {
      const out = await exportHandover(x.db, { projectId: x.P, readyOnly: false, userId: x.users.pm });
      const row = out.csv.split("\n").find((l) => l.includes("P-7001"));
      x.check(row && /"yes"/.test(row), `the pump is ready in the handover export: ${row}`);
      const drum = out.csv.split("\n").find((l) => l.includes("D-7002"));
      x.check(drum && /"no"/.test(drum), "the drum is exported as not ready, with what it lacks");
    },
  },
  {
    id: "9.4", phase: "9", who: "pm", title: "آزمون عملکرد: ظرفیت پمپ طبق قرارداد",
    where: "تکمیل و راه‌اندازی › پیش‌راه‌اندازی تا RFSU › تب «تضمین‌های عملکرد» و «آزمون عملکرد»",
    do: [
      "تضمین PG-01 · «DM water transfer capacity at rated head» · واحد 70 · m3/h · دست‌کم 30 · حداقل مدت 4 ساعت · بند «PO-7001 Annex B §2»",
      "آزمون PT-7001 · واحد 70 · از روز 120 ساعت 8 تا روز 120 ساعت 14 · نتیجهٔ PG-01: 32 («Magflow FT-7001 average»)",
      "امضا: شما · پذیرش: نمایندهٔ کارفرما",
    ],
    expect: ["PG-01 «برآورده · 32»؛ پیش از RFSU این آزمون ثبت نمی‌شد."],
    run: async (x) => {
      const g = await pf.upsertGuarantee(x.db, { projectId: x.P, code: "PG-01", parameter: "DM water transfer capacity at rated head", unitId: x.ids.unit,
        uom: "m3/h", direction: "min", guaranteedValue: 30, minDurationH: 4, basis: "PO-7001 Annex B §2" });
      const t = await pf.recordTest(x.db, { projectId: x.P, testNo: "PT-7001", unitId: x.ids.unit, startedAt: x.at(120, 8), endedAt: x.at(120, 14),
        note: "After RFSU", userId: x.users.pm });
      await pf.recordResult(x.db, { projectId: x.P, testId: t.id, guaranteeId: g.id, measured: 32, method: "Magflow FT-7001 average" });
      await pf.signTest(x.db, { projectId: x.P, testId: t.id, userId: x.users.pm });
      await pf.acceptTest(x.db, { projectId: x.P, testId: t.id, userId: x.users.client });
      const b = await pf.performanceBoard(x.db, { projectId: x.P });
      x.check(b.status.find((s) => s.code === "PG-01")?.status === "met", "PG-01 is met on the accepted test");
    },
  },
];

/** Whether a chain step of a tag's status is done (tagStatus → steps). */
function stepDone(status, code) {
  const st = (status.steps || status.chain || []).find((c) => c.code === code);
  return !!st && (st.state === "done" || st.done === true || st.status === "done");
}

/** The items of a transmittal, by document number. */
async function itemsOf(x, transmittalId) {
  const { rows } = await x.db.query(
    `SELECT i.id, d.doc_no FROM transmittal_item i JOIN mdr_revision r ON r.id = i.revision_id JOIN mdr_document d ON d.id = r.mdr_id
      WHERE i.transmittal_id = $1`, [transmittalId]);
  return Object.fromEntries(rows.map((r) => [r.doc_no, r.id]));
}

/** Steps up to and including `id` ("7.3"), in order. */
export function stepsUpTo(id) {
  if (!id) return STEPS;
  const k = STEPS.findIndex((s) => s.id === id);
  if (k < 0) throw new Error(`no step ${id}; the steps are ${STEPS.map((s) => s.id).join(", ")}`);
  return STEPS.slice(0, k + 1);
}
