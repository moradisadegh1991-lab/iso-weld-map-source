/**
 * What the sheet's right-click menu offers (pure; the component runs the actions).
 *
 *   on a mark          View · [Edit · Duplicate · Move · Delete when the sheet may be changed]
 *                      every item carries `target`: the mark's persistent reference (uid; legacy id only for a mark that has none) —
 *                      never a printed number or a list position
 *   on the empty sheet add weld (shop / field) · spool · support · equipment, at the clicked point; none on a look-only sheet
 *
 * The weld whose location is unknown (`weld-unknown`) is not offered for creation: a new weld is Shop or Field.
 */
import { KINDS, KIND_IDS } from "./markup.mjs";

export function markMenu({ ref, readOnly = false }) {
  const target = ref;
  return [
    { k: "view", label: "مشاهدهٔ مشخصات", icon: "ⓘ", target },
    ...(readOnly ? [] : [
      { k: "edit", label: "ویرایش مشخصات", icon: "✎", target },
      { k: "duplicate", label: "کپی با همهٔ مشخصات", icon: "⧉", target },
      { k: "move", label: "جابه‌جایی روی نقشه", icon: "✥", target },
      { k: "delete", label: "حذف…", icon: "✕", danger: true, target },
    ]),
  ];
}

export function emptyMenu({ readOnly = false } = {}) {
  if (readOnly) return [];
  return KIND_IDS.filter((k) => k !== "weld-unknown").map((k) => ({ k: `add-${k}`, label: `افزودن ${KINDS[k].label} همین‌جا`, kind: k }));
}
