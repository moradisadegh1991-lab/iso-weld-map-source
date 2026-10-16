/**
 * The examination requirement that actually governs one weld.
 *
 * Two authorities, and the order between them is the whole point:
 *
 *   1. the code floor for the fluid service (lib/ndt/b31-3.mjs)
 *   2. the piping class, which may only be MORE demanding
 *
 * A class rule that asks for less than the code is not applied silently; it
 * is reported as a deviation that somebody has to own. That is the difference
 * between a register an inspector accepts and one they start pulling apart.
 */
import { codeRequirement, isRadiographable, SERVICE } from "./b31-3.mjs";

const METHOD_RANK = { VT: 0, PT: 1, MT: 1, UT: 2, RT: 3 };

/**
 * Class rules are a small, explicit list. Each has a `when` describing which
 * welds it catches and a requirement it imposes.
 *
 * The common one on a real project — "every field closure gets 100% RT" — is
 * a CLASS rule, not a code rule. B31.3 draws no distinction between a shop
 * and a field weld for examination. The engine used to hard-code that
 * percentage and present it as if the code demanded it.
 *
 * @typedef {{ when: {shopField?: string, kind?: string[], npsMin?: number, npsMax?: number},
 *             method: string, percent: number, reason: string }} ClassRule
 */
export function matchesRule(weld, when = {}) {
  if (when.shopField && String(weld.loc || weld.shop_field) !== when.shopField) return false;
  if (when.kind && !when.kind.includes(String(weld.kind || weld.weld_kind))) return false;
  const nps = Number(weld.nps);
  if (when.npsMin != null && !(nps >= when.npsMin)) return false;
  if (when.npsMax != null && !(nps <= when.npsMax)) return false;
  return true;
}

/**
 * @param {object} weld           { kind, loc, nps }
 * @param {object} pipingClass    { code, service_category, ndt_rules: ClassRule[] }
 * @returns {{method, percent, randomSample, source, clause, basis, deviations, notes}}
 */
export function ndtRequirement(weld, pipingClass) {
  const service = pipingClass?.service_category ?? pipingClass?.serviceCategory ?? null;
  const floor = codeRequirement(service);
  const deviations = [], notes = [];

  if (!pipingClass) {
    return {
      ...floor, source: "code", deviations,
      notes: ["Piping Class تخصیص داده نشده — فقط کف کد اعمال شد"],
      unresolved: true,
    };
  }

  // A weld that cannot be radiographed does not carry a radiographic
  // percentage, whatever the class says: it takes a surface examination.
  if (floor.method === "RT" && !isRadiographable(weld)) {
    notes.push("این جوش محیطی butt نیست — درصد رادیوگرافی روی آن اعمال نمی‌شود");
    return {
      method: "PT", percent: 100, randomSample: false, source: "code",
      clause: "B31.3 §341.4.1", basis: "بازرسی سطحی به‌جای رادیوگرافی برای جوش غیرbutt",
      deviations, notes,
    };
  }

  const rules = pipingClass.ndt_rules ?? pipingClass.ndtRules ?? [];
  const hit = rules.find((r) => matchesRule(weld, r.when));
  if (!hit) return { ...floor, source: "code", deviations, notes };

  const stricter = isStricter(hit, floor);
  if (!stricter) {
    // Applied, because the class is the contract — but never silently.
    deviations.push({
      code: "CLASS_BELOW_CODE",
      message: `قاعدهٔ کلاس ${pipingClass.code}: ${hit.method} ${hit.percent}% از کف کد ` +
        `(${floor.method} ${floor.percent}%) کمتر است. ${floor.clause} — ` +
        `این انحراف باید مصوب کارفرما باشد.`,
    });
  }

  return {
    method: hit.method,
    percent: hit.percent,
    randomSample: hit.percent < 100,
    source: "class",
    clause: floor.clause,
    basis: `${hit.reason} (Piping Class ${pipingClass.code})`,
    deviations,
    notes,
  };
}

function isStricter(rule, floor) {
  if (floor.percent == null) return true;             // no floor to be below
  const a = METHOD_RANK[rule.method] ?? -1;
  const b = METHOD_RANK[floor.method] ?? -1;
  if (a > b) return true;
  if (a < b) return false;
  return rule.percent >= floor.percent;
}

export { SERVICE };
