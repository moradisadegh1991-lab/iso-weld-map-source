/**
 * A drawing style's template (db/migrations/095_drawing_style.sql): where a
 * designer's isometrics print each title-block value, marked once by a
 * person; tools/iso-read.py reads a later sheet of the style from those
 * cells (docs/epc-llm/13-style-templates.md).
 *
 * Call these inside `withProject`.
 */

/** The values a template may mark, as the reader names them. */
export const STYLE_FIELDS = ["drawingNo", "sheet", "rev", "lineNo", "lineClass", "designPressure", "operatingPressure",
  "designTemp", "operatingTemp", "testPressure", "testFluid", "ndt", "pwht", "paint", "insulationType", "insulationThk"];

const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "BAD_STYLE" });

/** A template's fields as saved: known keys only, each a box inside the page and big enough to hold a value. */
export function cleanFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields && typeof fields === "object" ? fields : {})) {
    if (!STYLE_FIELDS.includes(k)) throw bad(`مقدار ناشناخته در الگو: ${k}`);
    const b = Array.isArray(v?.box) ? v.box.map(Number) : null;
    if (!b || b.length !== 4 || b.some((x) => !Number.isFinite(x) || x < 0 || x > 1)) throw bad(`خانهٔ «${k}» باید چهار عدد بین ۰ و ۱ باشد.`);
    const [x0, y0, x1, y1] = [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
    // a box a value fits in: a dot clicked twice is not one
    if (x1 - x0 < 0.004 || y1 - y0 < 0.004) throw bad(`خانهٔ «${k}» خیلی کوچک است — دو گوشهٔ مقابل خانه را بزنید.`);
    out[k] = { box: [x0, y0, x1, y1].map((x) => Math.round(x * 10000) / 10000) };
  }
  if (!Object.keys(out).length) throw bad("الگو هیچ خانه‌ای ندارد.");
  return out;
}

export async function listStyles(db, { projectId }) {
  const { rows } = await db.query(
    "SELECT id, name, fingerprint, fields, sample, updated_at FROM drawing_style WHERE project_id = $1 ORDER BY name", [projectId]);
  return rows;
}

/** Save a template by name: a new one, or the same name's fields and fingerprint replaced. */
export async function saveStyle(db, { projectId, name, fingerprint, fields, sample = null, userId = null }) {
  const nm = String(name || "").trim().slice(0, 120);
  if (!nm) throw bad("نام الگو لازم است.");
  const fp = [...new Set((Array.isArray(fingerprint) ? fingerprint : []).map((w) => String(w).toUpperCase().replace(/[^A-Z]/g, "")).filter((w) => w.length >= 3))].slice(0, 600);
  // without the words of the sheet it was marked on, no later sheet can be matched to it
  if (fp.length < 5) throw bad("واژه‌های جدول عنوان این برگ در دست نیست — برگ را دوباره بدون مدل بخوانید و بعد الگو را ذخیره کنید.");
  const f = cleanFields(fields);
  const { rows: [row] } = await db.query(
    `INSERT INTO drawing_style (project_id, name, fingerprint, fields, sample, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (project_id, name) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, fields = EXCLUDED.fields,
       sample = EXCLUDED.sample, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING id, name, fingerprint, fields, sample, updated_at`,
    [projectId, nm, fp, JSON.stringify(f), sample ? String(sample).slice(0, 200) : null, userId]);
  return row;
}

export async function deleteStyle(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM drawing_style WHERE project_id = $1 AND id = $2", [projectId, id]);
  return rowCount > 0;
}

/** The templates as the reader takes them (tools/iso-read.py --templates). */
export const forReader = (styles) => styles.map((s) => ({ id: s.id, name: s.name, fingerprint: s.fingerprint, fields: s.fields }));
