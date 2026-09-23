/**
 * What the platform is made of.
 *
 * One declarative list, so that adding a discipline is a data change rather
 * than a new application. Each entry says what it reads, what it produces,
 * which engineering standard its deterministic engine answers to, and
 * whether it is actually built.
 *
 * `actions` holds ACTION KEYS (the names in lib/authz.mjs), because a module
 * declares capability rather than performing it. Transitions in workflow.mjs
 * hold action VALUES, because those go straight to can(). The two differ on
 * purpose; the tests pin both.
 *
 * `status` is honest on purpose: "planned" modules appear in the navigation
 * greyed out rather than hidden.
 *
 * Two things can be built for a discipline and they are reported apart:
 * `status` is reading its DRAWINGS (extraction → register → signature);
 * `execution` is tracking its WORK on site (the precedence chain and the
 * deterministic checks that answer its steps). Civil can judge a cylinder
 * break without reading a foundation drawing, and claiming either from the
 * other would overstate what exists. A platform that shows only what exists
 * gives no sense of where it is going; one that shows planned work as if it
 * were live is a lie the first user discovers.
 */

import { STAGES } from "./workflow.mjs";

/** The stages every document-driven module uses. */
const DOC_FLOW = [STAGES.DRAFT, STAGES.EXTRACTED, STAGES.IN_REVIEW, STAGES.APPROVED];

export const MODULES = [
  {
    id: "piping",
    title: "پایپینگ",
    subtitle: "ایزومتریک → رجیستر جوش",
    discipline: "piping",
    item: "جوش",
    source: "نقشهٔ ایزومتریک",
    standard: "ASME B31.3 · B16.9 · Section IX",
    stages: DOC_FLOW,
    actions: ["RUN_EXTRACTION", "EDIT_EXTRACTION", "APPROVE_REGISTER", "ASSIGN_WELD", "RECORD_NDT"],
    status: "live",
    execution: "live",
  },
  {
    id: "structural",
    title: "استراکچر فلزی",
    subtitle: "نقشهٔ ساخت → لیست عضو و اتصال",
    discipline: "structural",
    item: "عضو / اتصال",
    source: "نقشهٔ ساخت و لیست پیچ",
    standard: "AISC 303 · AISC 360 · RCSC · EN 1090-2",
    stages: DOC_FLOW,
    actions: ["RUN_EXTRACTION", "EDIT_EXTRACTION", "APPROVE_REGISTER", "ASSIGN_WELD"],
    // Closest to piping in shape: geometry plus a parts list, so it reuses
    // the most and risks the least of the disciplines still to come.
    status: "planned",
    // Erection chain, column survey (plumbness) and bolt pretension.
    execution: "live",
  },
  {
    id: "electrical",
    title: "برق",
    subtitle: "لیست کابل → کشش و ترمینیشن",
    discipline: "electrical",
    item: "کابل",
    source: "لیست کابل · SLD",
    standard: "IEC 60364-6",
    stages: DOC_FLOW,
    actions: ["RUN_EXTRACTION", "EDIT_EXTRACTION", "APPROVE_REGISTER", "ASSIGN_WELD"],
    // Tabular at source, so extraction is easier than a drawing, not harder.
    status: "planned",
    // Cable schedule import (read by rule, not by a model), the cable chain
    // and IR acceptance.
    execution: "live",
  },
  {
    id: "instrumentation",
    title: "ابزار دقیق",
    subtitle: "loop diagram → نصب و تست",
    discipline: "instrumentation",
    item: "لوپ",
    source: "loop diagram · hook-up · index",
    standard: "ISA 5.1 · IEC 61298-2",
    stages: DOC_FLOW,
    actions: ["RUN_EXTRACTION", "EDIT_EXTRACTION", "APPROVE_REGISTER", "ASSIGN_WELD"],
    status: "planned",
    // Instrument index read by ISA 5.1 letters, bench calibration, loop
    // checks signed per loop.
    execution: "live",
  },
  {
    id: "civil",
    title: "سیویل",
    subtitle: "نقشهٔ فونداسیون → آرماتور و بتن",
    discipline: "civil",
    item: "بتن‌ریزی",
    source: "نقشهٔ فونداسیون · لیست آرماتور",
    standard: "ACI 318",
    stages: DOC_FLOW,
    actions: ["RUN_EXTRACTION", "EDIT_EXTRACTION", "APPROVE_REGISTER", "ASSIGN_WELD"],
    status: "planned",
    // Foundation chain, pours and ACI 318 strength acceptance.
    execution: "live",
  },
  {
    id: "equipment",
    title: "نصب تجهیزات",
    subtitle: "setting plan → نصب و alignment",
    discipline: "equipment",
    item: "تجهیز",
    source: "setting plan · GA وندور",
    standard: "API 686",
    stages: DOC_FLOW,
    actions: ["RUN_EXTRACTION", "EDIT_EXTRACTION", "APPROVE_REGISTER"],
    status: "planned",
    // Equipment list import and the rotating / static / fired chains.
    execution: "live",
  },
];

export const byId = (id) => MODULES.find((m) => m.id === id) || null;
export const liveModules = () => MODULES.filter((m) => m.status === "live");
export const executionModules = () => MODULES.filter((m) => m.execution === "live");

/**
 * The modules a role can do anything in.
 *
 * A viewer sees every module — being able to look is not the same as being
 * able to act, and hiding a module from someone who may read it only makes
 * them ask someone else to look for them.
 */
export function modulesForRole(role, can, actions) {
  if (role === "viewer") return MODULES;
  // can() takes the person's MEMBERSHIP in the project, not a bare role
  // string — a bare string returns false for everything, silently, which is
  // how an empty navigation would have shipped.
  const membership = { role };
  return MODULES.filter((m) => m.actions.some((k) => can(membership, actions[k])));
}
