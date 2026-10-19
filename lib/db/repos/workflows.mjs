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

/** Every duty of the project with who holds it and the groups it sits in. */
export async function duties(db, { projectId }) {
  const { rows } = await db.query("SELECT * FROM duty WHERE project_id = $1 ORDER BY name", [projectId]);
  const { rows: held } = await db.query(
    `SELECT dm.duty_id, dm.user_id, u.display_name, u.email FROM duty_member dm LEFT JOIN app_user u ON u.id = dm.user_id
      WHERE dm.project_id = $1 ORDER BY u.display_name`, [projectId]);
  const { rows: used } = await db.query(
    `SELECT gd.duty_id, w.name AS workflow, s.name AS stage, g.name AS grp FROM group_duty gd
       JOIN review_group g ON g.id = gd.group_id JOIN report_stage s ON s.id = g.stage_id JOIN workflow w ON w.id = s.workflow_id
      WHERE gd.project_id = $1 ORDER BY w.name, s.seq`, [projectId]);
  return rows.map((d) => ({
    id: d.id, code: d.code, name: d.name, description: d.description, permissions: d.permissions,
    members: held.filter((h) => h.duty_id === d.id).map((h) => ({ userId: h.user_id, name: h.display_name || h.email })),
    usedIn: used.filter((u) => u.duty_id === d.id).map((u) => `${u.workflow} › ${u.stage} › ${u.grp}`),
  }));
}

export async function saveDuty(db, { projectId, id = null, code = null, name, description = null, permissions = ["view"] }) {
  if (!blank(name)) throw bad("نام وظیفه لازم است.");
  const c = blank(code);
  if (c && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}$/.test(c)) throw bad("کد وظیفه: حروف و رقم لاتین، حداکثر ۲۴ نویسه.");
  const perms = cleanPermissions(permissions);
  const { rows: [dup] } = await db.query(
    "SELECT name FROM duty WHERE project_id = $1 AND (name = $2 OR ($3::text IS NOT NULL AND code = $3)) AND id IS DISTINCT FROM $4",
    [projectId, blank(name), c, id]);
  if (dup) throw bad(`وظیفهٔ «${dup.name}» با همین نام یا کد ثبت شده است.`);
  const { rows: [d] } = id
    ? await db.query("UPDATE duty SET code = $3, name = $4, description = $5, permissions = $6 WHERE id = $1 AND project_id = $2 RETURNING *",
      [id, projectId, c, blank(name), blank(description), perms])
    : await db.query("INSERT INTO duty (project_id, code, name, description, permissions) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [projectId, c, blank(name), blank(description), perms]);
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
