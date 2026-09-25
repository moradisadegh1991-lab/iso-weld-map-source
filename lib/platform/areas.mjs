/**
 * Work areas: the disciplines and functions a member works in.
 *
 * A member's areas decide two things: their MENU (a piping supervisor sees
 * piping, not HSE permits) and which areas they may WRITE to. Reading stays
 * open — a tag's record crosses every discipline, and a planner reading
 * civil progress is not a breach. A member with no areas works in all of
 * them; a project admin and a developer always do.
 *
 * One list, read by the menu, by the server's write check and by the users
 * page — so an area cannot be offered on a screen and refused by the server
 * under another name.
 */

export const AREAS = {
  piping: "پایپینگ",
  civil: "سیویل",
  structural: "استراکچر",
  equipment: "تجهیزات مکانیکال",
  electrical: "برق",
  instrumentation: "ابزار دقیق",
  coating: "رنگ و عایق",
  quality: "کیفیت، بازرسی، Punch و NCR",
  completions: "تکمیل، MC و راه‌اندازی",
  hse: "HSE",
  controls: "کنترل پروژه",
  procurement: "خرید",
  warehouse: "انبار",
  documents: "کنترل مدارک",
  handover: "تحویل به نگهداری",
};

/** Whether a member may work in an area. `null` area: common to everyone. */
export function inArea(membership, area) {
  if (!area) return true;
  if (!membership) return false;
  if (membership.role === "admin" || membership.role === "developer") return true;
  const mine = membership.areas || [];
  return mine.length === 0 || mine.includes(area);
}

/**
 * The area an API route writes to, by its path. Routes not listed are
 * common (the project's own settings are guarded by their own action), or
 * split per operation (the field sync, which checks each operation).
 */
const API_AREAS = [
  ["/api/piping-classes", "piping"], ["/api/piping", "piping"], ["/api/runs", "piping"], ["/api/spools", "piping"],
  ["/api/welders", "piping"], ["/api/welds", "piping"], ["/api/ndt-selections", "piping"], ["/api/extract", "piping"],
  ["/api/review-queue", "piping"], ["/api/documents", "piping"],
  ["/api/civil", "civil"], ["/api/structural", "structural"], ["/api/equipment", "equipment"],
  ["/api/electrical", "electrical"], ["/api/instrumentation", "instrumentation"], ["/api/coating", "coating"],
  ["/api/quality", "quality"], ["/api/inspection", "quality"],
  ["/api/completions", "completions"], ["/api/precom", "completions"], ["/api/handover", "handover"],
  ["/api/hse", "hse"], ["/api/controls", "controls"], ["/api/procurement", "procurement"],
  ["/api/warehouse", "warehouse"], ["/api/doc-control", "documents"],
];

export function areaForPath(pathname) {
  const p = String(pathname || "");
  const hit = API_AREAS.find(([prefix]) => p === prefix || p.startsWith(`${prefix}/`) || p.startsWith(`${prefix}?`));
  return hit ? hit[1] : null;
}

/** The area of an operation captured on site (lib/field/ops.mjs). */
export function areaForOp(kind, { tagKind = null } = {}) {
  switch (kind) {
    case "spool_step": return "piping";
    case "cable_step": case "cable_ir": return "electrical";
    case "instrument_step": case "instrument_cal": case "loop_check": return "instrumentation";
    case "punch_raise": case "punch_clear": case "punch_photo": case "ir_result": return "quality";
    case "tag_step": return tagKind === "foundation" ? "civil" : tagKind === "structure" ? "structural" : "equipment";
    default: return null;
  }
}
