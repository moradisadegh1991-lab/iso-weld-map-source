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
      { key: "project", icon: "▤", title: "پروژه", desc: "مشخصات، پیمانکاران، ساب‌سیستم‌ها، فرضیات و کاربران",
        tabs: [
          { href: "/project", title: "مشخصات پروژه", need: V },
          { href: "/contractors", title: "پیمانکاران", need: V },
          { href: "/subsystems", title: "سیستم و ساب‌سیستم", need: V },
          { href: "/assumptions", title: "فرضیات و اطلاعات ناقص", need: V },
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
      { key: "piping", icon: "⟜", title: "پایپینگ", desc: "ایزومتریک، رجیستر جوش، اجرا، NDT و سابقهٔ جوش",
        tabs: [
          { href: "/piping/overview", title: "داشبورد", need: V, area: "piping" },
          { href: "/piping", title: "ایزومتریک و رجیستر جوش", need: V, area: "piping" },
          { href: "/piping/execution", title: "اجرا: اسپول و ساپورت", need: V, area: "piping" },
          { href: "/qc", title: "NDT و جوشکار", need: ACTIONS.RECORD_NDT, area: "quality" },
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
      { key: "controls", icon: "◔", title: "کنترل پروژه", desc: "خط مبنا، EVM، ریسک و گزارش‌ها",
        tabs: [
          { href: "/controls", title: "کنترل پروژه", need: V, area: "controls" },
          { href: "/reports", title: "گزارش‌ها", need: V },
        ] },
      { key: "supply", icon: "⛟", title: "خرید و انبار", desc: "MR و PO، پیگیری، رسید، MIR/MTC و حواله",
        tabs: [
          { href: "/procurement", title: "خرید و پیگیری", need: V, area: "procurement" },
          { href: "/warehouse", title: "انبار و مواد", need: V, area: "warehouse" },
        ] },
      { key: "documents", icon: "❏", title: "مدارک", desc: "رجیستر، رویژن، ترانسمیتال و کامنت",
        tabs: [{ href: "/documents", title: "مدارک", need: V, area: "documents" }] },
      { key: "hse", icon: "✚", title: "HSE", desc: "حوادث، مجوز کار، کار ایمن و مشاهدات",
        tabs: [{ href: "/hse", title: "HSE", need: V, area: "hse" }] },
    ],
  },
];

/** Every tab, with its section — for lookups. */
export const ALL_TABS = SECTIONS.flatMap((g) => g.items.flatMap((s) => s.tabs.map((t) => ({ ...t, section: s.key, sectionTitle: s.title, icon: s.icon }))));

/**
 * The sections this person may see, each with only the tabs they may see
 * and `href` its first one. A section with no tab left is dropped, and a
 * group with no section — an empty heading reads as a loading bug.
 */
export function navigationFor(membership, can) {
  return SECTIONS
    .map((g) => ({
      ...g,
      items: g.items
        .map((s) => {
          const tabs = s.tabs.filter((t) => can(membership, t.need) && inArea(membership, t.area));
          return tabs.length ? { ...s, tabs, href: tabs[0].href, status: "live" } : null;
        })
        .filter(Boolean),
    }))
    .filter((g) => g.items.length);
}

/**
 * The tab a path is, longest match first ("/" is a prefix of everything,
 * and "/piping" of "/piping/overview").
 */
export function activeTab(pathname = "/") {
  return [...ALL_TABS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((t) => (t.href === "/" ? pathname === "/" : pathname === t.href || pathname.startsWith(`${t.href}/`))) || null;
}
