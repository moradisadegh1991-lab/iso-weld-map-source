/**
 * Columns a project adds to the platform's tables (owner's requirements of
 * 2026-10-22, item 7; migration 085). A column belongs to one table — the
 * name TableKit knows it by — and is the project's: every member sees it.
 * A row's value is kept by the row's own key and stored as text in the
 * column's type; an empty value is no value. Call inside `withProject`.
 */
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (x) => Object.assign(new Error(`${x} not found`), { status: 404 });
export const TYPES = ["text", "number", "date", "bool", "list"];
const text = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).replace(/\s+/g, " ").trim());

/** A value as its column keeps it, or the reason it is not one; blank → null. */
export function valueOf(field, raw) {
  const v = text(raw);
  if (v === null) return { value: null };
  switch (field.data_type) {
    case "number": {
      const n = Number(v.replace(/[٬,]/g, ""));
      return Number.isFinite(n) ? { value: String(Math.round(n * 1e10) / 1e10) } : { problem: `«${v}» عدد نیست.` };
    }
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? { value: v } : { problem: `«${v}» تاریخ به شکل YYYY-MM-DD نیست.` };
    case "bool": return ["true", "false"].includes(v) ? { value: v } : { problem: "مقدار بله/خیر نامعتبر است." };
    case "list": return field.options.includes(v) ? { value: v } : { problem: `«${v}» از گزینه‌های این ستون نیست.` };
    default: return v.length <= 2000 ? { value: v } : { problem: "متن بیش از ۲۰۰۰ نویسه است." };
  }
}

/** A table's columns and every value they hold. */
export async function tableColumns(db, { projectId, formKey }) {
  const { rows: fields } = await db.query("SELECT id, label, data_type, options, seq FROM custom_field WHERE project_id = $1 AND form_key = $2 ORDER BY seq, created_at", [projectId, formKey]);
  const { rows: values } = fields.length ? await db.query("SELECT field_id, row_key, value FROM custom_value WHERE field_id = ANY($1) LIMIT 20000", [fields.map((f) => f.id)]) : { rows: [] };
  return { fields, values };
}

export async function saveField(db, { projectId, formKey, id = null, label, dataType = "text", options = [], userId }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(String(formKey || ""))) throw bad("جدول نامعتبر است.");
  const l = text(label);
  if (!l || l.length > 60) throw bad("عنوان ستون لازم است (تا ۶۰ نویسه).");
  if (!TYPES.includes(dataType)) throw bad("نوع دادهٔ ستون نامعتبر است.");
  const opts = dataType === "list" ? [...new Set((Array.isArray(options) ? options : String(options || "").split(/[,،\n]/)).map(text).filter(Boolean))] : [];
  if (dataType === "list" && !opts.length) throw bad("ستون فهرستی دست‌کم یک گزینه لازم دارد.");
  const { rows: [dup] } = await db.query("SELECT 1 FROM custom_field WHERE project_id = $1 AND form_key = $2 AND label = $3 AND id IS DISTINCT FROM $4", [projectId, formKey, l, id]);
  if (dup) throw bad(`ستون «${l}» در این جدول هست.`);
  if (id) {
    const { rows: [old] } = await db.query("SELECT * FROM custom_field WHERE id = $1 AND project_id = $2", [id, projectId]);
    if (!old) throw notFound("column");
    // a column whose values the new type would not hold keeps its type
    if (old.data_type !== dataType) {
      const { rows } = await db.query("SELECT value FROM custom_value WHERE field_id = $1", [id]);
      const broken = rows.filter((r) => valueOf({ data_type: dataType, options: opts }, r.value).problem);
      if (broken.length) throw bad(`${broken.length} مقدار این ستون با نوع تازه جور نیست؛ اول آن‌ها را پاک یا درست کنید.`);
    }
    const { rows: [r] } = await db.query("UPDATE custom_field SET label = $2, data_type = $3, options = $4 WHERE id = $1 RETURNING *", [id, l, dataType, opts]);
    return r;
  }
  const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM custom_field WHERE project_id = $1 AND form_key = $2", [projectId, formKey]);
  const { rows: [r] } = await db.query(
    "INSERT INTO custom_field (project_id, form_key, label, data_type, options, seq, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [projectId, formKey, l, dataType, opts, m.n, userId]);
  return r;
}

export async function removeField(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM custom_field WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("column");
}

/** A row's value in a column; blank removes it. */
export async function saveValue(db, { projectId, fieldId, rowKey, value, userId }) {
  const { rows: [f] } = await db.query("SELECT * FROM custom_field WHERE id = $1 AND project_id = $2", [fieldId, projectId]);
  if (!f) throw notFound("column");
  const k = text(rowKey);
  if (!k || k.length > 200) throw bad("ردیف نامعتبر است.");
  const v = valueOf(f, value);
  if (v.problem) throw bad(`${f.label}: ${v.problem}`);
  if (v.value === null) { await db.query("DELETE FROM custom_value WHERE field_id = $1 AND row_key = $2", [fieldId, k]); return null; }
  const { rows: [r] } = await db.query(
    `INSERT INTO custom_value (project_id, field_id, row_key, value, updated_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (field_id, row_key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *`,
    [projectId, fieldId, k, v.value, userId]);
  return r;
}
