/** Put believable data in the demo project so the screens can be judged. */
import "./env.mjs";
import { getDb } from "../lib/server/db.mjs";
import { withProject } from "../lib/db/scope.mjs";
import { listProjectsForUser, ensureUser, updateProjectProfile } from "../lib/db/repos/projects.mjs";
import { upsertContractor, upsertPackage } from "../lib/db/repos/contractors.mjs";
import { parseEquipmentList } from "../lib/equipment/parse.mjs";
import { importEquipmentList } from "../lib/db/repos/equipment.mjs";
import { upsertSubsystem } from "../lib/db/repos/spine.mjs";

const db = await getDb();
try {
  const user = await ensureUser(db, { subject: "local|sadegh@kavian.ir" });
  const [p] = await listProjectsForUser(db, user.id);
  await updateProjectProfile(db, { projectId: p.id, patch: {
    name: "واحد ۲۱ — توسعهٔ الفین", client_name: "پتروشیمی کاویان",
    consultant_name: "مهندسی و توسعهٔ صنایع", contractor_name: "کنسرسیوم EPC",
    contract_no: "K110-EPC-2026-003", contract_date: "2026-02-11",
    contract_value: 48500000, contract_currency: "EUR",
    site_location: "عسلویه — منطقهٔ پارس جنوبی",
    start_date: "2026-03-01", planned_end_date: "2028-09-30",
    description: "احداث واحد الفین شامل پایپینگ، سیویل، استراکچر فلزی، برق و ابزار دقیق.",
  }});

  await withProject(db, p.id, async () => {
    for (const s of [["21-01", "خوراک کوره", 1, "2027-06-01"],
                     ["21-02", "بازیافت حرارت", 2, "2027-08-15"],
                     ["22-01", "فشردهٔ گاز", 3, "2027-11-30"]]) {
      await upsertSubsystem(db, { projectId: p.id, code: s[0], name: s[1],
        handoverSeq: s[2], targetMcDate: s[3] });
    }

    const sazeh = await upsertContractor(db, { projectId: p.id, code: "C-01",
      name: "سازه پاد جنوب", disciplines: ["civil", "structural"],
      contactName: "مهندس احمدی", contactPhone: "0917-000-0000",
      prequalifiedUntil: "2027-04-30" });
    const nasb = await upsertContractor(db, { projectId: p.id, code: "C-02",
      name: "نصب گستر پارس", disciplines: ["piping", "equipment"],
      contactName: "مهندس رضایی", prequalifiedUntil: "2026-05-01" });
    await upsertContractor(db, { projectId: p.id, code: "C-03",
      name: "برق و کنترل آریا", disciplines: ["electrical", "instrumentation"],
      status: "prospective", prequalifiedUntil: "2028-01-01" });

    const subs = (await db.query("SELECT id, code FROM subsystem WHERE project_id = $1", [p.id])).rows;
    const byCode = Object.fromEntries(subs.map((s) => [s.code, s.id]));

    await upsertPackage(db, { projectId: p.id, contractorId: sazeh.id, code: "PKG-CIV-01",
      title: "فونداسیون واحد ۲۱", discipline: "civil",
      value: 4200000, currency: "EUR", startDate: "2026-04-01", endDate: "2027-02-28" });
    await upsertPackage(db, { projectId: p.id, contractorId: sazeh.id, code: "PKG-STR-01",
      title: "اسکلت فلزی ۲۱-۰۱", discipline: "structural", subsystemId: byCode["21-01"],
      value: 6800000, currency: "EUR" });
    await upsertPackage(db, { projectId: p.id, contractorId: nasb.id, code: "PKG-PIP-01",
      title: "پایپینگ واحد ۲۱", discipline: "piping",
      value: 11500000, currency: "EUR" });
    await upsertPackage(db, { projectId: p.id, contractorId: nasb.id, code: "PKG-EQP-01",
      title: "نصب تجهیزات دوّار", discipline: "equipment", subsystemId: byCode["22-01"],
      value: 3100000, currency: "EUR" });

    const list = `Tag No,Description,Type,Subsystem,Unit
P-2101A,Feed Pump,Centrifugal,21-01,21
P-2101B,Feed Pump (spare),Centrifugal,21-01,21
V-2101,Feed Surge Drum,Vertical,21-01,21
E-2102,Feed/Effluent Exchanger,Shell & Tube,21-02,21
EA-2103,Product Air Cooler,Fin-Fan,21-02,21
T-2104,Quench Tower,Packed Column,21-02,21
K-2201,Recycle Compressor,Centrifugal,22-01,22
V-2202,Suction Knock-Out Drum,Vertical,22-01,22
PK-2203,Seal Gas Package,Package,22-01,22
TOTAL,,,,`;
    const parsed = parseEquipmentList(list);
    const report = await importEquipmentList(db, { projectId: p.id, tags: parsed.tags, userId: user.id });
    console.log("equipment:", report.created, "created,", report.unclassified.length, "unclassified");
  });
  console.log("demo project seeded:", p.code);
} finally { await db.close(); }
