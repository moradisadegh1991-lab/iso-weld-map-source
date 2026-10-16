/**
 * Installed / tested counts for every discipline the platform can count
 * (lib/controls/progress.mjs says which, and why three are engine-derived).
 * Call inside `withProject`.
 */
import { ENGINE_DISCIPLINES, SQL_DISCIPLINES, PROGRESS_DISCIPLINES, milestones, countItems } from "../../controls/progress.mjs";
import { createLoader } from "../loader.mjs";
import { tagStatus } from "./activities.mjs";
import { coatingStatus } from "./coating.mjs";
import { pipingProgressItems } from "./piping-hub.mjs";

const KIND = { civil: "foundation", structural: "structure" };

/**
 * Every item of an engine discipline with its milestones — judged by the
 * same engine the discipline's own page uses.
 */
export async function engineItems(db, { projectId, discipline, subsystemId = null }) {
  const spec = ENGINE_DISCIPLINES[discipline];
  if (!spec) throw bad(`رشتهٔ «${discipline}» با موتور شمرده نمی‌شود.`);
  if (discipline === "piping") return pipingProgressItems(db, { projectId, subsystemId });
  if (discipline === "coating") {
    const { rows } = await db.query(
      `SELECT ci.id, COALESCE(sp.spool_no, t.tag_no) AS label, COALESCE(l.subsystem_id, t.subsystem_id) AS subsystem_id
         FROM coating_item ci LEFT JOIN spool sp ON sp.id = ci.spool_id LEFT JOIN line l ON l.id = sp.line_id
         LEFT JOIN tag t ON t.id = ci.tag_id
        WHERE ci.project_id = $1 AND ($2::uuid IS NULL OR COALESCE(l.subsystem_id, t.subsystem_id) = $2)
        ORDER BY 2`, [projectId, subsystemId]);
    const out = [];
    for (const r of rows) {
      const s = await coatingStatus(db, { projectId, itemId: r.id });
      out.push({ id: r.id, label: r.label, subsystemId: r.subsystem_id, ...milestones(s.steps, spec) });
    }
    return out;
  }
  const { rows } = await db.query(
    `SELECT id, tag_no, subsystem_id FROM tag WHERE project_id = $1 AND kind = $2
        AND ($3::uuid IS NULL OR subsystem_id = $3) ORDER BY tag_no`, [projectId, KIND[discipline], subsystemId]);
  // One loader for the lot: each foundation is judged once, in batch (F1).
  const L = createLoader(db, projectId);
  await L.prime(rows.map((r) => r.id));
  const out = [];
  for (const r of rows) {
    const s = await tagStatus(db, { projectId, tagId: r.id, loader: L });
    out.push({ id: r.id, label: r.tag_no, subsystemId: r.subsystem_id, ...milestones(s.steps || [], spec) });
  }
  return out;
}

/** { items, installed, tested } for one discipline (and subsystem). */
export async function progressCounts(db, { projectId, discipline, subsystemId = null }) {
  if (SQL_DISCIPLINES[discipline]) {
    const { rows: [c] } = await db.query(
      `SELECT count(*)::int AS items,
              count(*) FILTER (WHERE is_installed)::int AS installed,
              count(*) FILTER (WHERE is_tested)::int AS tested
         FROM reporting.fact_progress
        WHERE project_key = $1 AND discipline = $2 AND ($3::uuid IS NULL OR subsystem_key = $3)`,
      [projectId, discipline, subsystemId]);
    return c;
  }
  return countItems(await engineItems(db, { projectId, discipline, subsystemId }));
}

/** Every discipline × subsystem, for the snapshot and the trend. */
export async function progressBreakdown(db, { projectId }) {
  const out = [];
  const { rows } = await db.query(
    `SELECT discipline::text AS discipline, subsystem_key AS subsystem_id, count(*)::int AS items,
            count(*) FILTER (WHERE is_installed)::int AS installed, count(*) FILTER (WHERE is_tested)::int AS tested
       FROM reporting.fact_progress WHERE project_key = $1 AND discipline::text = ANY($2::text[])
      GROUP BY 1, 2`, [projectId, Object.keys(SQL_DISCIPLINES)]);
  out.push(...rows);
  for (const d of Object.keys(ENGINE_DISCIPLINES)) {
    const items = await engineItems(db, { projectId, discipline: d });
    const by = new Map();
    for (const i of items) {
      const k = i.subsystemId || null;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(i);
    }
    for (const [k, list] of by) out.push({ discipline: d, subsystem_id: k, ...countItems(list) });
  }
  return out.filter((r) => r.items > 0);
}

export { PROGRESS_DISCIPLINES };
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
