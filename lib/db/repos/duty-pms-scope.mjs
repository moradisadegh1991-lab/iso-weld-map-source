import { latestToday } from "../../civil/concrete.mjs";
import { effective } from "../../reports/contract-daily.mjs";

const denied = () => Object.assign(new Error("این کار خارج از محدودهٔ PMS یا WBS وظیفهٔ شماست."), { status: 403, code: "FORBIDDEN" });

/**
 * Null keeps existing contract access. Once a user has an assigned scoped
 * duty, only its currently effective PMS and WBS selections are allowed.
 */
export async function pmsScopeOf(db, { projectId, userId, form }) {
  const { rows } = await db.query(
    `SELECT d.pms_scope, d.planning_forms, cr.contract_id, (d.active AND dm.active AND u.is_active
       AND (NOT dm.temporary OR $3::date BETWEEN dm.starts_on AND dm.ends_on)) AS applicable
       FROM duty_member dm JOIN duty d ON d.id = dm.duty_id JOIN app_user u ON u.id = dm.user_id
       LEFT JOIN contract_role cr ON cr.id = d.role_id
      WHERE dm.project_id = $1 AND dm.user_id = $2 AND (cardinality(d.pms_scope) > 0 OR d.planning_forms <> '{}'::jsonb)`, [projectId, userId, latestToday()]);
  if (!rows.length) return null;
  const selected = new Set();
  const contracts = new Set();
  for (const duty of rows.filter((r) => r.applicable)) {
    if (!Object.keys(duty.planning_forms).length) {
      duty.pms_scope.forEach((id) => selected.add(id));
      continue;
    }
    const ids = duty.planning_forms[form];
    if (!Array.isArray(ids)) continue;
    if (!ids.length && duty.contract_id) contracts.add(duty.contract_id);
    ids.forEach((id) => selected.add(id));
  }
  const { rows: plans } = await db.query(
    "SELECT id FROM eps_pms WHERE project_id = $1 AND (id = ANY($2::uuid[]) OR contract_id = ANY($3::uuid[]))",
    [projectId, [...selected], [...contracts]]);
  const { rows: branches } = await db.query(
    `WITH RECURSIVE branch AS (
       SELECT id, pms_id FROM wbs_node WHERE project_id = $1 AND id = ANY($2::uuid[])
       UNION
       SELECT n.id, n.pms_id FROM wbs_node n JOIN branch b ON b.id = n.parent_id AND b.pms_id = n.pms_id
       WHERE n.project_id = $1
     )
     SELECT b.id, b.pms_id, a.id AS activity_id FROM branch b LEFT JOIN wbs_activity a ON a.node_id = b.id`,
    [projectId, [...selected]]);
  return {
    pmsIds: new Set([...plans.map((p) => p.id), ...branches.map((b) => b.pms_id)]),
    whole: new Set(plans.map((p) => p.id)),
    nodes: new Set(branches.map((b) => b.id)),
    activities: new Set(branches.map((b) => b.activity_id).filter(Boolean)),
  };
}

const targetQueries = {
  version: "SELECT pms_id FROM eps_version WHERE id = $1 AND project_id = $2 FOR SHARE",
  node: "SELECT pms_id, id AS node_id FROM wbs_node WHERE id = $1 AND project_id = $2 FOR SHARE",
  activity: `SELECT n.pms_id, a.id AS activity_id FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id
             WHERE a.id = $1 AND a.project_id = $2 FOR SHARE OF a, n`,
  plan: `SELECT v.pms_id, x.activity_id FROM activity_plan x JOIN eps_version v ON v.id = x.version_id
         WHERE x.id = $1 AND x.project_id = $2 FOR SHARE OF x, v`,
  requirement: `SELECT v.pms_id, x.activity_id, x.pred_activity_id AS second_activity_id FROM activity_requirement x JOIN eps_version v ON v.id = x.version_id
                WHERE x.id = $1 AND x.project_id = $2 FOR SHARE OF x, v`,
  comment: `SELECT v.pms_id, x.activity_id FROM activity_comment x JOIN eps_version v ON v.id = x.version_id
            WHERE x.id = $1 AND x.project_id = $2 FOR SHARE OF x, v`,
  relation: `SELECT n.pms_id, r.pred_id AS activity_id, r.succ_id AS second_activity_id FROM activity_relation r JOIN wbs_activity a ON a.id = r.pred_id
             JOIN wbs_node n ON n.id = a.node_id WHERE r.id = $1 AND r.project_id = $2 FOR SHARE OF r, a, n`,
  role: `SELECT n.pms_id, r.activity_id FROM activity_role r JOIN wbs_activity a ON a.id = r.activity_id
         JOIN wbs_node n ON n.id = a.node_id WHERE r.id = $1 AND r.project_id = $2 FOR SHARE OF r, a, n`,
  delay: `SELECT n.pms_id, r.activity_id FROM activity_delay r JOIN wbs_activity a ON a.id = r.activity_id
          JOIN wbs_node n ON n.id = a.node_id WHERE r.id = $1 AND r.project_id = $2 FOR SHARE OF r, a, n`,
  rule: "SELECT pms_id, activity_id, node_id FROM scope_rule WHERE id = $1 AND project_id = $2 FOR SHARE",
};

/** A blank target list is reserved for shared operations. */
export async function assertPmsTargets(db, projectId, scope, targets, { whole = false } = {}) {
  if (!scope) return;
  const present = targets.filter(([, id]) => id);
  if (!present.length) throw denied();
  const pmsIds = new Set();
  for (const [kind, id] of present) {
    const t = kind === "pms" ? { pms_id: id } : (await db.query(targetQueries[kind], [id, projectId])).rows[0];
    if (scope.whole.has(t?.pms_id)) { pmsIds.add(t.pms_id); continue; }
    if (whole || !scope.pmsIds.has(t?.pms_id)) throw denied();
    if (t.node_id && !scope.nodes.has(t.node_id)) throw denied();
    if (t.activity_id && !scope.activities.has(t.activity_id)) throw denied();
    if (t.second_activity_id && !scope.activities.has(t.second_activity_id)) throw denied();
    pmsIds.add(t.pms_id);
  }
  return pmsIds;
}

export async function assertPmsContractScope(db, { projectId, contractId, scope }) {
  if (!scope) return;
  const { rows } = await db.query(
    "SELECT 1 FROM eps_pms WHERE project_id = $1 AND contract_id = $2 AND id = ANY($3::uuid[]) LIMIT 1",
    [projectId, contractId, [...scope.pmsIds]]);
  if (!rows.length) throw denied();
}

export function visibleActivity(scope, pmsId, activityId) {
  return !scope || scope.whole.has(pmsId) || scope.activities.has(activityId);
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

export async function transferRights(db, { projectId, userId, contractId, form, role }) {
  if (["admin", "developer"].includes(role)) return { import: true, export: true };
  const { rows } = await db.query(
    `SELECT CASE WHEN d.active AND dm.active AND (NOT dm.temporary OR $4::date BETWEEN dm.starts_on AND dm.ends_on)
       THEN ARRAY(SELECT p FROM unnest(d.permissions) p WHERE dm.permissions IS NULL OR p = ANY(dm.permissions))
       ELSE '{}'::text[] END AS permissions
       FROM duty_member dm JOIN duty d ON d.id = dm.duty_id LEFT JOIN contract_role r ON r.id = d.role_id
      WHERE dm.project_id = $1 AND dm.user_id = $2 AND (r.contract_id IS NULL OR r.contract_id = $3)
        AND (d.planning_forms ? $5 OR (d.planning_forms = '{}'::jsonb AND
          (cardinality(d.pms_scope) > 0 OR r.contract_id IS NOT NULL OR d.permissions && ARRAY['import', 'export'])))`,
    [projectId, userId, contractId, latestToday(), form]);
  return {
    import: !rows.length || rows.some((duty) => duty.permissions.includes("import")),
    export: !rows.length || rows.some((duty) => duty.permissions.includes("export")),
  };
}

export async function assertImport(db, context) {
  if (!(await transferRights(db, context)).import) {
    throw Object.assign(new Error("وظیفهٔ شما مجوز ورود فایل ندارد."), { status: 403, code: "IMPORT_FORBIDDEN" });
  }
}
