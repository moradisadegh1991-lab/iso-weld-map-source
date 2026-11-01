/**
 * A project's picking lists (db/migrations/096_value_list.sql,
 * lib/register/value-lists.mjs). Call these inside `withProject`.
 */
import { cleanItems, resolveLists } from "../../register/value-lists.mjs";

/** Every list, the project's own where it saved one, else the built-in values. */
export async function valueLists(db, { projectId }) {
  const { rows } = await db.query("SELECT list_key, items FROM value_list WHERE project_id = $1", [projectId]);
  return resolveLists(Object.fromEntries(rows.map((r) => [r.list_key, r.items])));
}

/** Save a list whole (replacing the built-in values for the project). */
export async function saveValueList(db, { projectId, key, items, userId = null }) {
  const clean = cleanItems(key, items);
  await db.query(
    `INSERT INTO value_list (project_id, list_key, items, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, list_key) DO UPDATE SET items = EXCLUDED.items, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [projectId, key, clean, userId]);
  return clean;
}

/** Back to the built-in values. */
export async function resetValueList(db, { projectId, key }) {
  const { rowCount } = await db.query("DELETE FROM value_list WHERE project_id = $1 AND list_key = $2", [projectId, key]);
  return rowCount > 0;
}
