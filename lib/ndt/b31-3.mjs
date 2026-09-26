/**
 * ASME B31.3 §341.4 — required examination, by fluid service.
 *
 * WHAT THIS FILE IS
 *
 * The CODE FLOOR. It is the least examination B31.3 will accept for a given
 * fluid service. It is not what any particular project requires, because a
 * piping class is free to be stricter and usually is.
 *
 * So every requirement produced here carries where it came from — `code` or
 * `class` — and the class always wins. A percentage on a weld register with
 * no traceable source is a number nobody can defend to an inspector.
 *
 * WHAT IS DELIBERATELY LEFT TO THE PROJECT
 *
 * Category M fluid service (Chapter VIII) and anything the owner has written
 * into the specification. M341.4 builds on the Normal requirements in ways
 * that depend on the material and the owner's own rules, and inventing a
 * number here would be worse than admitting there isn't one.
 */

export const SERVICE = {
  NORMAL: "normal",
  CATEGORY_D: "category_d",
  CATEGORY_M: "category_m",
  SEVERE_CYCLIC: "severe_cyclic",
  HIGH_PRESSURE: "high_pressure",
};

/**
 * Which weld kinds a radiographic percentage applies to.
 *
 * §341.4.1 speaks of circumferential butt and miter groove welds. A socket or
 * fillet weld is not radiographed — it takes a surface examination instead,
 * so counting it in an RT population would quietly dilute the sample.
 */
export const RT_ELIGIBLE_KINDS = ["BW", "Closure", "Tie-in"];

export function isRadiographable(weld) {
  return RT_ELIGIBLE_KINDS.includes(String(weld.kind || weld.weld_kind || ""));
}

/**
 * The code floor for one fluid service.
 *
 * `randomSample` marks the case that matters operationally: 5% is not "any
 * 5%". §341.4.1(b) requires the sample to be chosen so that the work of every
 * welder is included — see lib/ndt/sampling.mjs.
 */
export function codeRequirement(serviceCategory) {
  switch (serviceCategory) {
    case SERVICE.CATEGORY_D:
      return {
        method: "VT", percent: 100, randomSample: false,
        clause: "B31.3 §341.4.2",
        basis: "Category D Fluid Service — بازرسی چشمی؛ رادیوگرافی الزام کد نیست",
      };
    case SERVICE.SEVERE_CYCLIC:
      return {
        method: "RT", percent: 100, randomSample: false,
        clause: "B31.3 §341.4.3",
        basis: "Severe Cyclic Conditions — ۱۰۰٪ رادیوگرافی جوش‌های محیطی",
      };
    case SERVICE.HIGH_PRESSURE:
      return {
        method: "RT", percent: 100, randomSample: false,
        clause: "B31.3 §K341.4",
        basis: "High Pressure Piping (Chapter IX) — ۱۰۰٪ رادیوگرافی",
      };
    case SERVICE.NORMAL:
      return {
        method: "RT", percent: 5, randomSample: true,
        clause: "B31.3 §341.4.1",
        basis: "Normal Fluid Service — حداقل ۵٪ رادیوگرافی تصادفی، " +
               "انتخاب‌شده طوری که کار هر جوشکار در نمونه باشد",
      };
    case SERVICE.CATEGORY_M:
      return {
        method: null, percent: null, randomSample: false,
        clause: "B31.3 Chapter VIII §M341.4",
        basis: "Category M — الزام از مشخصات کارفرما و Piping Class می‌آید؛ " +
               "این ماژول عددی برایش اختراع نمی‌کند",
        unresolved: true,
      };
    default:
      return {
        method: null, percent: null, randomSample: false,
        clause: null,
        basis: `دستهٔ سرویس «${serviceCategory || "—"}» شناخته نشد`,
        unresolved: true,
      };
  }
}
