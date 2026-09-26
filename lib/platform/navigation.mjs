/**
 * The menu and the launchpad, declared once.
 *
 * One list drives the left menu, the home tiles and the breadcrumb, because
 * three hand-maintained copies is how a platform ends up with a menu entry
 * that leads nowhere and a page nothing links to.
 *
 * `need` names the ACTION a person must hold to see the entry, resolved
 * through lib/authz.mjs. `status: "soon"` shows greyed rather than hidden —
 * a platform that shows only what exists gives no sense of where it is
 * going, and one that shows planned work as live is a lie the first user
 * finds.
 */
import { ACTIONS } from "../authz.mjs";
import { inArea } from "./areas.mjs";

export const SECTIONS = [
  {
    group: "پروژه", icon: "▦",
    items: [
      { href: "/", icon: "▦", title: "میز کار", desc: "نمای کلی پروژه",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/project", icon: "▤", title: "مشخصات پروژه", desc: "قرارداد، کارفرما، زمان‌بندی",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/contractors", icon: "⚑", title: "پیمانکاران", desc: "شرکت‌ها و محدودهٔ کاری",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/subsystems", icon: "◈", title: "سیستم و ساب‌سیستم", desc: "آمادگی تحویل",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/asset", icon: "◉", title: "شناسنامهٔ تجهیز", desc: "یک تگ، همهٔ رشته‌ها",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/assumptions", icon: "?", title: "فرضیات و اطلاعات ناقص",
        desc: "Assumption Register و آنچه هنوز UNKNOWN است", need: ACTIONS.VIEW_PROJECT, status: "live" },
    ],
  },
  {
    group: "سایت", icon: "⌖",
    items: [
      { href: "/field", icon: "⌖", title: "سایت (آفلاین)", desc: "اسکن QR، ثبت مرحله و Punch بدون شبکه",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/labels", icon: "▥", title: "برچسب QR", desc: "چاپ برچسب تگ، اسپول، کابل و ابزار",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
    ],
  },
  {
    group: "اجرای رشته‌ها", icon: "⚒",
    items: [
      { href: "/piping/overview", icon: "▤", title: "داشبورد پایپینگ", desc: "اینچ-قطر، NDT کامل، خطوط، جوشکاران و Weld Log",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "piping" },
      { href: "/piping", icon: "⟜", title: "پایپینگ", desc: "ایزومتریک ← رجیستر جوش",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "piping" },
      { href: "/piping/execution", icon: "⛓", title: "اجرای پایپینگ",
        desc: "فیت‌آپ، فابریکیشن، ارکشن، ساپورت و تست", need: ACTIONS.VIEW_PROJECT, status: "live", area: "piping" },
      { href: "/piping/joint", icon: "⌇", title: "سابقهٔ جوش", desc: "Joint History: رویژن، مواد، جوشکار، NDT و تعمیر، تست",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "piping" },
      { href: "/equipment", icon: "⚙", title: "تجهیزات", desc: "تگ‌ها و زنجیرهٔ پیش‌نیاز",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "equipment" },
      { href: "/civil", icon: "▩", title: "سیویل", desc: "فونداسیون، بتن‌ریزی و پذیرش مقاومت",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "civil" },
      { href: "/structural", icon: "⌗", title: "استراکچر", desc: "پایپ رک، شاقولی و پیش‌تنیدگی پیچ",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "structural" },
      { href: "/electrical", icon: "⌁", title: "برق", desc: "لیست کابل، ترمینیشن و تست عایقی",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "electrical" },
      { href: "/instrumentation", icon: "◎", title: "ابزار دقیق", desc: "لیست ابزار، کالیبراسیون و لوپ چک",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "instrumentation" },
      { href: "/coating", icon: "◐", title: "رنگ و عایق", desc: "آماده‌سازی سطح، DFT و عایق‌کاری",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "coating" },
    ],
  },
  {
    group: "کیفیت و بازرسی", icon: "✓",
    items: [
      { href: "/inspection", icon: "⌕", title: "بازرسی (ITP و IR)", desc: "نقاط توقف و حضور، درخواست بازرسی و آزادسازی",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "quality" },
      { href: "/qc", icon: "✓", title: "کنترل کیفیت جوش", desc: "NDT، جوشکار، ITR",
        need: ACTIONS.RECORD_NDT, status: "live", area: "quality" },
      { href: "/ndt-joints", icon: "⊕", title: "NDT سازه، ساپورت و تجهیزات", desc: "ماتریس NDT پروژه، RT/UT/MT/PT/VT، نمونه‌گیری",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "quality" },
      { href: "/quality", icon: "⚐", title: "Punch و NCR", desc: "لیست نواقص A/B/C و عدم انطباق",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "quality" },
    ],
  },
  {
    group: "تکمیل و تحویل", icon: "☑",
    items: [
      { href: "/completions", icon: "☑", title: "تکمیل و MC", desc: "پکیج تست فشار و گواهی تکمیل مکانیکی",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "completions" },
      { href: "/precom", icon: "▶", title: "پیش‌راه‌اندازی و RFSU", desc: "چک‌لیست‌های پس از MC و گواهی آمادگی راه‌اندازی",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "completions" },
      { href: "/handover", icon: "⇲", title: "تحویل به نگهداری", desc: "ISO 14224، Criticality، FLOC و خروجی CMMS",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "handover" },
    ],
  },
  {
    group: "مدیریت پروژه", icon: "◔",
    items: [
      { href: "/controls", icon: "◔", title: "کنترل پروژه", desc: "خط مبنا، EVM (SPI/CPI) و ریسک",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "controls" },
      { href: "/procurement", icon: "⛟", title: "خرید و پیگیری", desc: "PO، پیش‌بینی تحویل، FAT، حمل و مدارک فروشنده",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "procurement" },
      { href: "/warehouse", icon: "▣", title: "انبار و مواد", desc: "رسید، MIR/MTC، حواله و ردیابی ذوب",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "warehouse" },
      { href: "/documents", icon: "❏", title: "مدارک", desc: "رجیستر مدارک، رویژن معتبر در تاریخ و ترانسمیتال",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "documents" },
      { href: "/hse", icon: "✚", title: "HSE", desc: "حوادث، LTIF/TRIR، مجوز کار و تست گاز",
        need: ACTIONS.VIEW_PROJECT, status: "live", area: "hse" },
      { href: "/reports", icon: "◱", title: "گزارش‌ها", desc: "پیشرفت و KPI",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
    ],
  },
  {
    group: "مدیریت سامانه", icon: "⚿",
    items: [
      { href: "/admin", icon: "⚿", title: "کاربران و دسترسی", desc: "اعضا، نقش، حوزهٔ کاری و لینک ورود",
        need: ACTIONS.MANAGE_MEMBERS, status: "live" },
    ],
  },
];

/** Flat list, for lookups. */
export const ALL_ITEMS = SECTIONS.flatMap((s) => s.items);

/**
 * The sections this person may see.
 *
 * A group whose every item is filtered out is dropped entirely — an empty
 * heading in a menu reads as a loading bug.
 */
export function navigationFor(membership, can) {
  // An item is shown when the role holds its action AND it is in one of the
  // member's areas (or common to all): a piping supervisor's menu is piping.
  return SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => can(membership, i.need) && inArea(membership, i.area)) }))
    .filter((s) => s.items.length);
}

/**
 * The entry a path belongs to, longest match first.
 *
 * Longest-first matters: "/" is a prefix of everything, so a naive scan
 * would highlight میز کار on every page.
 */
export function activeItem(pathname = "/") {
  return [...ALL_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)) || null;
}
