/**
 * The EPC reference (lib/reference/epc.mjs) made the project's own: its
 * standards register with editions, and checklists adopted into the
 * pre-commissioning module. Call inside `withProject`.
 */
import { CHECKLISTS } from "../../reference/epc.mjs";
import { upsertTemplate } from "./precom.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const text = (v) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s || null; };

export async function listStandards(db, { projectId }) {
  return (await db.query("SELECT * FROM project_standard WHERE project_id = $1 ORDER BY code", [projectId])).rows;
}

/** Add or amend a standard the project adopts. The edition may be left for later; it then shows as missing. */
export async function upsertStandard(db, { projectId, code, title = null, edition = null, scope = null, source = null, userId = null }) {
  if (!text(code)) throw bad("کد استاندارد لازم است.");
  const { rows: [r] } = await db.query(
    `INSERT INTO project_standard (project_id, code, title, edition, scope, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (project_id, code) DO UPDATE SET title = COALESCE(EXCLUDED.title, project_standard.title), edition = EXCLUDED.edition,
       scope = COALESCE(EXCLUDED.scope, project_standard.scope), source = COALESCE(EXCLUDED.source, project_standard.source), updated_at = now()
     RETURNING *`, [projectId, text(code).toUpperCase(), text(title), text(edition), text(scope), text(source), userId]);
  return r;
}

export async function removeStandard(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM project_standard WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw bad("پیدا نشد.");
}

/**
 * Adopt a reference checklist as one of the project's pre-commissioning or
 * commissioning templates. A template of that code the project already has
 * is the project's: it is not overwritten.
 */
export async function adoptChecklist(db, { projectId, code }) {
  const c = CHECKLISTS.find((x) => x.code === code);
  if (!c) throw bad("چک‌لیست مرجع پیدا نشد.");
  const { rows: [have] } = await db.query("SELECT id FROM precom_template WHERE project_id = $1 AND code = $2", [projectId, code]);
  if (have) throw bad(`${code} قبلاً در چک‌لیست‌های پروژه هست — نسخهٔ پروژه دست نمی‌خورد.`);
  return upsertTemplate(db, { projectId, code, title: c.title, appliesTo: c.appliesTo, phase: c.phase,
    criteria: c.items.map((x, i) => `${i + 1}. ${x}`).join("\n") });
}

export async function adoptedCodes(db, { projectId }) {
  return (await db.query("SELECT code FROM precom_template WHERE project_id = $1", [projectId])).rows.map((r) => r.code);
}
