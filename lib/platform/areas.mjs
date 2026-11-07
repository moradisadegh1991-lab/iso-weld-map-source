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
  contracts: "قراردادها و صورت وضعیت",
  finance: "مالی",
  hr: "منابع انسانی",
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
  // the isometric workspace's own routes: the BOM's reservations, the sheet's installed items, the sheet reader, its
  // registry check and the drawing-style templates (audit 2026-11-03: these were unclassified, so open to every area)
  ["/api/bom-allocations", "piping"], ["/api/iso-equipment", "piping"], ["/api/mark-warnings", "piping"], ["/api/revisions", "piping"], ["/api/validation", "piping"], ["/api/read-local", "piping"],
  ["/api/pid", "piping"], ["/api/registry-check", "piping"], ["/api/drawing-styles", "piping"],
  ["/api/contractors", "contracts"],      // the contractor registry and its packages: the contracts desk (Phase 1.1 review)
  ["/api/civil", "civil"], ["/api/structural", "structural"], ["/api/equipment", "equipment"],
  ["/api/electrical", "electrical"], ["/api/instrumentation", "instrumentation"], ["/api/coating", "coating"],
  ["/api/quality", "quality"], ["/api/inspection", "quality"],
  ["/api/completions", "completions"], ["/api/precom", "completions"], ["/api/handover", "handover"],
  ["/api/hse", "hse"], ["/api/controls", "controls"], ["/api/pms", "controls"], ["/api/procurement", "procurement"],
  ["/api/warehouse", "warehouse"], ["/api/doc-control", "documents"], ["/api/doc-intake", "documents"],
  ["/api/contracts", "contracts"], ["/api/org", "contracts"], ["/api/resources", "contracts"], ["/api/finance", "finance"], ["/api/hr", "hr"],
];

/**
 * Write routes that are NOT in API_AREAS, and why — every one must be named here or above
 * (db/test/area-coverage.mjs fails on a write route that is in none): an unlisted route is open to every area,
 * and that must be a decision written down, not what happens when someone forgets.
 *
 *   PER_OPERATION   the route holds several kinds of operation; each is judged by its own area (see areaForNdtJoint,
 *                   areaForOp in this file, lib/db/repos/forms.mjs for a form's section)
 *   COMMON          not a discipline's work: identity, the project's own definition and settings, cross-cutting tools,
 *                   or a read that uses POST. Each is guarded by its own action (assertCan), not by an area.
 *   REVIEWED        looked at for an area and left without one ON PURPOSE: the work crosses disciplines, or access is a
 *                   workflow or an administrator's action, so an area would shut out the people the workflow names.
 *                   The reason is written beside each; a route is moved to an area only by a decision that says so.
 */
export const PER_OPERATION_ROUTES = {
  "/api/field": "each operation by its kind (areaForOp), checked in lib/db/repos/field.mjs",
  "/api/ndt-joints": "each operation by its kind (areaForNdtJoint), checked in the route",
  "/api/records": "each record kind by its entity (areasForRecord), checked in the route on DELETE",
  "/api/forms": "each form by its section (lib/db/repos/forms.mjs)",
};
export const COMMON_ROUTES = {
  "/api/auth/forgot": "identity", "/api/auth/login": "identity", "/api/auth/logout": "identity",
  "/api/auth/password": "identity", "/api/auth/prefs": "identity", "/api/auth/setup": "identity",
  "/api/projects": "the directory of projects a user belongs to", "/api/project": "the project's own settings (own action)",
  "/api/units": "project definition: admin only", "/api/users": "membership: admin only",
  "/api/report-setup": "report layout settings", "/api/report-catalog": "the daily report's catalogue of roles, machines and materials",
  "/api/report-print": "print layouts and logos", "/api/numbering": "numbering of forms (own action)",
  "/api/custom-fields": "columns a project adds (own action)", "/api/import-templates": "a person's own Excel templates",
  "/api/llm-endpoints": "the project's LLM endpoints (own action)", "/api/notifications": "any member to other members",
  "/api/log": "the trail of a section (reads by tile)", "/api/signature": "a signature image (own check)",
  "/api/trash": "the project's trash (own action)", "/api/value-lists": "the project's pick lists (piping data admin's action)",
  "/api/tie-in-targets": "a read that uses POST (where a Tie-in stands now)",
};
export const REVIEWED_ROUTES = {
  "/api/assumptions": "engineering assumptions that cross disciplines (a circuit voltage is electrical's, a storage temperature piping's); each operation has its own action (EDIT_EXTRACTION to propose and revise, APPROVE_REGISTER to decide)",
  "/api/changes": "TQs, site changes and work orders pass between design, documents, quality and contracts; each operation has its own action (SUBMIT_DESIGN, CONTROL_DOCUMENTS, RECORD_QUALITY, MANAGE_CONTRACTS, PREPARE_STATEMENT)",
  "/api/contract-reports": "a contractor's own reports and files: contractor members work in their discipline's area, and access is the report's contract and workflow, checked in the repository",
  "/api/daily-reports": "the daily site report is made and signed by whoever the report type's workflow names, in any discipline; access is the workflow (lib/db/repos/reports), not an area",
  "/api/eps": "the WBS/EPS structure (MANAGE_CONTROLS, MANAGE_CONTRACTS); planning is read by every discipline — splitting its operations by area is the owner's decision",
  "/api/eps/activities": "activity progress, delays and relations are entered by whoever the report workflow names (site, contractor, planner); the workflow decides",
  "/api/eps/planning": "planning requirements and comments cross controls, contracts and the disciplines; the workflow decides",
  "/api/reference": "the project's adoption of the EPC reference and its standards: project administration (MANAGE_MEMBERS)",
  "/api/subsystems": "filing a line under a subsystem is the engineer's call (EDIT_EXTRACTION) and serves completions as well as piping",
  "/api/work": "contractor claims waiting for the employer: decided by the employer's supervision (MANAGE_MEMBERS, RECORD_INSPECTION) across disciplines",
};

/**
 * /api/records deletes a register row entered by mistake: the area is the record's own (lib/db/repos/removal.mjs
 * ENTITIES). A weld joint is the structure's or the equipment's, so a member of either may remove it.
 */
const RECORD_AREAS = {
  contractor: ["contracts"], "contract-package": ["contracts"],
  "hse-person": ["hse"], "hse-equipment": ["hse"], "hse-jsa": ["hse"],
  "precom-template": ["completions"], guarantee: ["completions"], "perf-test": ["completions"],
  "control-account": ["controls"], "mdr-document": ["documents"], "coating-system": ["coating"],
  "weld-joint": ["structural", "equipment"],
};
export const areasForRecord = (entity) => RECORD_AREAS[entity] || null;
/** Whether a member works in at least one of the areas (null/empty: common to everyone). */
export const inAnyArea = (membership, areas) => !areas?.length || areas.some((a) => inArea(membership, a));

/** The area of one /api/ndt-joints operation: the matrix, the register and welding are piping's; the examination and its draws are quality's. */
export function areaForNdtJoint(kind) {
  switch (kind) {
    case "rule": case "rule-remove": case "joint": case "weld": return "piping";
    case "ndt": case "sample": case "progressive": return "quality";
    default: return null;
  }
}

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
