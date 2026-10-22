/**
 * The menu in English and Arabic: groups by their Persian name, sections by
 * key, pages by address. Persian is navigation.mjs itself — one place for it,
 * no copy here to drift.
 */
const GROUPS = {
  "پروژه": { en: "Project", ar: "المشروع" },
  "اجرا": { en: "Execution", ar: "التنفيذ" },
  "کیفیت و تکمیل": { en: "Quality & completion", ar: "الجودة والإنجاز" },
  "مدیریت پروژه": { en: "Project management", ar: "إدارة المشروع" },
  "قرارداد، مالی و منابع انسانی": { en: "Contracts, finance & HR", ar: "العقود والمالية والموارد البشرية" },
};

const SECTIONS = {
  home: { en: ["Workspace", "Project at a glance"], ar: ["مساحة العمل", "نظرة عامة على المشروع"] },
  project: { en: ["Project", "Particulars, companies and parties, contractors, subsystems, assumptions and users"],
    ar: ["المشروع", "البيانات، الشركات والأطراف، المقاولون، الأنظمة الفرعية، الافتراضات والمستخدمون"] },
  asset: { en: ["Asset record", "One tag, every discipline"], ar: ["سجل المعدة", "وسم واحد، كل التخصصات"] },
  site: { en: ["Site & labels", "Offline recording with QR and label printing"], ar: ["الموقع والملصقات", "تسجيل دون اتصال برمز QR وطباعة الملصقات"] },
  workplan: { en: ["Work front & handover", "Startable work by material, contractor handover, work orders, TQ and site changes"],
    ar: ["جبهة العمل والتسليم", "الأعمال القابلة للبدء حسب المواد، تسليم المقاول، أوامر العمل، الاستفسارات الفنية وتغييرات الموقع"] },
  handover: { en: ["Handover forms", "Forms each section's supervision designs; workflow, signatures and printing of each day's accepted work"],
    ar: ["نماذج التسليم", "نماذج يصممها إشراف كل قسم؛ سير العمل والتوقيع وطباعة أعمال كل يوم المستلمة"] },
  piping: { en: ["Piping", "Isometrics, weld register, execution, NDT and weld history"], ar: ["الأنابيب", "الرسومات الأيزومترية، سجل اللحامات، التنفيذ، الفحص غير الإتلافي وتاريخ اللحام"] },
  civil: { en: ["Civil & structure", "Foundations and concrete, pipe racks and steelwork"], ar: ["المدني والإنشائي", "الأساسات والخرسانة، حوامل الأنابيب والهياكل"] },
  mechanical: { en: ["Equipment, coating & insulation", "Tags and erection chain, surface preparation, DFT and insulation"],
    ar: ["المعدات والدهان والعزل", "الوسوم وسلسلة التركيب، تحضير السطح، سماكة الطلاء والعزل"] },
  ei: { en: ["Electrical & instrumentation", "Cable, termination, IR, calibration and loops"], ar: ["الكهرباء والأجهزة الدقيقة", "الكابلات، التوصيل، مقاومة العزل، المعايرة والحلقات"] },
  quality: { en: ["Quality & inspection", "ITP and IR, structural and equipment NDT, punch and NCR"], ar: ["الجودة والتفتيش", "خطة التفتيش وطلباته، فحص الهياكل والمعدات، قوائم النواقص وتقارير عدم المطابقة"] },
  completions: { en: ["Completion & commissioning", "Testing and MC, pre-commissioning to RFSU and performance test, handover"],
    ar: ["الإنجاز والتشغيل", "الاختبار والإنجاز الميكانيكي، ما قبل التشغيل حتى الجاهزية واختبار الأداء، التسليم"] },
  controls: { en: ["Planning & project control", "EPS and PMS, WBS and activities (P6), plan import, daily progress, EVM on the WBS, risk and KPIs"],
    ar: ["التخطيط ومراقبة المشروع", "EPS وPMS، هيكل تجزئة العمل والأنشطة (P6)، استيراد الخطة، الإنجاز اليومي، القيمة المكتسبة، المخاطر ومؤشرات الأداء"] },
  sitereports: { en: ["Daily report", "Each contract's daily report, reviewed, signed and approved stage by stage"],
    ar: ["التقرير اليومي", "التقرير اليومي لكل عقد مع المراجعة والتوقيع والاعتماد مرحلة بمرحلة"] },
  supply: { en: ["Procurement & warehouse", "MR and PO, expediting, receipt, MIR/MTC and issue"], ar: ["المشتريات والمستودع", "طلبات المواد وأوامر الشراء، المتابعة، الاستلام، فحص المواد والصرف"] },
  documents: { en: ["Documents", "Register, revisions, transmittals and comments"], ar: ["الوثائق", "السجل، المراجعات، المراسلات والتعليقات"] },
  hse: { en: ["HSE", "Incidents, permits to work, safe work and observations"], ar: ["الصحة والسلامة والبيئة", "الحوادث، تصاريح العمل، العمل الآمن والملاحظات"] },
  contracts: { en: ["Contracts & subcontracts", "Contracts, pay items on the WBS, resources and library, PDMS quantities and statements"],
    ar: ["العقود والمقاولات الفرعية", "العقود، بنود الدفع على هيكل تجزئة العمل، الموارد والمكتبة، كميات التصميم والمستخلصات"] },
  finance: { en: ["Finance", "Committed, approved, paid — by contract, WBS and month"], ar: ["المالية", "الملتزم به والمعتمد والمدفوع — حسب العقد وهيكل العمل والشهر"] },
  hr: { en: ["Human resources", "Personnel, mobilisation and daily timesheets on the WBS"], ar: ["الموارد البشرية", "الأفراد، الحضور والمغادرة، ساعات العمل اليومية على هيكل العمل"] },
};

const TABS = {
  "/": { en: "Workspace", ar: "مساحة العمل" },
  "/project": { en: "Project particulars", ar: "بيانات المشروع" },
  "/organization": { en: "Companies, stakeholders & budget", ar: "الشركات وأصحاب المصلحة والميزانية" },
  "/contractors": { en: "Contractors: qualification & scope", ar: "المقاولون: التأهيل ونطاق العمل" },
  "/subsystems": { en: "Systems & subsystems", ar: "الأنظمة والأنظمة الفرعية" },
  "/assumptions": { en: "Assumptions & missing information", ar: "الافتراضات والمعلومات الناقصة" },
  "/reference": { en: "EPC reference: phases, deliverables, handover & standards", ar: "مرجع EPC: المراحل والوثائق والتسليم والمعايير" },
  "/admin": { en: "Users & access", ar: "المستخدمون والصلاحيات" },
  "/asset": { en: "Asset record", ar: "سجل المعدة" },
  "/field": { en: "Site (offline)", ar: "الموقع (دون اتصال)" },
  "/labels": { en: "QR labels", ar: "ملصقات QR" },
  "/workfront": { en: "Work front", ar: "جبهة العمل" },
  "/work-approval": { en: "Contractor work handover", ar: "تسليم أعمال المقاول" },
  "/changes": { en: "Work orders, TQ & changes", ar: "أوامر العمل والاستفسارات والتغييرات" },
  "/forms": { en: "Form design", ar: "تصميم النماذج" },
  "/piping/overview": { en: "Dashboard", ar: "لوحة المعلومات" },
  "/piping": { en: "Isometrics & weld register", ar: "الأيزومتري وسجل اللحامات" },
  "/piping/execution": { en: "Execution: spools & supports", ar: "التنفيذ: الوصلات والدعامات" },
  "/piping/welding": { en: "Welding & NDT", ar: "اللحام والفحص غير الإتلافي" },
  "/qc": { en: "NDT dashboard", ar: "لوحة الفحص غير الإتلافي" },
  "/piping/joint": { en: "Weld history", ar: "تاريخ اللحام" },
  "/piping/reports": { en: "Reports, loads & labels", ar: "التقارير والشحنات والملصقات" },
  "/civil": { en: "Civil", ar: "المدني" },
  "/structural": { en: "Structural", ar: "الإنشائي" },
  "/equipment": { en: "Equipment", ar: "المعدات" },
  "/coating": { en: "Coating & insulation", ar: "الدهان والعزل" },
  "/electrical": { en: "Electrical", ar: "الكهرباء" },
  "/instrumentation": { en: "Instrumentation", ar: "الأجهزة الدقيقة" },
  "/inspection": { en: "Inspection (ITP & IR)", ar: "التفتيش (ITP وIR)" },
  "/ndt-joints": { en: "Structural, support & equipment NDT", ar: "فحص الهياكل والدعامات والمعدات" },
  "/quality": { en: "Punch & NCR", ar: "النواقص وعدم المطابقة" },
  "/completions": { en: "Pressure test & MC", ar: "اختبار الضغط والإنجاز الميكانيكي" },
  "/precom": { en: "Pre-commissioning to RFSU", ar: "ما قبل التشغيل حتى الجاهزية" },
  "/handover": { en: "Handover to maintenance", ar: "التسليم للصيانة" },
  "/eps": { en: "EPS & PMS", ar: "EPS وPMS" },
  "/eps/wbs": { en: "WBS & activities", ar: "هيكل تجزئة العمل والأنشطة" },
  "/eps/activities": { en: "Activities (P6)", ar: "الأنشطة (P6)" },
  "/eps/templates": { en: "Activity templates", ar: "قوالب الأنشطة" },
  "/eps/codes": { en: "Activity codes", ar: "رموز الأنشطة" },
  "/eps/scope": { en: "Platform scope", ar: "نطاق المنصة" },
  "/eps/planning": { en: "Planning — the version's plan", ar: "Planning — خطة النسخة" },
  "/eps/progress": { en: "Daily progress", ar: "الإنجاز اليومي" },
  "/eps/progress/days": { en: "Work over days", ar: "أعمال عدة أيام" },
  "/controls": { en: "EVM & risk", ar: "القيمة المكتسبة والمخاطر" },
  "/reports": { en: "Reports & KPIs", ar: "التقارير ومؤشرات الأداء" },
  "/contract-reports": { en: "Contract daily report", ar: "التقرير اليومي للعقد" },
  "/report-setup": { en: "Workflow setup", ar: "إعداد سير العمل" },
  "/report-print-setup": { en: "Print layout", ar: "قالب الطباعة" },
  "/signature": { en: "My signature", ar: "توقيعي" },
  "/procurement": { en: "Procurement & expediting", ar: "الشراء والمتابعة" },
  "/warehouse": { en: "Warehouse & materials", ar: "المستودع والمواد" },
  "/documents": { en: "Register & review", ar: "السجل والمراجعة" },
  "/documents/intake": { en: "Document intake", ar: "قراءة الوثائق" },
  "/documents/designer": { en: "Designer portal", ar: "بوابة المصمم" },
  "/hse": { en: "HSE", ar: "الصحة والسلامة والبيئة" },
  "/contracts": { en: "Contracts & subcontracts", ar: "العقود والمقاولات الفرعية" },
  "/contracts/setup": { en: "Contract setup: currency, budget, amendments & categories", ar: "إعداد العقد: العملة والميزانية والملاحق والفئات" },
  "/contracts/resources": { en: "Contract resources & library", ar: "موارد العقد والمكتبة" },
  "/contracts/statements": { en: "Payment statements", ar: "المستخلصات" },
  "/contracts/design": { en: "Design quantities (PDMS)", ar: "كميات التصميم (PDMS)" },
  "/finance": { en: "Finance", ar: "المالية" },
  "/hr": { en: "Human resources", ar: "الموارد البشرية" },
  "/account": { en: "Settings", ar: "الإعدادات" },
};
const LOG = { en: "Log & workflow", ar: "السجل وسير العمل" };

export const navGroup = (lang, fa) => (lang === "fa" ? fa : GROUPS[fa]?.[lang] || fa);
export const navSection = (lang, key, fa, faDesc) => {
  if (lang === "fa") return [fa, faDesc];
  const s = SECTIONS[key]?.[lang];
  return s ? s : [fa, faDesc];
};
export const navTab = (lang, href, fa) => {
  if (lang === "fa") return fa;
  if (href.startsWith("/log/")) return LOG[lang] || fa;
  return TABS[href]?.[lang] || fa;
};
/** For the coverage test: every page and section of the menu is in both languages. */
export const NAV_I18N = { GROUPS, SECTIONS, TABS };

/** A menu from navigationFor() in a language. Each group keeps `group` (its Persian name, the key folded groups are remembered by) and gains `label`. */
export function localizeNav(nav, lang) {
  return nav.map((g) => ({
    ...g,
    label: navGroup(lang, g.group),
    items: g.items.map((s) => {
      const [title, desc] = navSection(lang, s.key, s.title, s.desc);
      return { ...s, title, desc, tabs: s.tabs.map((t) => ({ ...t, title: navTab(lang, t.href, t.title) })) };
    }),
  }));
}
