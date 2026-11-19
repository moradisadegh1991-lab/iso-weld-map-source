/**
 * Duties and the workflow tree (migration 079; owner's requirements of
 * 2026-10-18, items 1–3 — docs/digital-epc/12-owner-requirements.md).
 *
 *   duty         a post in the project with the access it carries, and who
 *                holds it now
 *   workflow     a node of the tree: with stages it is a workflow, without
 *                it is a folder; a form follows one workflow, and one
 *                workflow may serve several forms
 *   page         a numbered, named page of a workflow and the parts of the
 *                form it holds
 *   group duty   a duty in a review group: its rights there, its days to
 *                review, the pages it reaches and the tree rows it may change
 *
 * The rules a report follows are lib/reports/workflow.mjs. Call inside
 * `withProject`.
 */
import { PERMISSIONS, RETIRED_PERMISSIONS } from "../../reports/workflow.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (w) => Object.assign(new Error(`${w} not found`), { status: 404 });
const blank = (v) => { const s = String(v ?? "").trim(); return s || null; };

/** Rights as the workflow knows them: known, at least one, the retired ones dropped. */
export function cleanPermissions(list) {
  const perms = [...new Set(list || [])].filter((p) => !RETIRED_PERMISSIONS.includes(p));
  const unknown = perms.filter((p) => !PERMISSIONS[p]);
  if (unknown.length) throw bad(`دسترسی ناشناخته: ${unknown.join("، ")}`);
  if (!perms.length) throw bad("دست‌کم یک دسترسی لازم است.");
  return perms;
}

/**
 * The parts of each kind of form a page may hold, by the form's code — the
 * contract daily report (CR), the earlier project daily report (DR) — and
 * `form` for a handover form. A page that names none holds them all.
 */
export const FORM_PARTS = {
  CR: { header: "سربرگ", narrative: "شرح کار", problems: "مشکلات", resources: "منابع", activities: "فعالیت‌های انجام‌شده", files: "عکس‌ها و پیوست‌ها" },
  DR: { manpower: "نیروی انسانی", equipment: "ماشین‌آلات", materials: "مصالح", work: "کار انجام‌شده", stoppages: "توقف‌ها", hse: "HSE روز" },
  form: { header: "سربرگ", rows: "ردیف‌ها" },
};

// ── duties ───────────────────────────────────────────────────────────────

// ── roles under a contract (owner's requirements 2026-10-22, item 1) ─────

/** The roles of every contract of the project, in order, each with its contract. */
export async function roles(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT r.id, r.contract_id, r.parent_id, r.name, r.description, r.seq, k.contract_no, k.title AS contract_title
       FROM contract_role r JOIN contract k ON k.id = r.contract_id WHERE r.project_id = $1 ORDER BY k.contract_no, r.seq, r.name`, [projectId]);
  return rows;
}

/** Serialize hierarchy changes per contract before checking the chain of parents. */
export async function saveRole(db, { projectId, id = null, contractId, name, description, seq = null, parentId }) {

  const write = async (tx) => {
    const { rows: [k] } = await tx.query("SELECT id FROM contract WHERE id = $1 AND project_id = $2 FOR NO KEY UPDATE", [contractId, projectId]);
    if (!k) throw notFound("contract");
    const { rows: [current] } = id
      ? await tx.query("SELECT * FROM contract_role WHERE id = $1 AND project_id = $2 FOR UPDATE", [id, projectId])
      : { rows: [] };
    if (id && !current) throw notFound("role");
    if (current && current.contract_id !== contractId) throw bad("قرارداد نقش موجود قابل تغییر نیست.");
    const cleanName = name === undefined ? current?.name : blank(name);
    if (!cleanName) throw bad("نام نقش لازم است.");
    if (cleanName.length > 80) throw bad("نام نقش تا ۸۰ نویسه.");
    const cleanDescription = description === undefined ? current?.description ?? null : blank(description);
    const parent = parentId === undefined ? current?.parent_id ?? null : parentId || null;
    if (parent) {
      const { rows: ancestry } = await tx.query(
        `WITH RECURSIVE ancestors AS (
           SELECT id, parent_id FROM contract_role WHERE id = $1 AND contract_id = $2 AND project_id = $3
           UNION
           SELECT r.id, r.parent_id FROM contract_role r JOIN ancestors a ON a.parent_id = r.id
             WHERE r.contract_id = $2 AND r.project_id = $3
         ) SELECT id FROM ancestors`, [parent, contractId, projectId]);
      if (!ancestry.length) throw bad("گره پدر باید از همین قرارداد باشد.");
      if (ancestry.some((a) => a.id === id)) throw bad("نقش زیر خودش یا زیرمجموعه‌اش قرار نمی‌گیرد.");
    }
    const { rows: [dup] } = await tx.query(
      "SELECT 1 FROM contract_role WHERE contract_id = $1 AND name = $2 AND id IS DISTINCT FROM $3", [contractId, cleanName, id]);
    if (dup) throw bad(`نقش «${cleanName}» در این قرارداد هست.`);
    const order = seq ?? (current?.parent_id === parent ? current.seq : null) ??
      (await tx.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM contract_role WHERE contract_id = $1 AND parent_id IS NOT DISTINCT FROM $2", [contractId, parent])).rows[0].n;
    const { rows: [r] } = id
      ? await tx.query("UPDATE contract_role SET name = $3, description = $4, seq = $5, parent_id = $6 WHERE id = $1 AND project_id = $2 RETURNING *",
        [id, projectId, cleanName, cleanDescription, order, parent])
      : await tx.query("INSERT INTO contract_role (project_id, contract_id, name, description, seq, parent_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [projectId, contractId, cleanName, cleanDescription, order, parent]);
    return r;
  };
  return db.inTransaction || !db.transaction ? write(db) : db.transaction(write);
}

/** A role that still gathers duties stays: its duties are moved or taken out of it first. */
export async function removeRole(db, { projectId, id }) {
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM duty WHERE role_id = $1 AND project_id = $2", [id, projectId]);
  if (n) throw bad(`این نقش ${n} وظیفه دارد؛ اول وظیفه‌ها را به نقش دیگری ببرید یا از نقش بیرون بیاورید.`);
  const { rows: [child] } = await db.query("SELECT 1 FROM contract_role WHERE parent_id = $1 AND project_id = $2 LIMIT 1", [id, projectId]);
  if (child) throw bad("ابتدا نقش‌های زیرمجموعه را جابه‌جا یا حذف کنید.");
  const { rowCount } = await db.query("DELETE FROM contract_role WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("role");
}

/** Tree rows that a contract daily report can refer to. */
export async function scopeTrees(db, { projectId }) {
  const { rows: cats } = await db.query(
    `SELECT c.id, c.parent_id AS "parentId", c.tree, c.name, k.id AS "contractId", k.contract_no AS "group"
       FROM contract_category c JOIN contract k ON k.id = c.contract_id
      WHERE k.project_id = $1 ORDER BY k.contract_no, c.tree, c.name`, [projectId]);
  const { rows: resources } = await db.query(
    `SELECT r.id, r.category_id AS "parentId", r.name, k.id AS "contractId", k.contract_no AS "group"
       FROM contract_resource r JOIN contract k ON k.id = r.contract_id
      WHERE k.project_id = $1 ORDER BY k.contract_no, r.name`, [projectId]);
  const { rows: plans } = await db.query(
    `SELECT p.id, p.code || ' ' || p.title AS name, true AS "planningNode", k.id AS "contractId", k.contract_no AS "group"
       FROM eps_pms p JOIN contract k ON k.id = p.contract_id
      WHERE p.project_id = $1 ORDER BY k.contract_no, p.code`, [projectId]);
  const { rows: wbs } = await db.query(
    `SELECT n.id, COALESCE(n.parent_id, p.id) AS "parentId", n.code || ' ' || n.name AS name, true AS "planningNode", p.contract_id AS "contractId"
       FROM wbs_node n JOIN eps_pms p ON p.id = n.pms_id
      WHERE p.project_id = $1 ORDER BY n.code`, [projectId]);
  const { rows: activities } = await db.query(
    `SELECT a.id, n.id AS "parentId", a.code || ' ' || a.name AS name, p.contract_id AS "contractId"
       FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id JOIN eps_pms p ON p.id = n.pms_id
      WHERE p.project_id = $1 ORDER BY a.code`, [projectId]);
  return {
    narrative: cats.filter((c) => c.tree === "narrative"),
    resource: [...cats.filter((c) => c.tree === "resource"), ...resources],
    work_group: cats.filter((c) => c.tree === "work_group"),
    wbs: [...plans, ...wbs, ...activities],
  };
}

async function cleanFormRules(db, { projectId, contractId, rules }) {
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const isId = (id) => typeof id === "string" && uuid.test(id);
  if (!Array.isArray(rules) || rules.some((r) => !isId(r?.formId) || !Array.isArray(r.rows) || r.rows.some((id) => !isId(id)))) {
    throw bad("فرم‌ها و ردیف‌های وظیفه معتبر نیستند.");
  }
  if (!rules.length) return [];
  const ids = rules.map((r) => r.formId.toLowerCase());
  if (new Set(ids).size !== ids.length) throw bad("هر فرم را یک بار برای وظیفه انتخاب کنید.");
  const { rows: types } = await db.query(
    "SELECT id, code FROM report_type WHERE project_id = $1 AND id = ANY($2::uuid[])", [projectId, ids]);
  if (types.length !== ids.length) throw bad("فرم وظیفه باید از همین پروژه باشد.");
  const scoped = rules.filter((r) => r.rows.length);
  if (scoped.some((r) => types.find((t) => t.id === r.formId.toLowerCase()).code !== "CR")) {
    throw bad("انتخاب ردیف برای فرم گزارش روزانهٔ قرارداد در دسترس است.");
  }
  if (scoped.length) {
    const trees = await scopeTrees(db, { projectId });
    const valid = new Set(Object.values(trees).flat().filter((n) => !contractId || n.contractId === contractId).map((n) => n.id));
    if (scoped.some((r) => r.rows.some((id) => !valid.has(id.toLowerCase())))) {
      throw bad("ردیف وظیفه باید از همین پروژه و در صورت انتخاب نقش، از قرارداد همان نقش باشد.");
    }
  }
  return rules.map((r) => ({ formId: r.formId.toLowerCase(), rows: [...new Set(r.rows.map((id) => id.toLowerCase()))] }));
}

/** Every duty of the project with its role, who holds it (each holder's own access and dates) and the groups it sits in. */
export async function duties(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT d.*, r.name AS role_name, r.contract_id, k.contract_no FROM duty d LEFT JOIN contract_role r ON r.id = d.role_id
       LEFT JOIN contract k ON k.id = r.contract_id WHERE d.project_id = $1 ORDER BY k.contract_no NULLS FIRST, r.seq NULLS FIRST, d.name`, [projectId]);
  const { rows: held } = await db.query(
    `SELECT dm.duty_id, dm.user_id, dm.permissions, dm.active, dm.temporary, dm.starts_on::text, dm.ends_on::text, u.display_name, u.email
       FROM duty_member dm LEFT JOIN app_user u ON u.id = dm.user_id WHERE dm.project_id = $1 ORDER BY u.display_name`, [projectId]);
  const { rows: used } = await db.query(
    `SELECT gd.duty_id, w.name AS workflow, s.name AS stage, g.name AS grp FROM group_duty gd
       JOIN review_group g ON g.id = gd.group_id JOIN report_stage s ON s.id = g.stage_id JOIN workflow w ON w.id = s.workflow_id
      WHERE gd.project_id = $1 ORDER BY w.name, s.seq`, [projectId]);
  return rows.map((d) => ({
    id: d.id, code: d.code, name: d.name, description: d.description, permissions: d.permissions,
    formRules: d.form_rules, pmsScope: d.pms_scope, active: d.active, roleId: d.role_id, roleName: d.role_name || null, contractId: d.contract_id || null, contractNo: d.contract_no || null,
    members: held.filter((h) => h.duty_id === d.id).map((h) => ({ userId: h.user_id, name: h.display_name || h.email,
      permissions: h.permissions || null, active: h.active, temporary: h.temporary, startsOn: h.starts_on, endsOn: h.ends_on })),
    usedIn: used.filter((u) => u.duty_id === d.id).map((u) => `${u.workflow} › ${u.stage} › ${u.grp}`),
  }));
}

export async function saveDuty(db, { projectId, id = null, code = null, name, description = null, permissions = ["view"], roleId = null, active = null, formRules = undefined, pmsScope = undefined }) {
  if (!blank(name)) throw bad("نام وظیفه لازم است.");
  const c = blank(code);
  if (c && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}$/.test(c)) throw bad("کد وظیفه: حروف و رقم لاتین، حداکثر ۲۴ نویسه.");
  const perms = cleanPermissions(permissions);
  const { rows: [dup] } = await db.query(
    "SELECT name FROM duty WHERE project_id = $1 AND (name = $2 OR ($3::text IS NOT NULL AND code = $3)) AND id IS DISTINCT FROM $4",
    [projectId, blank(name), c, id]);
  if (dup) throw bad(`وظیفهٔ «${dup.name}» با همین نام یا کد ثبت شده است.`);
  let contractId = null;
  if (roleId) {
    const { rows: [r] } = await db.query("SELECT contract_id FROM contract_role WHERE id = $1 AND project_id = $2", [roleId, projectId]);
    if (!r) throw notFound("role");
    contractId = r.contract_id;
  }
  // Keep older callers' rules; changing the role revalidates its contract.
  if (id && (formRules === undefined || pmsScope === undefined)) {
    const { rows: [prior] } = await db.query("SELECT role_id, form_rules, pms_scope FROM duty WHERE id = $1 AND project_id = $2", [id, projectId]);
    if (prior && prior.role_id !== (roleId || null)) {
      if (formRules === undefined) formRules = prior.form_rules;
      if (pmsScope === undefined) pmsScope = prior.pms_scope;
    }
  }
  const rules = formRules === undefined ? null : JSON.stringify(await cleanFormRules(db, { projectId, contractId, rules: formRules }));
  let scopedPms = null;
  if (pmsScope !== undefined) {
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (!Array.isArray(pmsScope) || pmsScope.some((id) => typeof id !== "string" || !uuid.test(id))) {
      throw bad("محدودهٔ PMS معتبر نیست.");
    }
    scopedPms = [...new Set(pmsScope.map((id) => id.toLowerCase()))];
    if (scopedPms.length) {
      if (!contractId) throw bad("برای انتخاب PMS، وظیفه باید نقش قراردادی داشته باشد.");
      const { rows } = await db.query(
        `SELECT p.id FROM eps_pms p WHERE p.project_id = $1 AND p.contract_id = $2 AND p.id = ANY($3::uuid[])
         UNION SELECT n.id FROM wbs_node n JOIN eps_pms p ON p.id = n.pms_id
          WHERE n.project_id = $1 AND p.contract_id = $2 AND n.id = ANY($3::uuid[])`, [projectId, contractId, scopedPms]);
      if (rows.length !== scopedPms.length) throw bad("PMS یا گرهٔ WBS باید از قرارداد همان نقش باشد.");
    }
  }
  const enabled = typeof active === "boolean" ? active : null;
  const { rows: [d] } = id
    ? await db.query(`UPDATE duty SET code = $3, name = $4, description = $5, permissions = $6, role_id = $7,
        active = COALESCE($8, active), form_rules = COALESCE($9::jsonb, form_rules), pms_scope = COALESCE($10::uuid[], pms_scope) WHERE id = $1 AND project_id = $2 RETURNING *`,
      [id, projectId, c, blank(name), blank(description), perms, roleId || null, enabled, rules, scopedPms])
    : await db.query(`INSERT INTO duty (project_id, code, name, description, permissions, role_id, active, form_rules, pms_scope)
        VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true),COALESCE($8::jsonb,'[]'::jsonb),COALESCE($9::uuid[],'{}')) RETURNING *`,
      [projectId, c, blank(name), blank(description), perms, roleId || null, enabled, rules, scopedPms]);
  if (!d) throw notFound("duty");
  return d;
}

/** A duty that sits in a group is taken out of it first: the workflow would otherwise lose a signer without anyone deciding so. */
export async function removeDuty(db, { projectId, id }) {
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM group_duty WHERE duty_id = $1 AND project_id = $2", [id, projectId]);
  if (n) throw bad(`این وظیفه در ${n} گروه گردش کار است؛ اول آن را از گروه‌ها بردارید.`);
  const { rowCount } = await db.query("DELETE FROM duty WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("duty");
}

/** Who holds a duty: the list replaces the one before. Every holder is a member of the project. */
export async function setDutyMembers(db, { projectId, dutyId, userIds = [] }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const { rows: [d] } = await db.query("SELECT id FROM duty WHERE id = $1 AND project_id = $2", [dutyId, projectId]);
  if (!d) throw notFound("duty");
  if (ids.length) {
    const { rows } = await db.query("SELECT user_id FROM project_member WHERE project_id = $1 AND user_id = ANY($2::uuid[])", [projectId, ids]);
    if (rows.length !== ids.length) throw bad("هر کسی که وظیفه‌ای می‌گیرد باید عضو پروژه باشد.");
  }
  await db.query("DELETE FROM duty_member WHERE duty_id = $1 AND NOT (user_id = ANY($2::uuid[]))", [dutyId, ids]);
  for (const u of ids) {
    await db.query("INSERT INTO duty_member (project_id, duty_id, user_id) VALUES ($1,$2,$3) ON CONFLICT (duty_id, user_id) DO NOTHING", [projectId, dutyId, u]);
  }
  return ids.length;
}

/**
 * One holder of a duty, with their own access level (owner's requirements
 * 2026-10-22, item 1): `permissions` — of the rights the duty has in each
 * group, only these (null: all of them) — and, when `temporary`, the first
 * and last day the holding counts; both days are required then.
 */
export async function setDutyMember(db, { projectId, dutyId, userId, permissions = null, temporary = false, startsOn = null, endsOn = null, active = null }) {
  const { rows: [d] } = await db.query("SELECT id FROM duty WHERE id = $1 AND project_id = $2", [dutyId, projectId]);
  if (!d) throw notFound("duty");
  const { rows: [m] } = await db.query("SELECT 1 FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  if (!m) throw bad("هر کسی که وظیفه‌ای می‌گیرد باید عضو پروژه باشد.");
  const perms = permissions == null ? null : cleanPermissions(permissions);
  const temp = temporary === true;
  const day = (v, what) => { const x = blank(v); if (!x) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw bad(`${what}: تاریخ به شکل YYYY-MM-DD.`); return x; };
  const [from, to] = [day(startsOn, "شروع دسترسی"), day(endsOn, "پایان دسترسی")];
  if (temp && (!from || !to)) throw bad("دسترسی موقت تاریخ شروع و پایان لازم دارد.");
  if (temp && to < from) throw bad("پایان دسترسی موقت پیش از شروع آن است.");
  await db.query(
    `INSERT INTO duty_member (project_id, duty_id, user_id, permissions, temporary, starts_on, ends_on, active) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,true))
     ON CONFLICT (duty_id, user_id) DO UPDATE SET permissions = EXCLUDED.permissions, temporary = EXCLUDED.temporary,
       starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on, active = COALESCE($8,duty_member.active)`,
    [projectId, dutyId, userId, perms, temp, temp ? from : null, temp ? to : null, typeof active === "boolean" ? active : null]);
}

export async function removeDutyMember(db, { projectId, dutyId, userId }) {
  const { rowCount } = await db.query("DELETE FROM duty_member WHERE duty_id = $1 AND user_id = $2 AND project_id = $3", [dutyId, userId, projectId]);
  if (!rowCount) throw notFound("holder");
}

// ── the workflow tree ────────────────────────────────────────────────────

/** Every node of the tree, flat, each with its stage count, its pages and the forms that follow it. */
export async function workflowTree(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT w.*, (SELECT count(*)::int FROM report_stage s WHERE s.workflow_id = w.id) AS stages
       FROM workflow w WHERE w.project_id = $1 ORDER BY w.seq, w.name`, [projectId]);
  const { rows: forms } = await db.query(
    `SELECT t.id, t.code, t.name, t.workflow_id, (SELECT count(*)::int FROM report r WHERE r.report_type_id = t.id) AS reports
       FROM report_type t WHERE t.project_id = $1 AND t.workflow_id IS NOT NULL ORDER BY t.code`, [projectId]);
  return rows.map((w) => ({ id: w.id, parentId: w.parent_id, code: w.code, name: w.name, description: w.description, seq: w.seq,
    stages: w.stages, forms: forms.filter((f) => f.workflow_id === w.id).map((f) => ({ id: f.id, code: f.code, name: f.name, reports: f.reports })) }));
}

/** Add a node, or rename or move one. A move under itself or its own branch is refused. */
export async function saveWorkflow(db, { projectId, id = null, parentId = null, code = null, name, description = null, seq = 1 }) {
  if (!blank(name)) throw bad("نام گردش کار لازم است.");
  const c = blank(code);
  if (c && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}$/.test(c)) throw bad("کد گردش کار: حروف و رقم لاتین، حداکثر ۲۴ نویسه.");
  if (c) {
    const { rows: [dup] } = await db.query("SELECT name FROM workflow WHERE project_id = $1 AND code = $2 AND id IS DISTINCT FROM $3", [projectId, c, id]);
    if (dup) throw bad(`کد ${c} برای گردش کار «${dup.name}» ثبت شده است.`);
  }
  if (parentId) {
    const { rows: [p] } = await db.query("SELECT id FROM workflow WHERE id = $1 AND project_id = $2", [parentId, projectId]);
    if (!p) throw notFound("parent workflow");
    if (id) {
      const { rows: [loop] } = await db.query(
        `WITH RECURSIVE up AS (SELECT id, parent_id FROM workflow WHERE id = $1
                               UNION ALL SELECT w.id, w.parent_id FROM workflow w JOIN up ON w.id = up.parent_id)
         SELECT 1 FROM up WHERE id = $2`, [parentId, id]);
      if (loop) throw bad("گره زیر خودش یا زیر شاخهٔ خودش نمی‌رود.");
    }
  }
  const { rows: [w] } = id
    ? await db.query("UPDATE workflow SET parent_id = $3, code = $4, name = $5, description = $6, seq = $7 WHERE id = $1 AND project_id = $2 RETURNING *",
      [id, projectId, parentId, c, blank(name), blank(description), Number(seq) || 1])
    : await db.query("INSERT INTO workflow (project_id, parent_id, code, name, description, seq) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [projectId, parentId, c, blank(name), blank(description), Number(seq) || 1]);
  if (!w) throw notFound("workflow");
  return w;
}

/** Only a node no form follows and nothing hangs under; its stages, groups and pages go with it. */
export async function removeWorkflow(db, { projectId, id }) {
  const { rows: [{ kids, forms }] } = await db.query(
    `SELECT (SELECT count(*)::int FROM workflow WHERE parent_id = $1) AS kids,
            (SELECT count(*)::int FROM report_type WHERE workflow_id = $1) AS forms`, [id]);
  if (kids) throw bad("زیر این گره گره‌های دیگری هست؛ اول آن‌ها را جابه‌جا یا حذف کنید.");
  if (forms) throw bad(`${forms} فرم از این گردش کار پیروی می‌کند؛ اول گردش کار آن‌ها را عوض کنید.`);
  const { rowCount } = await db.query("DELETE FROM workflow WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("workflow");
}

/**
 * The workflow a form follows. Changed only while the form has no report: a
 * report's history names stages by their order and signatures by their
 * group, and that has to keep meaning the same thing.
 */
export async function attachWorkflow(db, { projectId, reportTypeId, workflowId }) {
  const { rows: [t] } = await db.query(
    "SELECT t.*, (SELECT count(*)::int FROM report r WHERE r.report_type_id = t.id) AS reports FROM report_type t WHERE t.id = $1 AND t.project_id = $2",
    [reportTypeId, projectId]);
  if (!t) throw notFound("report type");
  if (workflowId) {
    const { rows: [w] } = await db.query(
      "SELECT w.id, (SELECT count(*)::int FROM report_stage s WHERE s.workflow_id = w.id) AS stages FROM workflow w WHERE w.id = $1 AND w.project_id = $2",
      [workflowId, projectId]);
    if (!w) throw notFound("workflow");
    if (!w.stages) throw bad("این گره مرحله‌ای ندارد؛ اول مراحل گردش کار را بسازید.");
  }
  if ((t.workflow_id || null) === (workflowId || null)) return t;
  if (t.reports) throw bad(`با «${t.name}» ${t.reports} گزارش ثبت شده است؛ گردش کار آن عوض نمی‌شود (تاریخچهٔ گزارش‌ها به مراحل همین گردش کار بسته است).`);
  const { rows: [r] } = await db.query("UPDATE report_type SET workflow_id = $2 WHERE id = $1 RETURNING *", [t.id, workflowId || null]);
  return r;
}

// ── pages ────────────────────────────────────────────────────────────────

export async function savePage(db, { projectId, workflowId, id = null, pageNo, name, sections = [] }) {
  const no = Number(pageNo);
  if (!Number.isInteger(no) || no < 1) throw bad("شمارهٔ صفحه عدد صحیح مثبت است.");
  if (!blank(name)) throw bad("نام صفحه لازم است.");
  const secs = [...new Set((sections || []).map((x) => String(x).trim()).filter(Boolean))];
  const { rows: [dup] } = await db.query("SELECT name FROM workflow_page WHERE workflow_id = $1 AND page_no = $2 AND id IS DISTINCT FROM $3", [workflowId, no, id]);
  if (dup) throw bad(`صفحهٔ ${no} («${dup.name}») در این گردش کار هست.`);
  const { rows: [p] } = id
    ? await db.query("UPDATE workflow_page SET page_no = $3, name = $4, sections = $5 WHERE id = $1 AND project_id = $2 RETURNING *", [id, projectId, no, blank(name), secs])
    : await db.query("INSERT INTO workflow_page (project_id, workflow_id, page_no, name, sections) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [projectId, workflowId, no, blank(name), secs]);
  if (!p) throw notFound("page");
  return p;
}

/** The page is taken out of every duty's reach with it. */
export async function removePage(db, { projectId, id }) {
  await db.query("UPDATE group_duty SET pages = array_remove(pages, $1::uuid) WHERE project_id = $2 AND $1::uuid = ANY(pages)", [id, projectId]);
  const { rowCount } = await db.query("DELETE FROM workflow_page WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("page");
}

// ── a duty in a group ────────────────────────────────────────────────────

/**
 * Put a duty in a review group, or change what it may do there: its rights
 * (the duty's own when none are given), its days to review, the pages it
 * reaches and the tree rows it may change. Pages must be the workflow's own.
 */
export async function setGroupDuty(db, { projectId, groupId, dutyId, permissions = null, reviewDays = null, pages = [], scope = [] }) {
  const { rows: [g] } = await db.query(
    "SELECT g.id, s.workflow_id FROM review_group g JOIN report_stage s ON s.id = g.stage_id WHERE g.id = $1 AND g.project_id = $2", [groupId, projectId]);
  if (!g) throw notFound("group");
  const { rows: [d] } = await db.query("SELECT * FROM duty WHERE id = $1 AND project_id = $2", [dutyId, projectId]);
  if (!d) throw notFound("duty");
  if (!d.active) throw bad("فقط وظیفهٔ فعال را می‌توان به گردش کار افزود.");
  const perms = cleanPermissions(permissions && permissions.length ? permissions : d.permissions);
  const days = reviewDays === null || reviewDays === undefined || reviewDays === "" ? null : Number(reviewDays);
  if (days !== null && (!Number.isInteger(days) || days < 1)) throw bad("مهلت بررسی تعداد روز است: عدد صحیح، دست‌کم ۱.");
  const pg = [...new Set((pages || []).filter(Boolean))];
  if (pg.length) {
    const { rows } = await db.query("SELECT id FROM workflow_page WHERE workflow_id = $1 AND id = ANY($2::uuid[])", [g.workflow_id, pg]);
    if (rows.length !== pg.length) throw bad("صفحه‌ها باید از همین گردش کار باشند.");
  }
  const sc = [...new Set((scope || []).map(String).filter(Boolean))];
  const { rows: [r] } = await db.query(
    `INSERT INTO group_duty (project_id, group_id, duty_id, permissions, review_days, pages, scope) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (group_id, duty_id) DO UPDATE SET permissions = EXCLUDED.permissions, review_days = EXCLUDED.review_days,
       pages = EXCLUDED.pages, scope = EXCLUDED.scope RETURNING *`, [projectId, groupId, dutyId, perms, days, pg, sc]);
  return r;
}

export async function removeGroupDuty(db, { projectId, groupId, dutyId }) {
  await db.query("DELETE FROM group_duty WHERE project_id = $1 AND group_id = $2 AND duty_id = $3", [projectId, groupId, dutyId]);
}
