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

export const SECTIONS = [
  {
    group: "پروژه",
    items: [
      { href: "/", icon: "▦", title: "میز کار", desc: "نمای کلی پروژه",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/project", icon: "▤", title: "مشخصات پروژه", desc: "قرارداد، کارفرما، زمان‌بندی",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/contractors", icon: "⚑", title: "پیمانکاران", desc: "شرکت‌ها و محدودهٔ کاری",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/subsystems", icon: "◈", title: "سیستم و ساب‌سیستم", desc: "آمادگی تحویل",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
    ],
  },
  {
    group: "اجرا",
    items: [
      { href: "/piping", icon: "⟜", title: "پایپینگ", desc: "ایزومتریک ← رجیستر جوش",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/piping/execution", icon: "⛓", title: "اجرای پایپینگ",
        desc: "فیت‌آپ، فابریکیشن، ارکشن، ساپورت و تست",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/equipment", icon: "⚙", title: "تجهیزات", desc: "تگ‌ها و زنجیرهٔ پیش‌نیاز",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/civil", icon: "▩", title: "سیویل", desc: "فونداسیون، بتن‌ریزی و پذیرش مقاومت",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/structural", icon: "⌗", title: "استراکچر", desc: "پایپ رک، شاقولی و پیش‌تنیدگی پیچ",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/electrical", icon: "⌁", title: "برق", desc: "لیست کابل، ترمینیشن و تست عایقی",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/instrumentation", icon: "◎", title: "ابزار دقیق", desc: "لیست ابزار، کالیبراسیون و لوپ چک",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
    ],
  },
  {
    group: "کیفیت و گزارش",
    items: [
      { href: "/qc", icon: "✓", title: "کنترل کیفیت", desc: "NDT، جوشکار، ITR",
        need: ACTIONS.RECORD_NDT, status: "live" },
      { href: "/reports", icon: "◱", title: "گزارش‌ها", desc: "پیشرفت و KPI",
        need: ACTIONS.VIEW_PROJECT, status: "live" },
      { href: "/documents", icon: "❏", title: "مدارک", desc: "رجیستر مدارک و رویژن",
        need: ACTIONS.VIEW_PROJECT, status: "soon" },
    ],
  },
  {
    group: "مدیریت",
    items: [
      { href: "/admin", icon: "⚿", title: "کاربران و دسترسی", desc: "نقش‌ها و اعضای پروژه",
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
  return SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => can(membership, i.need)) }))
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
