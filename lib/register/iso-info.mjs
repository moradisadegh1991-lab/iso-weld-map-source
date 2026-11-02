/**
 * The isometric's own information (owner's request of 2026-11-02: a complete
 * View / Edit form, in logical sections, over what the system already holds —
 * no field is invented).
 *
 * Every field is one the sheet's reading, the register or the line already
 * carries: the drawing's identity and revision (meta), the line it belongs to
 * (meta + the line list read off the title block), the design and operating
 * conditions, test, examination and coating values (the line list, text as
 * printed — the sheet names its own units). What the register keeps of the
 * run (status, who approved) is shown, read-only, beside them.
 *
 * `infoProblems` says what a person should look at before saving; it blocks
 * nothing but a missing drawing number or revision, and corrects nothing.
 */
import { sizesOf } from "./weld-marks.mjs";

/** [{ id, title, fields: [{ key, label, from: "meta"|"line", required?, hint? }] }] */
export const INFO_SECTIONS = [
  { id: "identity", title: "شناسهٔ نقشه", fields: [
    { key: "drawingNo", label: "شمارهٔ نقشه (ISO)", from: "meta", required: true },
    { key: "rev", label: "رویژن", from: "meta", required: true },
    { key: "sheet", label: "شیت", from: "meta", hint: "مثل 3/4" },
    { key: "unit", label: "واحد (Unit)", from: "meta" },
  ] },
  { id: "line", title: "خط و کلاس", fields: [
    { key: "lineNo", label: "شمارهٔ خط", from: "meta" },
    { key: "pipingClass", label: "کلاس لوله", from: "meta" },
    { key: "lineClass", label: "کلاس خط (روی نقشه)", from: "line" },
    { key: "nps", label: "قطر پیش‌فرض NPS", from: "meta" },
    { key: "schedule", label: "Schedule پیش‌فرض", from: "meta" },
  ] },
  { id: "conditions", title: "شرایط طراحی و کاری", fields: [
    { key: "designPressure", label: "فشار طراحی", from: "line" },
    { key: "operatingPressure", label: "فشار کاری", from: "line" },
    { key: "designTemp", label: "دمای طراحی", from: "line" },
    { key: "operatingTemp", label: "دمای کاری", from: "line" },
  ] },
  { id: "test", title: "تست و بازرسی", fields: [
    { key: "testFluid", label: "سیال تست", from: "line" },
    { key: "testPressure", label: "فشار تست", from: "line" },
    { key: "ndt", label: "NDT", from: "line" },
    { key: "pwht", label: "PWHT", from: "line" },
  ] },
  { id: "coating", title: "عایق و رنگ", fields: [
    { key: "insulationType", label: "نوع عایق", from: "line" },
    { key: "insulationThk", label: "ضخامت عایق", from: "line" },
    { key: "paint", label: "رنگ", from: "line" },
  ] },
];
export const INFO_FIELDS = INFO_SECTIONS.flatMap((s) => s.fields);

const text = (v) => String(v ?? "").trim();
/** "7.4" → 7.4; "-29/65", "FV/7.4", "ATM" → null (not one plain number). */
const plain = (v) => {
  const t = text(v).replace(/\s*(barg?|bar|°\s*[CF]|[CF]|psi\w*|kpa|mpa)\s*$/i, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const NUMERIC = ["designPressure", "operatingPressure", "designTemp", "operatingTemp", "testPressure", "insulationThk"];
const EMPTYISH = /^(-|—|–|n\/?a|none|no|nil)$/i;

/** The value of a field from the two stores a sheet keeps (meta, line list). */
export function infoValue(field, meta = {}, lineData = {}) {
  return text(field.from === "meta" ? meta?.[field.key] : lineData?.[field.key]);
}

/**
 * @returns {{ errors: string[], warnings: string[] }} errors: what the register cannot be saved without;
 *   warnings: what to look at (a value that carries no number, a sheet number that is not N/M, an operating
 *   value above the design value, a size that is not one).
 */
export function infoProblems(meta = {}, lineData = {}) {
  const errors = [], warnings = [];
  if (!text(meta.drawingNo)) errors.push("شمارهٔ نقشه نوشته نشده");
  if (!text(meta.rev)) errors.push("رویژن نوشته نشده");
  const sh = text(meta.sheet);
  if (sh) {
    const m = sh.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!m) warnings.push(`شیت «${sh}» به صورت N/M نیست (مثل 3/4)`);
    else if (Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) warnings.push(`شیت ${sh}: شمارهٔ برگ از تعداد برگ‌ها بیشتر است`);
  }
  const label = Object.fromEntries(INFO_FIELDS.map((f) => [f.key, f.label]));
  for (const k of NUMERIC) {
    const v = text(lineData?.[k]);
    if (v && !EMPTYISH.test(v) && !/\d/.test(v) && !/^(FV|ATM|FULL\s*VAC\w*)$/i.test(v)) warnings.push(`${label[k]} «${v}» عددی ندارد`);
  }
  const pair = (d, o, what) => {
    const a = plain(lineData?.[d]), b = plain(lineData?.[o]);
    if (a != null && b != null && b > a) warnings.push(`${what} کاری (${text(lineData[o])}) از طراحی (${text(lineData[d])}) بیشتر است`);
  };
  pair("designPressure", "operatingPressure", "فشار");
  pair("designTemp", "operatingTemp", "دمای");
  const nps = text(meta.nps);
  if (nps && sizesOf(nps).length === 0) warnings.push(`قطر پیش‌فرض «${nps}» قطر لوله به نظر نمی‌رسد`);
  const tp = plain(lineData?.testPressure), dp = plain(lineData?.designPressure);
  if (tp != null && dp != null && tp < dp) warnings.push(`فشار تست (${text(lineData.testPressure)}) از فشار طراحی (${text(lineData.designPressure)}) کمتر است`);
  return { errors, warnings };
}
