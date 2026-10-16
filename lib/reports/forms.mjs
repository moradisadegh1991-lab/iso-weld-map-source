/**
 * Handover forms (فرم‌های تحویل کار): forms a section's employer supervision
 * designs — header fields and a table of rows — that go through the same
 * staged workflow as the daily report (stages, review groups, signatures,
 * final approver) and print with a type's print layout. Pure: the
 * repository (lib/db/repos/forms.mjs) loads, asks and writes.
 *
 * DEFINITION
 *   header    [{ key, label, type, required, options }]   once per report
 *   columns   [{ key, label, type, required, options, bind }]   one per row
 *   source    "claims" | null — when "claims", a new report can take as its
 *             rows the work the employer ACCEPTED that day in the form's
 *             section (contractor claims approved, lib/db/repos/claims.mjs);
 *             a column's `bind` names the accepted work's field it is
 *             filled from. Nothing is guessed: a column with no bind is
 *             left for a person to fill.
 *
 * A report keeps the definition it was made with (`content.def`), so a form
 * redesigned later never re-reads an older report under different columns.
 */

export const FIELD_TYPES = { text: "متن", number: "عدد", date: "تاریخ", select: "انتخابی", check: "بله / خیر" };
export const SOURCES = { claims: "کارهای تحویل‌گرفته‌شدهٔ همان روز (تأیید کارفرما)" };
/** What accepted work carries, for a column to be filled from. */
export const CLAIM_FIELDS = {
  item: "آیتم (تگ، اسپول، کابل، …)", step: "مرحلهٔ کار", code: "کد مرحله", discipline: "رشته", contractor: "پیمانکار",
  doneAt: "تاریخ انجام", refNo: "شمارهٔ مرجع", claimant: "اعلام‌کنندهٔ پیمانکار", approver: "تحویل‌گیرندهٔ کارفرما",
};
export const LIMITS = { header: 30, columns: 30, rows: 500, options: 50 };

const KEY = /^[a-z][a-z0-9_]{0,23}$/;
const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const text = (v) => (blank(v) ? null : String(v).replace(/\s+/g, " ").trim());

function cleanFields(list, { kind, source, problems }) {
  const where = kind === "header" ? "سربرگ" : "ستون";
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((f, i) => {
    const label = text(f?.label);
    let key = text(f?.key)?.toLowerCase() || `${kind === "header" ? "h" : "c"}${i + 1}`;
    if (!label) problems.push(`${where} ${i + 1}: عنوان لازم است.`);
    if (!KEY.test(key)) problems.push(`${where} «${label || i + 1}»: کلید «${key}» باید با حرف لاتین کوچک شروع شود و فقط حرف، رقم و _ داشته باشد.`);
    if (seen.has(key)) { problems.push(`${where} «${label}»: کلید «${key}» تکراری است.`); key = `${key}_${i + 1}`; }
    seen.add(key);
    const type = FIELD_TYPES[f?.type] ? f.type : "text";
    const options = type === "select"
      ? [...new Set((Array.isArray(f?.options) ? f.options : String(f?.options || "").split(/[،,\n]/)).map(text).filter(Boolean))].slice(0, LIMITS.options)
      : [];
    if (type === "select" && !options.length) problems.push(`${where} «${label}»: فیلد انتخابی دست‌کم یک گزینه لازم دارد.`);
    const out = { key, label: label || key, type, required: !!f?.required };
    if (options.length) out.options = options;
    if (kind === "column" && !blank(f?.bind)) {
      if (source !== "claims") problems.push(`ستون «${label}»: پر شدن خودکار فقط وقتی معنا دارد که ردیف‌ها از کارهای تحویل‌گرفته بیایند.`);
      else if (!CLAIM_FIELDS[f.bind]) problems.push(`ستون «${label}»: «${f.bind}» از فیلدهای کار تحویل‌گرفته نیست.`);
      else out.bind = f.bind;
    }
    return out;
  });
}

/** A definition as designed: normalised, and what is wrong with it. */
export function checkDefinition(input = {}) {
  const problems = [];
  const source = input.source && SOURCES[input.source] ? input.source : null;
  if (input.source && !source) problems.push("منبع ردیف‌ها نامعتبر است.");
  const header = cleanFields(input.header, { kind: "header", source, problems });
  const columns = cleanFields(input.columns, { kind: "column", source, problems });
  if (!columns.length) problems.push("فرم دست‌کم یک ستون لازم دارد.");
  if (header.length > LIMITS.header) problems.push(`سربرگ حداکثر ${LIMITS.header} فیلد دارد.`);
  if (columns.length > LIMITS.columns) problems.push(`جدول حداکثر ${LIMITS.columns} ستون دارد.`);
  return { def: { header, columns, source }, problems };
}

function cleanValue(f, raw, where, problems) {
  if (blank(raw) || (f.type === "check" && raw === false)) {
    if (f.required && f.type !== "check") problems.push(`${where}: «${f.label}» لازم است.`);
    return f.type === "check" ? false : null;
  }
  switch (f.type) {
    case "number": {
      const n = Number(String(raw).replace(/[٬,]/g, ""));
      if (!Number.isFinite(n)) { problems.push(`${where}: «${f.label}» عدد نیست («${raw}»).`); return null; }
      return n;
    }
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw)) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
        problems.push(`${where}: «${f.label}» تاریخ به شکل YYYY-MM-DD نیست.`); return null;
      }
      return String(raw);
    case "select":
      if (!f.options.includes(text(raw))) { problems.push(`${where}: «${raw}» از گزینه‌های «${f.label}» نیست.`); return null; }
      return text(raw);
    case "check": return raw === true || raw === "true" || raw === 1 || raw === "1";
    default: return text(raw);
  }
}

/** A report's content checked against its definition. Rows keep their id and the accepted work they came from. */
export function checkFormContent(def, input = {}) {
  const problems = [];
  const header = Object.fromEntries(def.header.map((f) => [f.key, cleanValue(f, input.header?.[f.key], "سربرگ", problems)]));
  const list = Array.isArray(input.rows) ? input.rows : [];
  if (list.length > LIMITS.rows) problems.push(`گزارش حداکثر ${LIMITS.rows} ردیف دارد.`);
  const seen = new Set();
  const rows = list.slice(0, LIMITS.rows).map((r, i) => {
    let id = text(r?.id) || `r${i + 1}${Math.random().toString(36).slice(2, 8)}`;
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const row = { id, ...Object.fromEntries(def.columns.map((c) => [c.key, cleanValue(c, r?.[c.key], `ردیف ${i + 1}`, problems)])) };
    if (r?.source?.table && r?.source?.id) row.source = { table: String(r.source.table), id: String(r.source.id) };
    return row;
  });
  const sources = rows.filter((r) => r.source).map((r) => `${r.source.table}:${r.source.id}`);
  if (new Set(sources).size !== sources.length) problems.push("یک کار تحویل‌گرفته دو بار در گزارش آمده است.");
  return { content: { schema: "form1", def, header, rows }, problems };
}

/** The accepted work of a day as the form's rows: bound columns filled, the rest left empty. */
export function rowsFromWork(def, work = []) {
  return work.map((w, i) => ({
    id: `w${i + 1}`,
    ...Object.fromEntries(def.columns.map((c) => [c.key, c.bind ? (w[c.bind] ?? null) : null])),
    source: { table: w.table, id: w.id },
  }));
}

// key order does not count, at any depth: content read back from jsonb comes with its keys reordered
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}` : JSON.stringify(v ?? null));

/** What a new version does to the rows, for the workflow's add / change / remove rights. */
export function rowChanges(prev, next) {
  const before = new Map((prev?.rows || []).map((r) => [r.id, r]));
  const after = new Map((next?.rows || []).map((r) => [r.id, r]));
  let added = 0, changed = 0, removed = 0;
  for (const [id, r] of after) { if (!before.has(id)) added++; else if (canon(before.get(id)) !== canon(r)) changed++; }
  for (const id of before.keys()) if (!after.has(id)) removed++;
  const headerChanged = canon(prev?.header || {}) !== canon(next?.header || {});
  return { added, changed: changed + (headerChanged ? 1 : 0), removed };
}

/** Sums of the number columns, for the table's foot and the print. */
export function columnTotals(def, rows = []) {
  return Object.fromEntries(def.columns.filter((c) => c.type === "number")
    .map((c) => [c.key, rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)]));
}
