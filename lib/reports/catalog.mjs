/**
 * The daily report's catalogue of roles, machines and materials, and how the
 * old Access daily report's list (`manp_list` with its groups `GRP_MANP`)
 * becomes one.
 *
 * What the Access list got wrong is not carried over:
 *  - every person was "نفرساعت" (man-hours) while the numbers entered were
 *    heads; a person here has no unit — the report counts heads;
 *  - people, machines and materials shared one quantity column; here each
 *    item has a kind, and each kind its own list in the report;
 *  - units were written several ways ("دستگاه / روز", "دستگاه/روز"); they
 *    are written one way;
 *  - names appeared twice; each item is kept once;
 *  - a few "roles" are crews ("گروه …", "پیمانکاری …"): kept, but not
 *    offered until the project says they belong in its list.
 * What looks wrong but cannot be decided from the list (a machine counted in
 * square metres) is kept as it was and named in the import's problems.
 */

export const KIND = {
  person: "نیروی انسانی", machine: "ماشین‌آلات", tool: "ابزارآلات غیرمصرفی", consumable: "ابزارآلات مصرفی",
  material: "مصالح", project_material: "متریال پروژه",
};
/** Which list of the daily report an item of each kind goes in. */
export const REPORT_LIST = { person: "manpower", machine: "equipment", tool: "equipment", consumable: "materials", material: "materials", project_material: "materials" };

const ACCESS_KIND = {
  "نیروی انسانی": "person", "ماشین آلات": "machine", "ماشین‌آلات": "machine", "ابزارآلات غیر مصرفی": "tool",
  "ابزارآلات مصرفی": "consumable", "مصالح": "material", "متریال پروژه": "project_material",
};
const space = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
/** One spelling per unit: no spaces around "/", single spaces elsewhere. */
export const normUnit = (u) => space(u).replace(/\s*\/\s*/g, "/") || null;

/**
 * @param rows    manp_list rows (id_shogl, semat, semat_en, id_group, unit, type)
 * @param groups  GRP_MANP rows (id_grp, grop_nm_pa, grop_nm_en)
 * @returns {{ items: [{kind, name, nameEn, discipline, unit, sourceRef, active}], problems: string[], duplicates: number, skipped: number }}
 */
export function fromAccess(rows, groups) {
  const grp = new Map(groups.map((g) => [String(g.id_grp), space(g.grop_nm_pa) || null]));
  const items = [], problems = [], seen = new Map();
  let duplicates = 0, skipped = 0;
  for (const r of rows) {
    const name = space(r.semat);
    const kind = ACCESS_KIND[space(r.type)];
    if (!name) { skipped++; continue; }
    if (!kind) { problems.push(`«${name}»: نوع «${space(r.type) || "—"}» شناخته نشد — وارد نشد`); skipped++; continue; }
    const key = `${kind}|${name}`;
    if (seen.has(key)) { duplicates++; continue; }
    const unit = normUnit(r.unit);
    const item = { kind, name, nameEn: space(r.semat_en) || null, discipline: grp.get(String(r.id_group)) || null,
      unit: kind === "person" ? null : unit, sourceRef: `manp_list:${r.id_shogl}`, active: true };
    if (kind === "person" && /^(گروه|پیمانکاری)\s/.test(name)) {
      item.active = false;
      problems.push(`«${name}» نام یک گروه یا پیمانکار است، نه سمت — غیرفعال وارد شد`);
    }
    if (kind === "person" && unit && unit.replace(/\s/g, "") !== "نفرساعت") problems.push(`«${name}» نیروی انسانی است ولی واحدش «${unit}» ثبت شده بود — بدون واحد (نفر) وارد شد`);
    if (kind === "machine" && unit !== "دستگاه/روز") problems.push(`«${name}» ماشین‌آلات است ولی واحدش «${unit || "—"}» است — همان‌طور وارد شد؛ بررسی شود`);
    if (kind !== "person" && kind !== "machine" && !unit) problems.push(`«${name}» واحد ندارد — مقدارش در گزارش بی‌معناست؛ واحد را تعیین کنید`);
    seen.set(key, item); items.push(item);
  }
  return { items, problems, duplicates, skipped };
}
