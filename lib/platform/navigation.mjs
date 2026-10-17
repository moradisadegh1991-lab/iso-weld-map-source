/**
 * The menu, the section tabs and the launchpad, declared once.
 *
 * One list drives the left menu, the tabs across the top of a page, the home
 * tiles and the breadcrumb, because hand-maintained copies is how a
 * platform ends up with a menu entry that leads nowhere and a page nothing
 * links to.
 *
 * The menu holds SECTIONS, not pages: a section is one piece of work
 * (piping, civil and structure, quality…) and its pages are its TABS. A tab
 * keeps its own address, so links, bookmarks and QR codes to a page keep
 * working; the menu entry opens the first tab the person may see.
 *
 * `need` names the ACTION a person must hold to see a tab, resolved through
 * lib/authz.mjs, and `area` the work area it belongs to (lib/platform/
 * areas.mjs). A section shows when any of its tabs does, and only those.
 */
import { ACTIONS } from "../authz.mjs";
import { inArea } from "./areas.mjs";

const V = ACTIONS.VIEW_PROJECT;

export const SECTIONS = [
  {
    group: "پروژه", icon: "▦",
    items: [
      { key: "home", icon: "▦", title: "میز کار", desc: "نمای کلی پروژه",
        tabs: [{ href: "/", title: "میز کار", need: V }] },
      { key: "project", icon: "▤", title: "پروژه", desc: "مشخصات، شرکت‌ها و طرفین، پیمانکاران، ساب‌سیستم‌ها، فرضیات و کاربران",
        tabs: [
          { href: "/project", title: "مشخصات پروژه", need: V },
          { href: "/organization", title: "شرکت‌ها، ذی‌نفعان و بودجه", need: V },
          { href: "/contractors", title: "پیمانکاران: صلاحیت و محدودهٔ کار", need: V },
          { href: "/subsystems", title: "سیستم و ساب‌سیستم", need: V },
          { href: "/assumptions", title: "فرضیات و اطلاعات ناقص", need: V },
          { href: "/reference", title: "مرجع EPC: فازها، مدارک، تحویل و استانداردها", need: V },
          { href: "/admin", title: "کاربران و دسترسی", need: ACTIONS.MANAGE_MEMBERS },
        ] },
      { key: "asset", icon: "◉", title: "شناسنامهٔ تجهیز", desc: "یک تگ، همهٔ رشته‌ها",
        tabs: [{ href: "/asset", title: "شناسنامهٔ تجهیز", need: V }] },
      { key: "site", icon: "⌖", title: "سایت و برچسب", desc: "ثبت آفلاین با QR و چاپ برچسب",
        tabs: [
          { href: "/field", title: "سایت (آفلاین)", need: V },
          { href: "/labels", title: "برچسب QR", need: V },
        ] },
    ],
  },
  {
    group: "اجرا", icon: "⚒",
    items: [
      { key: "workplan", icon: "⚑", title: "جبهه کاری و تحویل کار", desc: "کار قابل شروع بر اساس مواد، تحویل کار پیمانکار، دستور کار، TQ و تغییرات سایت",
        tabs: [
          { href: "/workfront", title: "جبههٔ کاری", need: V },
          { href: "/work-approval", title: "تحویل کار پیمانکار", need: V },
          { href: "/changes", title: "دستور کار، TQ و تغییرات", need: V },
        ] },
      { key: "handover", icon: "⇄", title: "فرم‌های تحویل کار", desc: "فرم‌هایی که نظارت کارفرمای هر بخش طراحی می‌کند؛ گردش کار، امضا و چاپ کارهای تحویل‌گرفتهٔ هر روز",
        // each form a section's supervision designs is a tile of its own here (formTabs), given to people one by one
        tabs: [{ href: "/forms", title: "طراحی فرم‌ها", need: V, designer: true }] },
      { key: "piping", icon: "⟜", title: "پایپینگ", desc: "ایزومتریک، رجیستر جوش، اجرا، NDT و سابقهٔ جوش",
        tabs: [
          { href: "/piping/overview", title: "داشبورد", need: V, area: "piping" },
          { href: "/piping", title: "ایزومتریک و رجیستر جوش", need: V, area: "piping" },
          { href: "/piping/execution", title: "اجرا: اسپول و ساپورت", need: V, area: "piping" },
          { href: "/piping/welding", title: "جوشکاری و NDT", need: V, area: "piping" },
          { href: "/qc", title: "داشبورد NDT", need: ACTIONS.RECORD_NDT, area: "quality" },
          { href: "/piping/joint", title: "سابقهٔ جوش", need: V, area: "piping" },
        ] },
      { key: "civil", icon: "▩", title: "سیویل و سازه", desc: "فونداسیون و بتن، پایپ رک و اسکلت",
        tabs: [
          { href: "/civil", title: "سیویل", need: V, area: "civil" },
          { href: "/structural", title: "استراکچر", need: V, area: "structural" },
        ] },
      { key: "mechanical", icon: "⚙", title: "تجهیزات، رنگ و عایق", desc: "تگ‌ها و زنجیرهٔ نصب، آماده‌سازی سطح، DFT و عایق",
        tabs: [
          { href: "/equipment", title: "تجهیزات", need: V, area: "equipment" },
          { href: "/coating", title: "رنگ و عایق", need: V, area: "coating" },
        ] },
      { key: "ei", icon: "⌁", title: "برق و ابزار دقیق", desc: "کابل، ترمینیشن، IR، کالیبراسیون و لوپ",
        tabs: [
          { href: "/electrical", title: "برق", need: V, area: "electrical" },
          { href: "/instrumentation", title: "ابزار دقیق", need: V, area: "instrumentation" },
        ] },
    ],
  },
  {
    group: "کیفیت و تکمیل", icon: "✓",
    items: [
      { key: "quality", icon: "✓", title: "کیفیت و بازرسی", desc: "ITP و IR، NDT سازه و تجهیزات، Punch و NCR",
        tabs: [
          { href: "/inspection", title: "بازرسی (ITP و IR)", need: V, area: "quality" },
          { href: "/ndt-joints", title: "NDT سازه، ساپورت و تجهیزات", need: V, area: "quality" },
          { href: "/quality", title: "Punch و NCR", need: V, area: "quality" },
        ] },
      { key: "completions", icon: "☑", title: "تکمیل و راه‌اندازی", desc: "تست و MC، پیش‌راه‌اندازی تا RFSU و آزمون عملکرد، تحویل",
        tabs: [
          { href: "/completions", title: "تست فشار و MC", need: V, area: "completions" },
          { href: "/precom", title: "پیش‌راه‌اندازی تا RFSU", need: V, area: "completions" },
          { href: "/handover", title: "تحویل به نگهداری", need: V, area: "handover" },
        ] },
    ],
  },
  {
    group: "مدیریت پروژه", icon: "◔",
    items: [
      // One plan and its control (2026-10-17): the EPS/WBS of each contract is the plan, a file is imported into it, and a
      // control account is a node of its master version — no second WBS, schedule page or PMS page beside it.
      { key: "controls", icon: "◔", title: "برنامه‌ریزی و کنترل پروژه", desc: "EPS و PMS، WBS و فعالیت‌ها (P6)، ورود برنامه، ثبت کار روزانه، EVM روی WBS، ریسک و KPI",
        tabs: [
          { href: "/eps", title: "EPS و PMS", need: V },
          { href: "/eps/wbs", title: "WBS و فعالیت‌ها", need: V },
          { href: "/eps/activities", title: "فعالیت‌ها (P6)", need: V },
          { href: "/eps/templates", title: "الگوهای فعالیت", need: V },
          { href: "/eps/codes", title: "کدهای فعالیت", need: V },
          { href: "/eps/scope", title: "محدودهٔ پلتفرم", need: V },
          { href: "/eps/progress", title: "ثبت کار روزانه", need: V },
          { href: "/eps/progress/days", title: "کار چند روز", need: V },
          { href: "/controls", title: "EVM و ریسک", need: V, area: "controls" },
          { href: "/reports", title: "گزارش‌ها و KPI", need: V },
        ] },
      { key: "sitereports", icon: "✎", title: "گزارش روزانه", desc: "گزارش روزانهٔ هر قرارداد با بررسی، امضا و تأیید مرحله‌به‌مرحله",
        tabs: [
          { href: "/contract-reports", title: "گزارش روزانهٔ قرارداد", need: V },
          { href: "/report-setup", title: "تنظیم گردش‌کار", need: ACTIONS.MANAGE_MEMBERS, orDesigner: true },
          { href: "/report-print-setup", title: "قالب چاپ", need: ACTIONS.MANAGE_MEMBERS, orDesigner: true },
          { href: "/signature", title: "امضای من", need: V },
        ] },
      { key: "supply", icon: "⛟", title: "خرید و انبار", desc: "MR و PO، پیگیری، رسید، MIR/MTC و حواله",
        tabs: [
          { href: "/procurement", title: "خرید و پیگیری", need: V, area: "procurement" },
          { href: "/warehouse", title: "انبار و مواد", need: V, area: "warehouse" },
        ] },
      { key: "documents", icon: "❏", title: "مدارک", desc: "رجیستر، رویژن، ترانسمیتال و کامنت",
        // Two sides that never share a form: the project's reviewers, and the
        // designer, whose account opens only its portal (lib/authz.mjs).
        tabs: [
          { href: "/documents", title: "رجیستر و بررسی", need: V, area: "documents" },
          { href: "/documents/intake", title: "خواندن مدارک", need: V, area: "documents" },
          { href: "/documents/designer", title: "پرتال طراح", need: ACTIONS.SUBMIT_DESIGN },
        ] },
      { key: "hse", icon: "✚", title: "HSE", desc: "حوادث، مجوز کار، کار ایمن و مشاهدات",
        tabs: [{ href: "/hse", title: "HSE", need: V, area: "hse" }] },
    ],
  },
  {
    group: "قرارداد، مالی و منابع انسانی", icon: "§",
    items: [
      { key: "contracts", icon: "§", title: "قراردادها و پیمان‌ها", desc: "قرارداد، ردیف‌های پرداخت روی WBS، منابع و کتابخانهٔ منابع، مقادیر PDMS و صورت وضعیت",
        tabs: [
          { href: "/contracts", title: "قراردادها و پیمان‌ها", need: V, area: "contracts" },
          { href: "/contracts/setup", title: "تعریف قرارداد: ارز، بودجه، الحاقیه و دسته‌ها", need: V, area: "contracts" },
          { href: "/contracts/resources", title: "منابع قرارداد و کتابخانهٔ منابع", need: V, area: "contracts" },
          { href: "/contracts/statements", title: "صورت وضعیت‌ها", need: V, area: "contracts" },
          { href: "/contracts/design", title: "مقادیر طراحی (PDMS)", need: V, area: "contracts" },
        ] },
      { key: "finance", icon: "¤", title: "مالی", desc: "تعهد، تأییدشده، پرداخت — به تفکیک قرارداد، WBS و ماه",
        tabs: [{ href: "/finance", title: "مالی", need: V, area: "finance" }] },
      { key: "hr", icon: "☺", title: "منابع انسانی", desc: "پرسنل، ورود و خروج، کارکرد روزانه روی WBS",
        tabs: [{ href: "/hr", title: "منابع انسانی", need: V, area: "hr" }] },
    ],
  },
];

/**
 * Every section has a log: the steps its records took, who signed each, and
 * the comments on them (lib/db/repos/log.mjs). The tab is added here, once,
 * rather than written into each section above; a section's log may read more
 * than one log section (equipment and coating share a menu entry).
 */
export const LOG_SECTIONS = {
  project: ["project"], piping: ["piping"], civil: ["civil"], mechanical: ["equipment", "coating"], ei: ["ei"],
  quality: ["quality"], completions: ["completions", "handover"], controls: ["controls"], supply: ["procurement"],
  documents: ["documents"], hse: ["hse"], contracts: ["contracts"], finance: ["finance"], hr: ["hr"],
  workplan: ["work", "changes"], sitereports: ["reports"],
};
for (const g of SECTIONS) for (const s of g.items) {
  if (LOG_SECTIONS[s.key]) s.tabs.push({ href: `/log/${s.key}`, title: "لاگ و گردش", need: V, log: true });
}

/** A project's handover forms as tabs of the «فرم‌های تحویل کار» section: one tile each. */
export function formTabs(forms = []) {
  return forms.map((f) => ({ href: `/forms/${f.code}`, title: f.name, need: V, area: f.section, form: true }));
}

/** Pages everyone signed in keeps, whatever tiles they are given. */
export const ALWAYS_TILES = ["/", "/signature", "/account"];

/** A member narrowed to tiles: anyone but a project admin or developer, given at least one. */
export const narrowed = (m) => !!m && !["admin", "developer"].includes(m.role) && Array.isArray(m.tiles) && m.tiles.length > 0;

/**
 * Whether a member's tiles include a page. Unnarrowed, every page their role
 * opens; narrowed, only the tiles given — and a section's log beside a tile
 * of that section.
 */
export function tileAllowed(m, href) {
  if (!narrowed(m)) return true;
  if (ALWAYS_TILES.includes(href) || m.tiles.includes(href)) return true;
  const log = /^\/log\/([a-z]+)$/.exec(href);
  if (log) {
    const section = SECTIONS.flatMap((g) => g.items).find((s) => s.key === log[1]);
    return !!section && section.tabs.some((t) => !t.log && m.tiles.includes(t.href));
  }
  return false;
}

/** Who sees the form designer: the project's admin, or a member who signs for the employer. */
export const mayDesignForms = (m) => !!m && (["admin", "developer"].includes(m.role) || (m.party === "company" && m.role !== "viewer"));

/** Every tab, with its section — for lookups. */
export const ALL_TABS = SECTIONS.flatMap((g) => g.items.flatMap((s) => s.tabs.map((t) => ({ ...t, section: s.key, sectionTitle: s.title, icon: s.icon }))));

/**
 * The sections this person may see, each with only the tabs they may see
 * and `href` its first one. A section with no tab left is dropped, and a
 * group with no section — an empty heading reads as a loading bug.
 */
export function navigationFor(membership, can, { forms = [] } = {}) {
  return SECTIONS
    .map((g) => ({
      ...g,
      items: g.items
        .map((s) => {
          const all = s.key === "handover" ? [...s.tabs.filter((t) => !t.log), ...formTabs(forms), ...s.tabs.filter((t) => t.log)] : s.tabs;
          // a handover form's designer sets its workflow and print layout too
          const tabs = all.filter((t) => (can(membership, t.need) || (t.orDesigner && mayDesignForms(membership))) && inArea(membership, t.area) && tileAllowed(membership, t.href)
            && (!t.designer || mayDesignForms(membership)));
          // A section's log belongs to the section: shown only beside a page of it the member may open.
          return tabs.some((t) => !t.log) ? { ...s, tabs, href: tabs[0].href, status: "live" } : null;
        })
        .filter(Boolean),
    }))
    .filter((g) => g.items.length);
}

/**
 * The tab a path is, longest match first ("/" is a prefix of everything,
 * and "/piping" of "/piping/overview").
 */
export function activeTab(pathname = "/", forms = []) {
  const extra = formTabs(forms).map((t) => ({ ...t, section: "handover", sectionTitle: "فرم‌های تحویل کار", icon: "⇄" }));
  return [...ALL_TABS, ...extra]
    .sort((a, b) => b.href.length - a.href.length)
    .find((t) => (t.href === "/" ? pathname === "/" : pathname === t.href || pathname.startsWith(`${t.href}/`))) || null;
}
