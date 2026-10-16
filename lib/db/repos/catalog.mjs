/**
 * The daily report's catalogue of roles, machines and materials (migration
 * 061; rules in lib/reports/catalog.mjs). Call inside `withProject`.
 */
import { KIND } from "../../reports/catalog.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const text = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s || null; };

export async function listCatalog(db, { projectId, activeOnly = false }) {
  const { rows } = await db.query(
    `SELECT id, kind, name, name_en, discipline, unit, source, active FROM resource_catalog
      WHERE project_id = $1 AND ($2::boolean IS FALSE OR active) ORDER BY kind, discipline NULLS LAST, name`, [projectId, activeOnly]);
  return rows;
}

/**
 * Bring in a list of items. An item already in the catalogue (same kind and
 * name) is left as the project has it — an import never overwrites a person's
 * correction. Returns how many were added and how many were already there.
 */
export async function importCatalog(db, { projectId, items, source, userId = null }) {
  if (!text(source)) throw bad("منبع ورود لازم است.");
  let added = 0, kept = 0;
  for (const it of items) {
    if (!KIND[it.kind] || !text(it.name)) throw bad(`ردیف نامعتبر: ${JSON.stringify(it).slice(0, 80)}`);
    const { rowCount } = await db.query(
      `INSERT INTO resource_catalog (project_id, kind, name, name_en, discipline, unit, source, source_ref, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (project_id, kind, name) DO NOTHING`,
      [projectId, it.kind, text(it.name), text(it.nameEn), text(it.discipline), text(it.unit), source, text(it.sourceRef), it.active !== false, userId]);
    if (rowCount) added++; else kept++;
  }
  return { added, kept };
}

/** One item typed by a person. A material, consumable or tool needs its unit. */
export async function addCatalogItem(db, { projectId, kind, name, nameEn = null, discipline = null, unit = null, userId = null }) {
  if (!KIND[kind]) throw bad("نوع را انتخاب کنید.");
  if (!text(name)) throw bad("نام لازم است.");
  if (!["person", "machine"].includes(kind) && !text(unit)) throw bad(`«${text(name)}» واحد لازم دارد — مقدار بی‌واحد معنایی ندارد.`);
  const { rows: [have] } = await db.query("SELECT id FROM resource_catalog WHERE project_id = $1 AND kind = $2 AND name = $3", [projectId, kind, text(name)]);
  if (have) throw Object.assign(new Error(`«${text(name)}» در فهرست هست.`), { status: 409, code: "DUPLICATE" });
  const { rows: [r] } = await db.query(
    `INSERT INTO resource_catalog (project_id, kind, name, name_en, discipline, unit, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'manual',$7) RETURNING *`,
    [projectId, kind, text(name), text(nameEn), text(discipline), kind === "person" ? null : text(unit), userId]);
  return r;
}

/** Stop offering an item (or offer it again). Reports that named it keep the name. */
export async function setCatalogActive(db, { projectId, id, active }) {
  const { rows: [r] } = await db.query("UPDATE resource_catalog SET active = $3 WHERE id = $1 AND project_id = $2 RETURNING *", [id, projectId, !!active]);
  if (!r) throw Object.assign(new Error("item not found"), { status: 404 });
  return r;
}
