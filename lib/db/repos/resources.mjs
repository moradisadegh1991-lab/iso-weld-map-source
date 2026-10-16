/**
 * A contract's resources (migration 069), shown in the contract's resource
 * tree (067): each resource sits in one branch and moves between branches.
 * Call inside `withProject`.
 */
import { KIND } from "../../reports/catalog.mjs";
import { treeOf } from "../../org/budget.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (w) => Object.assign(new Error(`${w} not found`), { status: 404 });
const text = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s || null; };
const qty = (v, what) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw bad(`${what} باید عدد نامنفی باشد.`);
  return n;
};
export const STATUS = { planned: "برنامه‌ریزی‌شده", active: "فعال", demobilised: "خارج‌شده از کارگاه" };

async function categoryOf(db, contractId, categoryId) {
  if (!categoryId) return null;
  const { rows: [c] } = await db.query("SELECT * FROM contract_category WHERE id = $1 AND contract_id = $2", [categoryId, contractId]);
  if (!c || c.tree !== "resource") throw bad("دسته باید از درخت منابع همین قرارداد باشد.");
  return c;
}

export async function upsertResource(db, { projectId, contractId, id = null, categoryId = null, kind, name, direct = true, unit = null,
  forecastQty = null, actualQty = null, status = "active", description = null, seq = null, userId = null }) {
  if (!KIND[kind]) throw bad("نوع منبع را انتخاب کنید.");
  if (!text(name)) throw bad("نام منبع لازم است.");
  if (!STATUS[status]) throw bad("وضعیت را انتخاب کنید.");
  if (!["person", "machine"].includes(kind) && !text(unit)) throw bad(`«${text(name)}» واحد لازم دارد — مقدار بی‌واحد معنایی ندارد.`);
  const { rows: [c] } = await db.query("SELECT 1 FROM contract WHERE id = $1 AND project_id = $2", [contractId, projectId]);
  if (!c) throw notFound("contract");
  await categoryOf(db, contractId, categoryId);
  // The display order (owner's review, item 6): typed, or after the last one.
  let order = seq === null || seq === undefined || String(seq).trim() === "" ? null : Number(seq);
  if (order !== null && (!Number.isInteger(order) || order < 0)) throw bad("ترتیب نمایش عدد صحیح نامنفی است.");
  if (order === null) {
    if (id) { const { rows: [o] } = await db.query("SELECT seq FROM contract_resource WHERE id = $1", [id]); order = o?.seq ?? 1; }
    else { const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM contract_resource WHERE contract_id = $1", [contractId]); order = m.n; }
  }
  const vals = [categoryId || null, kind, text(name), direct !== false && direct !== "false", text(unit) || (kind === "person" ? "نفر" : kind === "machine" ? "دستگاه" : null),
    qty(forecastQty, "مقدار پیش‌بینی"), qty(actualQty, "مقدار واقعی مورد نیاز"), status, text(description), order];
  if (id) {
    const { rows: [r] } = await db.query(
      `UPDATE contract_resource SET category_id = $3, kind = $4, name = $5, direct = $6, unit = $7, forecast_qty = $8, actual_qty = $9, status = $10, description = $11, seq = $12
        WHERE id = $1 AND contract_id = $2 RETURNING *`, [id, contractId, ...vals]);
    if (!r) throw notFound("resource");
    return r;
  }
  const { rows: [dup] } = await db.query("SELECT 1 FROM contract_resource WHERE contract_id = $1 AND kind = $2 AND name = $3", [contractId, kind, text(name)]);
  if (dup) throw Object.assign(new Error(`«${text(name)}» در منابع این قرارداد هست.`), { status: 409, code: "DUPLICATE" });
  const { rows: [r] } = await db.query(
    `INSERT INTO contract_resource (project_id, contract_id, category_id, kind, name, direct, unit, forecast_qty, actual_qty, status, description, seq, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [projectId, contractId, ...vals, userId]);
  return r;
}

/** Move a resource to another branch (null: no branch). */
export async function moveResource(db, { projectId, id, categoryId = null }) {
  const { rows: [r] } = await db.query("SELECT * FROM contract_resource WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!r) throw notFound("resource");
  await categoryOf(db, r.contract_id, categoryId);
  const { rows: [m] } = await db.query("UPDATE contract_resource SET category_id = $2 WHERE id = $1 RETURNING *", [id, categoryId || null]);
  return m;
}

export async function removeResource(db, { projectId, id }) {
  await db.query("DELETE FROM contract_resource WHERE id = $1 AND project_id = $2", [id, projectId]);
}

/**
 * The resource tree: the contract's resource branches with their resources
 * under them, and the resources in no branch. Each branch also carries the
 * totals of its resources by unit (never across units).
 */
export async function resourceTree(db, { projectId, contractId }) {
  const { rows: cats } = await db.query("SELECT * FROM contract_category WHERE contract_id = $1 AND tree = 'resource'", [contractId]);
  const { rows: res } = await db.query("SELECT * FROM contract_resource WHERE contract_id = $1 AND project_id = $2 ORDER BY seq, name", [contractId, projectId]);
  const tree = treeOf(cats);
  const attach = (nodes) => nodes.map((n) => {
    const children = attach(n.children);
    const own = res.filter((r) => r.category_id === n.id);
    const all = [...own, ...children.flatMap((c) => c.allResources)];
    const totals = {};
    for (const r of all) { const u = r.unit || "—"; totals[u] = (totals[u] || 0) + Number(r.forecast_qty || 0); }
    return { ...n, children, resources: own, allResources: all, totals };
  });
  return { tree: attach(tree), loose: res.filter((r) => !r.category_id || !cats.some((c) => c.id === r.category_id)), resources: res };
}
