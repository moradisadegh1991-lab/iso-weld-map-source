import { latestToday } from "../../civil/concrete.mjs";
import { effective } from "../../reports/contract-daily.mjs";

const denied = () => Object.assign(new Error("این کار خارج از محدودهٔ PMS وظیفهٔ شماست."), { status: 403, code: "FORBIDDEN" });

/**
 * Null keeps existing contract access. Once a user has an assigned scoped
 * duty, only the PMSs of their currently effective scoped duties are allowed.
 */
export async function pmsScopeOf(db, { projectId, userId }) {
  const { rows } = await db.query(
    `SELECT d.pms_scope, (d.active AND dm.active AND u.is_active
       AND (NOT dm.temporary OR $3::date BETWEEN dm.starts_on AND dm.ends_on)) AS applicable
       FROM duty_member dm JOIN duty d ON d.id = dm.duty_id JOIN app_user u ON u.id = dm.user_id
      WHERE dm.project_id = $1 AND dm.user_id = $2 AND cardinality(d.pms_scope) > 0`, [projectId, userId, latestToday()]);
  return rows.length ? new Set(rows.filter((r) => r.applicable).flatMap((r) => r.pms_scope)) : null;
}

const targetQueries = {
  version: "SELECT pms_id FROM eps_version WHERE id = $1 AND project_id = $2 FOR SHARE",
  node: "SELECT pms_id FROM wbs_node WHERE id = $1 AND project_id = $2 FOR SHARE",
  activity: `SELECT n.pms_id FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id
             WHERE a.id = $1 AND a.project_id = $2 FOR SHARE OF a, n`,
  plan: `SELECT v.pms_id FROM activity_plan x JOIN eps_version v ON v.id = x.version_id
         WHERE x.id = $1 AND x.project_id = $2 FOR SHARE OF x, v`,
  requirement: `SELECT v.pms_id FROM activity_requirement x JOIN eps_version v ON v.id = x.version_id
                WHERE x.id = $1 AND x.project_id = $2 FOR SHARE OF x, v`,
  comment: `SELECT v.pms_id FROM activity_comment x JOIN eps_version v ON v.id = x.version_id
            WHERE x.id = $1 AND x.project_id = $2 FOR SHARE OF x, v`,
  relation: `SELECT n.pms_id FROM activity_relation r JOIN wbs_activity a ON a.id = r.pred_id
             JOIN wbs_node n ON n.id = a.node_id WHERE r.id = $1 AND r.project_id = $2 FOR SHARE OF r, a, n`,
  role: `SELECT n.pms_id FROM activity_role r JOIN wbs_activity a ON a.id = r.activity_id
         JOIN wbs_node n ON n.id = a.node_id WHERE r.id = $1 AND r.project_id = $2 FOR SHARE OF r, a, n`,
  delay: `SELECT n.pms_id FROM activity_delay r JOIN wbs_activity a ON a.id = r.activity_id
          JOIN wbs_node n ON n.id = a.node_id WHERE r.id = $1 AND r.project_id = $2 FOR SHARE OF r, a, n`,
  rule: "SELECT pms_id FROM scope_rule WHERE id = $1 AND project_id = $2 FOR SHARE",
};

/** All named targets must belong to allowed PMSs. No target means a shared operation. */
export async function assertPmsTargets(db, projectId, scope, targets) {
  if (!scope) return;
  const present = targets.filter(([, id]) => id);
  if (!present.length) throw denied();
  for (const [kind, id] of present) {
    const pmsId = kind === "pms" ? id : (await db.query(targetQueries[kind], [id, projectId])).rows[0]?.pms_id;
    if (!scope.has(pmsId)) throw denied();
  }
}

export async function progressActivityOf(db, { projectId, reportId, rowId }) {
  const { rows: [version] } = await db.query(
    `SELECT v.content FROM report_version v JOIN report r ON r.id = v.report_id
      WHERE r.id = $1 AND r.project_id = $2 ORDER BY v.version_no DESC LIMIT 1`, [reportId, projectId]);
  const line = version?.content?.activities?.find((row) => row.id === rowId);
  const activityId = line && effective(line).activityId;
  if (!activityId) throw denied();
  return activityId;
}
