/**
 * Excel templates a person builds (migration 086): of a platform template
 * whose importer reads columns by heading, the columns kept, under a name.
 * The project's: every member sees and downloads them; whoever made one, or
 * the project's admin, removes it. Call inside `withProject`.
 */
import { checkPick } from "../../import-templates.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (x) => Object.assign(new Error(`${x} not found`), { status: 404 });
const forbidden = (m) => Object.assign(new Error(m), { status: 403, code: "FORBIDDEN" });
const text = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).replace(/\s+/g, " ").trim());

export async function listTemplates(db, { projectId, kind }) {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.columns, t.created_by, u.display_name AS created_by_name, t.created_at
       FROM import_template t LEFT JOIN app_user u ON u.id = t.created_by
      WHERE t.project_id = $1 AND t.kind = $2 ORDER BY lower(t.name)`, [projectId, kind]);
  return rows;
}

/** A template saved under its name; the same name again replaces its columns. */
export async function saveTemplate(db, { projectId, kind, name, columns, userId }) {
  const n = text(name);
  if (!n || n.length > 80) throw bad("نام الگو لازم است (تا ۸۰ نویسه).");
  const { columns: keep, problem } = checkPick(kind, columns);
  if (problem) throw bad(problem);
  const { rows: [row] } = await db.query(
    `INSERT INTO import_template (project_id, kind, name, columns, created_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, kind, name) DO UPDATE SET columns = EXCLUDED.columns
     RETURNING id, name, columns`, [projectId, kind, n, keep, userId]);
  return row;
}

export async function removeTemplate(db, { projectId, id, userId, isAdmin = false }) {
  const { rows: [t] } = await db.query("SELECT created_by FROM import_template WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!t) throw notFound("template");
  if (!isAdmin && t.created_by !== userId) throw forbidden("الگو را سازنده‌اش یا مدیر پروژه حذف می‌کند.");
  await db.query("DELETE FROM import_template WHERE id = $1", [id]);
}
