/**
 * An activity's cost and float, as Primavera P6 names them (owner's
 * requirements of 2026-10-26, items 3 and 4; migration 091). Pure.
 *
 * `key` is what a form sends, `col` the column, `head` the P6 title the
 * forms, grids and Excel sheets show. `cost` figures are never below zero;
 * float may be. The two percentages are typed on the activity table and on
 * a template's activity; in a version's plan the database works them out
 * (`derived`) from the costs, as `costPercents` does here for a form that
 * shows them before saving.
 */
export const COST_FIELDS = [
  { key: "targetCost", col: "target_cost", head: "Budgeted Total Cost($)", cost: true },
  { key: "actCost", col: "act_cost", head: "Actual Total Cost($)", cost: true },
  { key: "remainCost", col: "remain_cost", head: "Remaining Total Cost($)", cost: true },
  { key: "totalCost", col: "total_cost", head: "At Completion Total Cost($)", cost: true },
  { key: "freeFloatH", col: "free_float_hr_cnt", head: "Free Float(h)" },
  { key: "totalFloatH", col: "total_float_hr_cnt", head: "Total Float(h)" },
  { key: "costCompletePct", col: "cost_complete_pct", head: "Cost % Complete(%)", derived: true },
  { key: "actPctSpent", col: "act_pct_spent", head: "(*)Cost % of Budget(%)", derived: true },
];
export const COST_COLS = COST_FIELDS.map((f) => f.col);
/** The fields a person types in a version's plan: the two percentages are the database's. */
export const PLAN_COST_FIELDS = COST_FIELDS.filter((f) => !f.derived);

const n = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * The two percentages as Primavera P6 defines them (the owner's decision of
 * 2026-10-26):
 *   Cost % Complete       = actual total cost / at completion total cost × 100
 *   (*)Cost % of Budget   = actual total cost / budgeted total cost      × 100
 * Each empty while a side is empty or its divisor is not above zero — never a
 * figure nobody gave. Migration 092's generated columns hold the same rule.
 */
export function costPercents({ targetCost, actCost, totalCost }) {
  const a = n(actCost), total = n(totalCost), t = n(targetCost);
  const of = (whole) => (a == null || !(whole > 0) ? null : r4((a / whole) * 100));
  return { costCompletePct: of(total), actPctSpent: of(t) };
}

/** A row's cost fields under their form keys, from its columns (empty as ""). */
export const costValues = (row) => Object.fromEntries(COST_FIELDS.map((f) => [f.key, row?.[f.col] ?? ""]));
