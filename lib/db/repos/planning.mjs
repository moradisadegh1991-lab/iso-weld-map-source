/**
 * A version's planning rows (activity_plan, migration 083; the rules are
 * lib/eps/planning.mjs): which of the PMS's activities the version carries,
 * with their start, finish, work done before and planned quantity. Rows are
 * added one or many at a time, edited where they stand, copied between
 * versions of one PMS and read from an Excel sheet. Call inside
 * `withProject`.
 */
import * as XLSX from "xlsx";
import * as eps from "./eps.mjs";
import { activityView, progressLines } from "./eps-activities.mjs";
import * as pl from "../../eps/planning.mjs";
import { logEvent } from "./log.mjs";
import { COST_COLS, PLAN_COST_FIELDS } from "../../eps/costs.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (x) => Object.assign(new Error(`${x} not found`), { status: 404 });
const iso = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d ? String(d).slice(0, 10) : null);
const n = (v) => (v === null || v === undefined ? null : Number(v));
/** The cost and float a call sends for a planning row (lib/eps/costs.mjs): left out, kept; a cost is never below zero. */
function planCosts(input) {
  const out = {};
  for (const f of PLAN_COST_FIELDS) {
    const v = input[f.key];
    if (v === undefined) continue;
    if (v === null || String(v).trim() === "") { out[f.col] = null; continue; }
    const x = Number(String(v).replace(/[٬,]/g, ""));
    if (!Number.isFinite(x)) throw bad(`${f.head}: «${v}» عدد نیست.`);
    if (f.cost && x < 0) throw bad(`${f.head} منفی نمی‌شود.`);
    out[f.col] = x;
  }
  return out;
}
const LOG = (db, projectId, label, comment, userId) => logEvent(db, { projectId, section: "controls", entityType: "eps", entityId: null, label, action: "updated", comment, userId });

/** Every activity of the version's PMS as the tree holds it (no version over it): id → activity with its node code. */
async function treeActs(db, projectId, v) {
  const view = await activityView(db, { projectId, pmsId: v.pms_id });
  const out = new Map();
  const walk = (node) => { for (const a of node.activities) out.set(a.id, { ...a, node_code: node.code, node_name: node.name }); node.children.forEach(walk); };
  view.roots.forEach(walk);
  return out;
}

async function versionOf(db, projectId, versionId) {
  const v = await eps.planOf(db, projectId, { versionId });
  if (!v.isVersion) throw bad("نسخه را انتخاب کنید.");
  return v;
}

/** The version's planning rows, each with its activity and the figures it leads to. */
export async function planRows(db, { projectId, versionId }) {
  const v = await versionOf(db, projectId, versionId);
  const acts = await treeActs(db, projectId, v);
  const { rows } = await db.query("SELECT * FROM activity_plan WHERE version_id = $1 ORDER BY seq, created_at", [versionId]);
  const list = rows.map((p) => {
    const a = acts.get(p.activity_id) || null;
    const row = { ...p, start_on: iso(p.start_on), end_on: iso(p.end_on), done_before: n(p.done_before), volume_plan: n(p.volume_plan),
      ...Object.fromEntries(COST_COLS.map((c) => [c, n(p[c])])) };
    return { ...row, ...pl.planFigures(row, a), code: a?.code, name: a?.name, node_code: a?.node_code, node_name: a?.node_name, unit: a?.unit || null,
      activityNo: a?.activity_no || null, done: a?.done ?? null, pct: a?.pct ?? null };
  });
  return { version: { id: v.id, code: v.code, title: v.title, master: v.master, pms_id: v.pms_id, pms_code: v.pms_code, contract_id: v.contract_id }, rows: list };
}

/**
 * Activities into the version's planning, with the figures typed (the same
 * for each) and the rest from each activity. An activity the version
 * already carries is left as it is and named; the set is refused as a whole
 * if any row does not hold.
 */
export async function addToPlan(db, { projectId, versionId, activityIds = [], startOn = null, days = null, endOn = null, doneBefore = null, volumePlan = null, description = null, userId }) {
  const ids = [...new Set(activityIds)];
  if (!ids.length) throw bad("فعالیتی انتخاب نشده است.");
  const v = await versionOf(db, projectId, versionId);
  const acts = await treeActs(db, projectId, v);
  const lines = await progressLines(db, { projectId, contractId: v.contract_id });
  const { rows: have } = await db.query("SELECT activity_id FROM activity_plan WHERE version_id = $1", [versionId]);
  const already = new Set(have.map((x) => x.activity_id));
  const rows = [], problems = [], skipped = [];
  for (const id of ids) {
    const a = acts.get(id);
    if (!a) { problems.push("فعالیت از WBS این PMS نیست."); continue; }
    if (already.has(id)) { skipped.push(a.code); continue; }
    const r = pl.planRow({ startOn, days, endOn, doneBefore, volumePlan, description }, a, { lines });
    if (r.problem) problems.push(r.problem); else rows.push({ id, ...r.row });
  }
  if (problems.length) throw bad(problems.join(" "));
  const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) AS n FROM activity_plan WHERE version_id = $1", [versionId]);
  let seq = m.n;
  for (const r of rows) {
    await db.query(
      `INSERT INTO activity_plan (project_id, version_id, activity_id, start_on, end_on, done_before, volume_plan, description, seq, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [projectId, versionId, r.id, r.start_on, r.end_on, r.done_before, r.volume_plan, r.description, ++seq, userId]);
  }
  if (rows.length) await LOG(db, projectId, `برنامهٔ نسخهٔ ${v.code}`, `${rows.length} فعالیت افزوده شد`, userId);
  return { added: rows.length, skipped };
}

/** A planning row edited where it stands: a field left out of the call is kept; days, when typed, set the finish from the start. */
export async function savePlanRow(db, { projectId, id, userId, ...input }) {
  const { rows: [p] } = await db.query("SELECT * FROM activity_plan WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!p) throw notFound("plan row");
  const v = await versionOf(db, projectId, p.version_id);
  const a = (await treeActs(db, projectId, v)).get(p.activity_id);
  const keep = (k, col) => (input[k] === undefined ? (col.endsWith("_on") ? iso(p[col]) : p[col]) : input[k]);
  const typed = { startOn: keep("startOn", "start_on"), endOn: keep("endOn", "end_on"), days: input.days, doneBefore: keep("doneBefore", "done_before"),
    volumePlan: keep("volumePlan", "volume_plan"), description: keep("description", "description") };
  // a field emptied on purpose goes back to what the activity gives
  const r = pl.planRow(typed, a, { lines: await progressLines(db, { projectId, contractId: v.contract_id }) });
  if (r.problem) throw bad(r.problem);
  // the cost and float typed (091); the two percentages follow from them in the database
  const costs = planCosts(input), ck = Object.keys(costs);
  const { rows: [row] } = await db.query(
    `UPDATE activity_plan SET start_on = $2, end_on = $3, done_before = $4, volume_plan = $5, description = $6${ck.map((c, i) => `, ${c} = $${7 + i}`).join("")}
      WHERE id = $1 RETURNING *`,
    [id, r.row.start_on, r.row.end_on, r.row.done_before, r.row.volume_plan, r.row.description, ...ck.map((c) => costs[c])]);
  await LOG(db, projectId, `برنامهٔ نسخهٔ ${v.code}`, `${a?.code || ""} ویرایش شد`, userId);
  return row;
}

/** Planning rows out of their versions (the activities stay on the WBS); a row requirements or comments hang on is kept. */
export async function removePlanRows(db, { projectId, ids = [], userId }) {
  if (!ids.length) throw bad("ردیفی انتخاب نشده است.");
  const { rows: hang } = await db.query(
    `SELECT a.code FROM activity_plan x JOIN wbs_activity a ON a.id = x.activity_id
      WHERE x.id = ANY($1) AND (EXISTS (SELECT 1 FROM activity_requirement q WHERE q.version_id = x.version_id AND q.activity_id = x.activity_id)
        OR EXISTS (SELECT 1 FROM activity_comment c WHERE c.version_id = x.version_id AND c.activity_id = x.activity_id))`, [ids]);
  if (hang.length) throw bad(`نیازمندی یا کامنت روی این ردیف‌ها هست و حذف نمی‌شوند: ${hang.map((x) => x.code).join("، ")}`);
  const { rowCount } = await db.query("DELETE FROM activity_plan WHERE id = ANY($1) AND project_id = $2", [ids, projectId]);
  if (!rowCount) throw notFound("plan row");
  await LOG(db, projectId, "برنامهٔ نسخه", `${rowCount} ردیف حذف شد`, userId);
  return { removed: rowCount };
}

/**
 * Everything one version plans into another of the same PMS: rows the
 * target lacks are added; rows it has are overwritten only with `replace`.
 */
const TYPED = PLAN_COST_FIELDS.map((f) => f.col);
export async function copyPlan(db, { projectId, fromVersionId, toVersionId, replace = false, userId }) {
  if (fromVersionId === toVersionId) throw bad("نسخهٔ مبدأ و مقصد یکی است.");
  const from = await versionOf(db, projectId, fromVersionId), to = await versionOf(db, projectId, toVersionId);
  if (from.pms_id !== to.pms_id) throw bad("برنامه فقط میان نسخه‌های یک PMS کپی می‌شود؛ فعالیت‌های PMS دیگر در WBS مقصد نیستند.");
  const { rows: src } = await db.query("SELECT * FROM activity_plan WHERE version_id = $1 ORDER BY seq", [fromVersionId]);
  const { rows: dst } = await db.query("SELECT activity_id FROM activity_plan WHERE version_id = $1", [toVersionId]);
  const there = new Set(dst.map((x) => x.activity_id));
  const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) AS n FROM activity_plan WHERE version_id = $1", [toVersionId]);
  let seq = m.n, added = 0, replaced = 0, kept = 0;
  for (const p of src) {
    const vals = [p.start_on, p.end_on, p.done_before, p.volume_plan, p.description, ...TYPED.map((c) => p[c])];
    if (there.has(p.activity_id)) {
      if (!replace) { kept++; continue; }
      await db.query(`UPDATE activity_plan SET start_on = $3, end_on = $4, done_before = $5, volume_plan = $6, description = $7${TYPED.map((c, i) => `, ${c} = $${8 + i}`).join("")}
        WHERE version_id = $1 AND activity_id = $2`, [toVersionId, p.activity_id, ...vals]);
      replaced++;
    } else {
      await db.query(
        `INSERT INTO activity_plan (project_id, version_id, activity_id, start_on, end_on, done_before, volume_plan, description, ${TYPED.join(", ")}, seq, created_by)
         VALUES ($1,$2,$3,${[...vals, 0, 0].map((_, i) => `$${4 + i}`).join(",")})`, [projectId, toVersionId, p.activity_id, ...vals, ++seq, userId]);
      added++;
    }
  }
  await LOG(db, projectId, `برنامهٔ نسخهٔ ${to.code}`, `کپی از ${from.code}: ${added} افزوده، ${replaced} جایگزین، ${kept} دست‌نخورده`, userId);
  return { added, replaced, kept };
}

/**
 * A planning sheet into the version: each line names an activity of the
 * PMS's WBS by its code (and its WBS code where the code repeats). A line
 * for an activity the version carries rewrites its row; a new one adds it.
 * Refused as a whole when any line does not hold.
 */
export async function importPlanSheet(db, { projectId, versionId, content, userId }) {
  const v = await versionOf(db, projectId, versionId);
  let rows;
  try {
    const wb = XLSX.read(Buffer.isBuffer(content) ? content : Buffer.from(content), { type: "buffer", cellDates: true });
    const name = wb.SheetNames.find((s) => /^plan(ning)?$/i.test(s.trim())) || wb.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
  } catch { throw bad("فایل اکسل خوانده نشد."); }
  const { lines, problems } = pl.fromPlanSheet(rows);
  if (!lines.length) throw bad(problems.join(" ") || "در فایل هیچ ردیفی با کد فعالیت نبود.");
  const acts = [...(await treeActs(db, projectId, v)).values()];
  const progress = await progressLines(db, { projectId, contractId: v.contract_id });
  const { rows: have } = await db.query("SELECT id, activity_id FROM activity_plan WHERE version_id = $1", [versionId]);
  const rowOf = new Map(have.map((x) => [x.activity_id, x.id]));
  const out = [];
  for (const l of lines) {
    const hits = acts.filter((a) => a.code === l.code && (!l.wbs || a.node_code === l.wbs));
    if (!hits.length) { problems.push(`ردیف ${l.row}: فعالیت ${l.wbs ? `${l.wbs} / ` : ""}${l.code} در WBS این PMS نیست.`); continue; }
    if (hits.length > 1) { problems.push(`ردیف ${l.row}: کد ${l.code} زیر چند گره هست؛ ستون «WBS code» را پر کنید.`); continue; }
    const r = pl.planRow(l, hits[0], { lines: progress });
    if (r.problem) problems.push(`ردیف ${l.row}: ${r.problem}`); else out.push({ act: hits[0], ...r.row });
  }
  if (problems.length) throw bad(problems.slice(0, 30).join(" "));
  const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) AS n FROM activity_plan WHERE version_id = $1", [versionId]);
  let seq = m.n, added = 0, updated = 0;
  for (const r of out) {
    const vals = [r.start_on, r.end_on, r.done_before, r.volume_plan, r.description];
    if (rowOf.has(r.act.id)) {
      await db.query("UPDATE activity_plan SET start_on = $2, end_on = $3, done_before = $4, volume_plan = $5, description = $6 WHERE id = $1", [rowOf.get(r.act.id), ...vals]);
      updated++;
    } else {
      await db.query(
        `INSERT INTO activity_plan (project_id, version_id, activity_id, start_on, end_on, done_before, volume_plan, description, seq, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [projectId, versionId, r.act.id, ...vals, ++seq, userId]);
      rowOf.set(r.act.id, true);
      added++;
    }
  }
  await LOG(db, projectId, `برنامهٔ نسخهٔ ${v.code}`, `ورود از اکسل: ${added} افزوده، ${updated} به‌روز`, userId);
  return { added, updated };
}

// ── the preview's sub-forms (items 13–28; migration 084) ─────────────────

const text = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).replace(/\s+/g, " ").trim());
const dateIn = (v, what) => {
  const x = text(v);
  if (!x) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw bad(`${what}: تاریخ به شکل YYYY-MM-DD.`);
  return x;
};
const numIn = (v, what) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const x = Number(String(v).replace(/[٬,]/g, ""));
  if (!Number.isFinite(x) || x < 0) throw bad(`${what}: عددی صفر یا بیشتر.`);
  return x;
};

/** The planning row of an activity in a version, with the version's contract — or not found. */
async function planOf(db, projectId, versionId, activityId) {
  const { rows: [x] } = await db.query(
    `SELECT x.*, p.contract_id, a.code FROM activity_plan x JOIN eps_version v ON v.id = x.version_id JOIN eps_pms p ON p.id = v.pms_id
       JOIN wbs_activity a ON a.id = x.activity_id WHERE x.version_id = $1 AND x.activity_id = $2 AND x.project_id = $3`, [versionId, activityId, projectId]);
  if (!x) throw bad("این فعالیت در برنامهٔ این نسخه نیست؛ اول در Planning افزوده شود.");
  return x;
}

/** The contract's requirement kinds; a contract that has none starts with the owner's five. */
export async function requirementTypes(db, { projectId, contractId }) {
  const { rows } = await db.query("SELECT * FROM requirement_type WHERE contract_id = $1 ORDER BY seq, name", [contractId]);
  if (rows.length) return rows;
  for (const [i, [name, group]] of pl.DEFAULT_TYPES.entries()) {
    await db.query("INSERT INTO requirement_type (project_id, contract_id, name, hold_group, seq) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [projectId, contractId, name, group, i + 1]);
  }
  return (await db.query("SELECT * FROM requirement_type WHERE contract_id = $1 ORDER BY seq, name", [contractId])).rows;
}

/** A requirement kind of the contract, new or renamed, with the hold column it counts in. */
export async function saveRequirementType(db, { projectId, contractId, id = null, name, holdGroup = "others" }) {
  if (!text(name)) throw bad("نام نوع نیازمندی لازم است.");
  if (!pl.HOLD_GROUPS.includes(holdGroup)) throw bad("ستون هولد نامعتبر است.");
  const { rows: [dup] } = await db.query("SELECT 1 FROM requirement_type WHERE contract_id = $1 AND name = $2 AND id IS DISTINCT FROM $3", [contractId, text(name), id]);
  if (dup) throw bad(`نوع «${text(name)}» هست.`);
  if (id) {
    const { rows: [r] } = await db.query("UPDATE requirement_type SET name = $3, hold_group = $4 WHERE id = $1 AND contract_id = $2 RETURNING *", [id, contractId, text(name), holdGroup]);
    if (!r) throw notFound("requirement type");
    return r;
  }
  const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM requirement_type WHERE contract_id = $1", [contractId]);
  const { rows: [r] } = await db.query("INSERT INTO requirement_type (project_id, contract_id, name, hold_group, seq) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [projectId, contractId, text(name), holdGroup, m.n]);
  return r;
}

export async function removeRequirementType(db, { projectId, id }) {
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM activity_requirement WHERE type_id = $1", [id]);
  if (n) throw bad(`این نوع در ${n} نیازمندی به کار رفته و حذف نمی‌شود.`);
  const { rowCount } = await db.query("DELETE FROM requirement_type WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("requirement type");
}

/**
 * A requirement of an activity in a version (image 2). Making one active
 * makes the others of that activity and version inactive: one at a time.
 */
export async function saveRequirement(db, { projectId, versionId, activityId, id = null, name, docNo = null, typeId, holdWeight = null, targetDate = null, doneDate = null,
  status = null, active = false, predActivityId = null, remark = null, userId }) {
  const x = await planOf(db, projectId, versionId, activityId);
  if (!text(name)) throw bad("شرح نیازمندی لازم است.");
  const { rows: [ty] } = await db.query("SELECT 1 FROM requirement_type WHERE id = $1 AND contract_id = $2", [typeId, x.contract_id]);
  if (!ty) throw bad("نوع نیازمندی را از فهرست همین قرارداد انتخاب کنید.");
  if (predActivityId) {
    if (predActivityId === activityId) throw bad("فعالیت پیش‌نیاز خودش نیست.");
    const { rows: [pa] } = await db.query(
      `SELECT 1 FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id JOIN eps_version v ON v.pms_id = n.pms_id WHERE a.id = $1 AND v.id = $2`, [predActivityId, versionId]);
    if (!pa) throw bad("فعالیت پیش‌نیاز از WBS همین PMS نیست.");
  }
  const on = active === true || active === "true";
  const vals = [text(name), text(docNo), typeId, numIn(holdWeight, "وزن هولد"), dateIn(targetDate, "تاریخ برنامه‌ای رفع"), dateIn(doneDate, "تاریخ رفع واقعی"),
    text(status), on, predActivityId || null, text(remark)];
  if (on) await db.query("UPDATE activity_requirement SET active = false WHERE version_id = $1 AND activity_id = $2 AND active AND id IS DISTINCT FROM $3", [versionId, activityId, id]);
  if (id) {
    const { rows: [r] } = await db.query(
      `UPDATE activity_requirement SET name = $4, doc_no = $5, type_id = $6, hold_weight = $7, target_date = $8, done_date = $9, status = $10, active = $11,
         pred_activity_id = $12, remark = $13 WHERE id = $1 AND version_id = $2 AND activity_id = $3 RETURNING *`, [id, versionId, activityId, ...vals]);
    if (!r) throw notFound("requirement");
    return r;
  }
  const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM activity_requirement WHERE version_id = $1 AND activity_id = $2", [versionId, activityId]);
  const { rows: [r] } = await db.query(
    `INSERT INTO activity_requirement (project_id, version_id, activity_id, name, doc_no, type_id, hold_weight, target_date, done_date, status, active, pred_activity_id, remark, seq, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [projectId, versionId, activityId, ...vals, m.n, userId]);
  return r;
}

export async function removeRequirement(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM activity_requirement WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("requirement");
}

/** A comment, action or follow-up on an activity in a version (image 5); rows numbered in order. */
export async function saveComment(db, { projectId, versionId, activityId, id = null, item, actionBy = null, actionDate = null, status = "open", department = null,
  doneDate = null, remark = null, userId }) {
  await planOf(db, projectId, versionId, activityId);
  if (!text(item)) throw bad("موضوع بحث (Item Discussed) لازم است.");
  if (!pl.COMMENT_STATUS.includes(status)) throw bad("وضعیت نامعتبر است.");
  if (actionBy) {
    const { rows: [m] } = await db.query("SELECT 1 FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, actionBy]);
    if (!m) throw bad("اقدام‌کننده از اعضای این پروژه نیست.");
  }
  const vals = [text(item), actionBy || null, dateIn(actionDate, "تاریخ اقدام"), status, text(department), dateIn(doneDate, "تاریخ تکمیل"), text(remark)];
  if (id) {
    const { rows: [r] } = await db.query(
      `UPDATE activity_comment SET item = $4, action_by = $5, action_date = $6, status = $7, department = $8, done_date = $9, remark = $10
        WHERE id = $1 AND version_id = $2 AND activity_id = $3 RETURNING *`, [id, versionId, activityId, ...vals]);
    if (!r) throw notFound("comment");
    return r;
  }
  const { rows: [m] } = await db.query("SELECT COALESCE(max(row_no), 0) + 1 AS n FROM activity_comment WHERE version_id = $1 AND activity_id = $2", [versionId, activityId]);
  const { rows: [r] } = await db.query(
    `INSERT INTO activity_comment (project_id, version_id, activity_id, row_no, item, action_by, action_date, status, department, done_date, remark, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [projectId, versionId, activityId, m.n, ...vals, userId]);
  return r;
}

export async function removeComment(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM activity_comment WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("comment");
}

/**
 * What the preview's own sub-forms show for an activity in a version: its
 * requirements and comments, the status row with the holds (lib/eps/
 * planning.mjs statusRow), the requirement kinds and the people who may act.
 */
export async function previewDetail(db, { projectId, versionId, activityId, today = null }) {
  // an activity the version does not plan (the daily report preview reads any): no plan, no requirements, its own dates
  const x = await planOf(db, projectId, versionId, activityId).catch(() => null);
  const v = await versionOf(db, projectId, versionId);
  const types = await requirementTypes(db, { projectId, contractId: v.contract_id });
  const { rows: reqs } = await db.query(
    `SELECT q.*, t.name AS type_name, t.hold_group, pa.code AS pred_code FROM activity_requirement q JOIN requirement_type t ON t.id = q.type_id
       LEFT JOIN wbs_activity pa ON pa.id = q.pred_activity_id WHERE q.version_id = $1 AND q.activity_id = $2 ORDER BY q.seq`, [versionId, activityId]);
  const { rows: comments } = await db.query(
    `SELECT c.*, u.display_name AS action_by_name FROM activity_comment c LEFT JOIN app_user u ON u.id = c.action_by
      WHERE c.version_id = $1 AND c.activity_id = $2 ORDER BY c.row_no`, [versionId, activityId]);
  const { rows: people } = await db.query(
    "SELECT u.id, u.display_name FROM project_member m JOIN app_user u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY u.display_name", [projectId]);
  // the activity as the version plans it, and its whole quantity as the tree holds it
  const view = await activityView(db, { projectId, versionId });
  let act = null;
  const walk = (n) => { for (const a of n.activities) if (a.id === activityId) act = a; n.children.forEach(walk); };
  view.roots.forEach(walk);
  const bare = (await treeActs(db, projectId, v)).get(activityId);
  if (!act) throw notFound("activity");
  const plan = x ? { start_on: iso(x.start_on), end_on: iso(x.end_on), done_before: n(x.done_before), volume_plan: n(x.volume_plan) } : null;
  const fixReq = (q) => ({ ...q, hold_weight: n(q.hold_weight), target_date: iso(q.target_date), done_date: iso(q.done_date) });
  const day = today || new Date().toISOString().slice(0, 10);
  return {
    version: { id: v.id, code: v.code, title: v.title, pms_code: v.pms_code }, contractId: v.contract_id, planned: !!x,
    requirements: reqs.map(fixReq), comments: comments.map((c) => ({ ...c, action_date: iso(c.action_date), done_date: iso(c.done_date) })),
    types, people,
    status: pl.statusRow({ act, plan, total: bare?.volumeActual ?? bare?.volumePlan ?? null, done: act?.done ?? 0, requirements: reqs.map(fixReq), today: day }),
  };
}
