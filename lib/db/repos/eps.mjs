/**
 * EPS, PMS versions, WBS, activity templates and WBS activities (migration
 * 073; the rules are lib/eps/wbs.mjs). Only what a person types is stored;
 * every derived figure is worked out on read. Call inside `withProject`.
 */
import * as w from "../../eps/wbs.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (x) => Object.assign(new Error(`${x} not found`), { status: 404 });
const text = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).replace(/\s+/g, " ").trim());
const num = (v, what, { min = 0, max = null } = {}) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[٬,]/g, ""));
  if (!Number.isFinite(n)) throw bad(`${what}: «${v}» عدد نیست.`);
  if (min != null && n < min) throw bad(`${what} منفی نمی‌شود.`);
  if (max != null && n > max) throw bad(`${what} بیش از ${max} نمی‌شود.`);
  return n;
};
const date = (v, what) => {
  const t = text(v);
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw bad(`${what}: تاریخ به شکل YYYY-MM-DD.`);
  return t;
};
const span = (a, b, what) => { if (a && b && b < a) throw bad(`${what}: پایان پیش از شروع است.`); };
const iso = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d ? String(d).slice(0, 10) : null);
const LOG = (db, projectId, label, comment, userId) => logEvent(db, { projectId, section: "controls", entityType: "eps", entityId: null, label, action: "updated", comment, userId });

/** Set the order of siblings: seq 1..n in the given order. */
async function setOrder(db, table, ids) {
  for (let i = 0; i < ids.length; i++) await db.query(`UPDATE ${table} SET seq = $2 WHERE id = $1`, [ids[i], i + 1]);
}

// ── EPS: PMS and versions ────────────────────────────────────────────────

export const PMS_TYPES = ["Level 1 (Master)", "Level 2", "Level 3", "Level 4", "Baseline", "Revised", "Recovery", "Look-ahead"];

export async function savePms(db, { projectId, contractId, id = null, code, title, pmsType = null, description = null, registeredOn = null, planStart = null, planEnd = null, actualStart = null, actualEnd = null, userId }) {
  const c = text(code)?.toUpperCase();
  if (!c || !/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(c)) throw bad("کد PMS: حرف و رقم لاتین، - یا _ (مثل PM01).");
  if (!text(title)) throw bad("عنوان PMS لازم است.");
  const d = [date(planStart, "شروع برنامه‌ای"), date(planEnd, "پایان برنامه‌ای"), date(actualStart, "شروع واقعی"), date(actualEnd, "پایان واقعی")];
  span(d[0], d[1], "برنامه"); span(d[2], d[3], "واقعی");
  const { rows: [k] } = await db.query("SELECT 1 FROM contract WHERE id = $1 AND project_id = $2", [contractId, projectId]);
  if (!k) throw notFound("contract");
  const { rows: [dup] } = await db.query("SELECT 1 FROM eps_pms WHERE project_id = $1 AND code = $2 AND id IS DISTINCT FROM $3", [projectId, c, id]);
  if (dup) throw bad(`کد ${c} برای PMS دیگری ثبت شده است.`);
  const reg = date(registeredOn, "تاریخ ثبت");
  let r;
  if (id) {
    ({ rows: [r] } = await db.query(
      `UPDATE eps_pms SET code = $3, title = $4, registered_on = COALESCE($5, registered_on), plan_start = $6, plan_end = $7, actual_start = $8, actual_end = $9,
              pms_type = $10, description = $11 WHERE id = $1 AND project_id = $2 RETURNING *`, [id, projectId, c, text(title), reg, ...d, text(pmsType), text(description)]));
    if (!r) throw notFound("pms");
  } else {
    const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM eps_pms WHERE contract_id = $1", [contractId]);
    ({ rows: [r] } = await db.query(
      `INSERT INTO eps_pms (project_id, contract_id, code, title, registered_on, plan_start, plan_end, actual_start, actual_end, seq, created_by, pms_type, description)
       VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [projectId, contractId, c, text(title), reg, ...d, m.n, userId, text(pmsType), text(description)]));
  }
  await LOG(db, projectId, `PMS ${c}`, id ? "ویرایش" : "ایجاد", userId);
  return r;
}

export async function saveVersion(db, { projectId, pmsId, id = null, code, title, description = null, registeredOn = null, startOn = null, endOn = null, budgetPlan = null, budgetActual = null, userId }) {
  const c = text(code)?.toUpperCase();
  if (!c || !/^[A-Z0-9][A-Z0-9_.-]{0,23}$/.test(c)) throw bad("کد نسخه: حرف و رقم لاتین، . - یا _ (مثل PM01-R1).");
  if (!text(title)) throw bad("عنوان نسخه لازم است.");
  const s = date(startOn, "شروع نسخه"), e = date(endOn, "پایان نسخه");
  span(s, e, "نسخه");
  const { rows: [p] } = await db.query("SELECT * FROM eps_pms WHERE id = $1 AND project_id = $2", [pmsId, projectId]);
  if (!p) throw notFound("pms");
  const { rows: [dup] } = await db.query("SELECT 1 FROM eps_version WHERE project_id = $1 AND code = $2 AND id IS DISTINCT FROM $3", [projectId, c, id]);
  if (dup) throw bad(`کد ${c} برای نسخهٔ دیگری ثبت شده است.`);
  const vals = [c, text(title), text(description), date(registeredOn, "تاریخ ثبت"), s, e, num(budgetPlan, "بودجهٔ برنامه‌ای"), num(budgetActual, "بودجهٔ واقعی")];
  let r;
  if (id) {
    ({ rows: [r] } = await db.query(
      `UPDATE eps_version SET code = $3, title = $4, description = $5, registered_on = COALESCE($6, registered_on), start_on = $7, end_on = $8,
              budget_plan = $9, budget_actual = $10 WHERE id = $1 AND project_id = $2 RETURNING *`, [id, projectId, ...vals]));
    if (!r) throw notFound("version");
  } else {
    const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM eps_version WHERE pms_id = $1", [pmsId]);
    ({ rows: [r] } = await db.query(
      `INSERT INTO eps_version (project_id, pms_id, code, title, description, registered_on, start_on, end_on, budget_plan, budget_actual, settings, seq, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE),$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [projectId, pmsId, ...vals, w.checkSettings(w.DEFAULT_SETTINGS).settings, m.n, userId]));
  }
  await LOG(db, projectId, `نسخهٔ ${c} از PMS ${p.code}`, id ? "ویرایش" : "ایجاد", userId);
  return r;
}

/**
 * The version that is its PMS's master plan — one at most: choosing one
 * clears the other; `master: false` leaves the PMS without one.
 */
export async function setMaster(db, { projectId, id, master = true, userId }) {
  const { rows: [v] } = await db.query("SELECT v.*, p.code AS pms_code FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id WHERE v.id = $1 AND v.project_id = $2", [id, projectId]);
  if (!v) throw notFound("version");
  if (master) await db.query("UPDATE eps_version SET master = false WHERE pms_id = $1 AND id <> $2 AND master", [v.pms_id, id]);
  const { rows: [r] } = await db.query("UPDATE eps_version SET master = $2 WHERE id = $1 RETURNING *", [id, !!master]);
  await LOG(db, projectId, `نسخهٔ ${v.code} از PMS ${v.pms_code}`, master ? "برنامهٔ اصلی (Master plan) شد" : "از برنامهٔ اصلی بودن برداشته شد", userId);
  return r;
}

/** Move a PMS among its contract's PMSs, or a version to another PMS and among its versions. */
export async function moveEps(db, { projectId, kind, id, pmsId = null, beforeId = null, afterId = null }) {
  if (kind === "pms") {
    const { rows: [p] } = await db.query("SELECT * FROM eps_pms WHERE id = $1 AND project_id = $2", [id, projectId]);
    if (!p) throw notFound("pms");
    const { rows } = await db.query("SELECT id FROM eps_pms WHERE contract_id = $1 ORDER BY seq, code", [p.contract_id]);
    return setOrder(db, "eps_pms", w.reorder(rows.map((x) => x.id), id, { beforeId, afterId }));
  }
  const { rows: [v] } = await db.query("SELECT v.*, p.contract_id FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id WHERE v.id = $1 AND v.project_id = $2", [id, projectId]);
  if (!v) throw notFound("version");
  const to = pmsId || v.pms_id;
  const { rows: [t] } = await db.query("SELECT contract_id FROM eps_pms WHERE id = $1 AND project_id = $2", [to, projectId]);
  if (!t || t.contract_id !== v.contract_id) throw bad("نسخه فقط به PMS دیگری از همین قرارداد می‌رود.");
  if (to !== v.pms_id) {
    // the PMS it joins keeps its own master plan: a master version that moves goes as an ordinary one
    const { rows: [m] } = await db.query("SELECT 1 FROM eps_version WHERE pms_id = $1 AND master", [to]);
    await db.query("UPDATE eps_version SET pms_id = $2, master = master AND $3 WHERE id = $1", [id, to, !m]);
  }
  const { rows } = await db.query("SELECT id FROM eps_version WHERE pms_id = $1 ORDER BY seq, code", [to]);
  return setOrder(db, "eps_version", w.reorder(rows.map((x) => x.id), id, { beforeId, afterId }));
}

export async function removeEps(db, { projectId, kind, id }) {
  if (kind === "pms") {
    const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM eps_version WHERE pms_id = $1", [id]);
    if (n) throw bad("این PMS نسخه دارد؛ اول نسخه‌ها را جابه‌جا یا حذف کنید.");
    await db.query("DELETE FROM eps_pms WHERE id = $1 AND project_id = $2", [id, projectId]);
  } else {
    const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM wbs_node WHERE version_id = $1", [id]);
    if (n) throw bad(`این نسخه ${n} گرهٔ WBS دارد و حذف نمی‌شود.`);
    await db.query("DELETE FROM eps_version WHERE id = $1 AND project_id = $2", [id, projectId]);
  }
}

/** The contract's EPS: its PMSs in order, each with its versions in order, and the durations. */
export async function epsBoard(db, { projectId, contractId }) {
  const { rows: pms } = await db.query("SELECT * FROM eps_pms WHERE project_id = $1 AND contract_id = $2 ORDER BY seq, code", [projectId, contractId]);
  const { rows: vs } = await db.query(
    `SELECT v.*, (SELECT count(*)::int FROM wbs_node n WHERE n.version_id = v.id) AS nodes FROM eps_version v
      WHERE v.project_id = $1 AND v.pms_id = ANY($2) ORDER BY v.seq, v.code`, [projectId, pms.map((p) => p.id)]);
  const d = (r, a, b) => ({ [a]: iso(r[a]), [b]: iso(r[b]) });
  return pms.map((p) => ({
    ...p, registered_on: iso(p.registered_on), ...d(p, "plan_start", "plan_end"), ...d(p, "actual_start", "actual_end"),
    planDays: w.duration(p.plan_start, p.plan_end), actualDays: w.duration(p.actual_start, p.actual_end),
    versions: vs.filter((v) => v.pms_id === p.id).map((v) => ({ ...v, registered_on: iso(v.registered_on), ...d(v, "start_on", "end_on"),
      days: w.duration(v.start_on, v.end_on) })),
  }));
}

// ── WBS ──────────────────────────────────────────────────────────────────

async function versionOf(db, projectId, versionId) {
  const { rows: [v] } = await db.query(
    "SELECT v.*, p.code AS pms_code, p.title AS pms_title, p.contract_id FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id WHERE v.id = $1 AND v.project_id = $2",
    [versionId, projectId]);
  if (!v) throw notFound("version");
  return { ...v, settings: w.checkSettings(v.settings).settings };
}

export async function saveSettings(db, { projectId, versionId, settings, userId }) {
  const v = await versionOf(db, projectId, versionId);
  const { settings: s, problems } = w.checkSettings(settings);
  if (problems.length) throw bad(problems.join(" "));
  // a mode under which the tree's weights no longer hold is refused, not applied
  const t = await treeOf(db, projectId, { ...v, settings: s });
  if (t.problems.length) throw bad(`با این روش محاسبه: ${t.problems.join(" ")}`);
  await db.query("UPDATE eps_version SET settings = $2 WHERE id = $1", [versionId, s]);
  await LOG(db, projectId, `تنظیمات WBS نسخهٔ ${v.code}`, `${w.BUDGET_MODES[s.budgetMode]} · جداکننده «${s.separator}»`, userId);
  return s;
}

async function rowsOf(db, versionId) {
  const { rows: nodes } = await db.query("SELECT * FROM wbs_node WHERE version_id = $1", [versionId]);
  const { rows: acts } = await db.query("SELECT a.* FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.version_id = $1", [versionId]);
  return { nodes, acts };
}
async function treeOf(db, projectId, v, change = null) {
  let { nodes, acts } = await rowsOf(db, v.id);
  if (change) ({ nodes, acts } = change({ nodes, acts }));
  return w.computeTree({ version: v, nodes, activities: acts, settings: v.settings });
}
/** Refuse a change that breaks the 100% rule somewhere it did not already break. */
async function guard(db, projectId, v, change) {
  const before = new Set((await treeOf(db, projectId, v)).problems);
  const after = (await treeOf(db, projectId, v, change)).problems.filter((p) => !before.has(p));
  if (after.length) throw bad(after.join(" "));
}

/** The version's WBS with every derived figure, and what it needs around it: templates with activities, the code a new child would get. */
export async function wbsView(db, { projectId, versionId }) {
  const v = await versionOf(db, projectId, versionId);
  const t = await treeOf(db, projectId, v);
  const strip = (n) => ({ ...n, children: n.children.map(strip) });
  return {
    version: { ...v, registered_on: iso(v.registered_on), start_on: iso(v.start_on), end_on: iso(v.end_on), days: w.duration(v.start_on, v.end_on) },
    settings: v.settings, roots: t.roots.map(strip), rootWf: t.rootWf, problems: t.problems,
    templates: await templatesWithActivities(db, { projectId }),
  };
}

const NODE_FIELDS = (b) => ({
  name: text(b.name), budget_plan: num(b.budgetPlan, "بودجهٔ پیش‌بینی"), budget_actual: num(b.budgetActual, "بودجهٔ واقعی"),
  qty: num(b.qty, "تعداد"), unit: text(b.unit), volume_plan: num(b.volumePlan, "حجم پیش‌بینی"), volume_actual: num(b.volumeActual, "حجم واقعی"),
  wf: num(b.wf, "W.F", { max: 100 }), plan_start: date(b.planStart, "شروع برنامه"), plan_end: date(b.planEnd, "پایان برنامه"),
  actual_start: date(b.actualStart, "شروع واقعی"), actual_end: date(b.actualEnd, "پایان واقعی"), description: text(b.description),
});

/** The code a new node under `parentId` gets by default. */
export async function suggestNodeCode(db, { projectId, versionId, parentId = null }) {
  const v = await versionOf(db, projectId, versionId);
  const { rows: sib } = await db.query("SELECT code FROM wbs_node WHERE version_id = $1 AND parent_id IS NOT DISTINCT FROM $2", [versionId, parentId]);
  const parent = parentId ? (await db.query("SELECT code FROM wbs_node WHERE id = $1 AND version_id = $2", [parentId, versionId])).rows[0] : null;
  if (parentId && !parent) throw notFound("parent");
  const level = parentId ? (await levelOf(db, parentId)) + 1 : 1;
  const pCode = parent ? parent.code : v.pms_code;
  return w.suggestCode(pCode, level, w.nextNumber(pCode, sib.map((x) => x.code), level, v.settings), v.settings);
}
async function levelOf(db, id) {
  const { rows: [r] } = await db.query(
    `WITH RECURSIVE up AS (SELECT id, parent_id, 1 AS d FROM wbs_node WHERE id = $1
       UNION ALL SELECT n.id, n.parent_id, up.d + 1 FROM wbs_node n JOIN up ON n.id = up.parent_id) SELECT max(d)::int AS d FROM up`, [id]);
  return r.d;
}

/** A WBS node, new or edited. The code is suggested when none is typed; the children's W.F stays within 100%. */
export async function saveNode(db, { projectId, versionId, id = null, parentId = null, code = null, templateId, ...b }) {
  const v = await versionOf(db, projectId, versionId);
  const f = NODE_FIELDS(b);
  if (!f.name) throw bad("نام گره لازم است.");
  span(f.plan_start, f.plan_end, "برنامه"); span(f.actual_start, f.actual_end, "واقعی");
  let c = text(code);
  const have = id ? (await db.query("SELECT * FROM wbs_node WHERE id = $1 AND version_id = $2", [id, versionId])).rows[0] : null;
  if (id && !have) throw notFound("node");
  const parent = id ? have.parent_id : parentId || null;
  if (!c) c = id ? have.code : await suggestNodeCode(db, { projectId, versionId, parentId: parent });
  const { rows: [dup] } = await db.query("SELECT 1 FROM wbs_node WHERE version_id = $1 AND code = $2 AND id IS DISTINCT FROM $3", [versionId, c, id]);
  if (dup) throw bad(`کد ${c} در این WBS هست.`);
  const tpl = templateId === undefined ? (have?.template_id ?? null) : templateId || null;
  if (tpl) {
    const { rows: [t] } = await db.query("SELECT 1 FROM activity_template WHERE id = $1 AND project_id = $2", [tpl, projectId]);
    if (!t) throw bad("الگوی فعالیت پیدا نشد.");
  }
  const tmpId = id || "new";
  await guard(db, projectId, v, ({ nodes, acts }) => ({
    nodes: id ? nodes.map((n) => (n.id === id ? { ...n, ...f, code: c } : n))
      : [...nodes, { id: tmpId, version_id: versionId, parent_id: parent, code: c, seq: 1e9, ...f }], acts }));
  let r;
  const cols = Object.keys(f);
  if (id) {
    ({ rows: [r] } = await db.query(
      `UPDATE wbs_node SET code = $3, template_id = $4, ${cols.map((k, i) => `${k} = $${i + 5}`).join(", ")} WHERE id = $1 AND version_id = $2 RETURNING *`,
      [id, versionId, c, tpl, ...cols.map((k) => f[k])]));
    if (c !== have.code) await rebaseUnder(db, id, have.code, c, v.settings.separator);
  } else {
    if (parent) {
      const { rows: [p] } = await db.query("SELECT 1 FROM wbs_node WHERE id = $1 AND version_id = $2", [parent, versionId]);
      if (!p) throw notFound("parent");
    }
    const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM wbs_node WHERE version_id = $1 AND parent_id IS NOT DISTINCT FROM $2", [versionId, parent]);
    ({ rows: [r] } = await db.query(
      `INSERT INTO wbs_node (project_id, version_id, parent_id, code, seq, template_id, ${cols.join(", ")})
       VALUES ($1,$2,$3,$4,$5,$6,${cols.map((_, i) => `$${i + 7}`).join(",")}) RETURNING *`,
      [projectId, versionId, parent, c, m.n, tpl, ...cols.map((k) => f[k])]));
  }
  return r;
}

/** A node's code changed: its descendants' and activities' codes that start with the old one follow it. */
async function rebaseUnder(db, nodeId, oldCode, newCode, sep) {
  const { rows } = await db.query(
    `WITH RECURSIVE down AS (SELECT id FROM wbs_node WHERE parent_id = $1 UNION ALL SELECT n.id FROM wbs_node n JOIN down ON n.parent_id = down.id)
     SELECT n.id, n.code FROM wbs_node n JOIN down USING (id)`, [nodeId]);
  for (const n of rows) {
    const c = w.rebase(n.code, oldCode + sep, newCode + sep);
    if (c !== n.code) await db.query("UPDATE wbs_node SET code = $2 WHERE id = $1", [n.id, c]);
  }
  const { rows: acts } = await db.query("SELECT id, code FROM wbs_activity WHERE node_id = $1 OR node_id = ANY($2)", [nodeId, rows.map((x) => x.id)]);
  for (const a of acts) {
    const c = w.rebase(a.code, oldCode + sep, newCode + sep);
    if (c !== a.code) await db.query("UPDATE wbs_activity SET code = $2 WHERE id = $1", [a.id, c]);
  }
}

async function subtree(db, id) {
  const { rows } = await db.query(
    `WITH RECURSIVE down AS (SELECT id FROM wbs_node WHERE id = $1 UNION ALL SELECT n.id FROM wbs_node n JOIN down ON n.parent_id = down.id)
     SELECT id FROM down`, [id]);
  return rows.map((r) => r.id);
}

/**
 * Move a node: under another (or to the root), before or after a sibling.
 * A node never goes under itself; a node that changes parent takes a new
 * code under it, and its descendants' codes follow.
 */
export async function moveNode(db, { projectId, versionId, id, parentId = null, beforeId = null, afterId = null }) {
  const v = await versionOf(db, projectId, versionId);
  const { rows: [n] } = await db.query("SELECT * FROM wbs_node WHERE id = $1 AND version_id = $2", [id, versionId]);
  if (!n) throw notFound("node");
  const to = parentId || null;
  if (to) {
    if ((await subtree(db, id)).includes(to)) throw bad("گره را نمی‌توان زیر خودش یا فرزندانش برد.");
    const { rows: [p] } = await db.query("SELECT 1 FROM wbs_node WHERE id = $1 AND version_id = $2", [to, versionId]);
    if (!p) throw notFound("parent");
  }
  if (to !== n.parent_id) {
    await guard(db, projectId, v, ({ nodes, acts }) => ({ nodes: nodes.map((x) => (x.id === id ? { ...x, parent_id: to } : x)), acts }));
    const code = await suggestNodeCode(db, { projectId, versionId, parentId: to });
    await db.query("UPDATE wbs_node SET parent_id = $2, code = $3 WHERE id = $1", [id, to, code]);
    await rebaseUnder(db, id, n.code, code, v.settings.separator);
  }
  const { rows: sib } = await db.query("SELECT id FROM wbs_node WHERE version_id = $1 AND parent_id IS NOT DISTINCT FROM $2 ORDER BY seq, code", [versionId, to]);
  await setOrder(db, "wbs_node", w.reorder(sib.map((x) => x.id), id, { beforeId, afterId }));
}

/** Copy a node with everything under it — nodes and activities — under another node (or the root), with new codes. */
export async function copyNode(db, { projectId, versionId, id, parentId = null }) {
  const v = await versionOf(db, projectId, versionId);
  const ids = await subtree(db, id);
  if (!ids.length) throw notFound("node");
  if (parentId && ids.includes(parentId)) throw bad("گره در زیر خودش کپی نمی‌شود.");
  const { rows: nodes } = await db.query("SELECT * FROM wbs_node WHERE id = ANY($1)", [ids]);
  const { rows: acts } = await db.query("SELECT * FROM wbs_activity WHERE node_id = ANY($1)", [ids]);
  const top = nodes.find((x) => x.id === id);
  const code = await suggestNodeCode(db, { projectId, versionId, parentId });
  const sep = v.settings.separator;
  const map = new Map();
  const make = async (src, newParent) => {
    const c = src.id === id ? code : w.rebase(src.code, top.code + sep, code + sep);
    const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM wbs_node WHERE version_id = $1 AND parent_id IS NOT DISTINCT FROM $2", [versionId, newParent]);
    const { rows: [r] } = await db.query(
      `INSERT INTO wbs_node (project_id, version_id, parent_id, code, name, seq, budget_plan, budget_actual, qty, unit, volume_plan, volume_actual, wf,
         plan_start, plan_end, actual_start, actual_end, description, template_id)
       SELECT project_id, version_id, $2, $3, name, $4, budget_plan, budget_actual, qty, unit, volume_plan, volume_actual, wf,
         plan_start, plan_end, actual_start, actual_end, description, template_id FROM wbs_node WHERE id = $1 RETURNING *`, [src.id, newParent, c, m.n]);
    map.set(src.id, r);
    for (const a of acts.filter((x) => x.node_id === src.id)) {
      await db.query(
        `INSERT INTO wbs_activity (project_id, node_id, code, name, wf, template_activity_id, template_code, progress, description, seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9)`,
        [projectId, r.id, w.rebase(a.code, src.code + sep, c + sep), a.name, a.wf, a.template_activity_id, a.template_code, a.description, a.seq]);
    }
    for (const ch of nodes.filter((x) => x.parent_id === src.id).sort((a, b) => a.seq - b.seq)) await make(ch, r.id);
  };
  await guard(db, projectId, v, ({ nodes: all, acts: aa }) => ({
    nodes: [...all, ...nodes.map((x) => ({ ...x, id: `copy-${x.id}`, parent_id: x.id === id ? parentId : `copy-${x.parent_id}`, code: `copy-${x.code}` }))], acts: aa }));
  await make(top, parentId);
  return map.get(id);
}

export async function removeNode(db, { projectId, versionId, id }) {
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM wbs_node WHERE parent_id = $1", [id]);
  if (n) throw bad("این گره فرزند دارد؛ اول فرزندان را جابه‌جا یا حذف کنید.");
  const { rowCount } = await db.query("DELETE FROM wbs_node WHERE id = $1 AND version_id = $2 AND project_id = $3", [id, versionId, projectId]);
  if (!rowCount) throw notFound("node");
}

// ── activities on a WBS node ─────────────────────────────────────────────

async function nodeAndVersion(db, projectId, nodeId) {
  const { rows: [n] } = await db.query("SELECT * FROM wbs_node WHERE id = $1 AND project_id = $2", [nodeId, projectId]);
  if (!n) throw notFound("node");
  return { node: n, v: await versionOf(db, projectId, n.version_id) };
}

/**
 * The template's activities onto a WBS node: each one not already there,
 * with the node's code and the activity's last two digits, its name and its
 * W.F. The node remembers the template.
 */
export async function attachTemplate(db, { projectId, nodeId, templateId }) {
  const { node, v } = await nodeAndVersion(db, projectId, nodeId);
  const { rows: tas } = await db.query(
    "SELECT ta.* FROM template_activity ta JOIN activity_template t ON t.id = ta.template_id WHERE t.id = $1 AND t.project_id = $2 ORDER BY ta.number", [templateId, projectId]);
  if (!tas.length) throw bad("این الگو فعالیتی ندارد.");
  const { rows: have } = await db.query("SELECT template_activity_id, code FROM wbs_activity WHERE node_id = $1", [nodeId]);
  const fresh = tas.filter((t) => !have.some((h) => h.template_activity_id === t.id));
  const adds = fresh.map((t) => ({ id: `t-${t.id}`, node_id: nodeId, code: w.activityCode(node.code, t.number, v.settings.separator), name: t.name, wf: t.wf,
    template_activity_id: t.id, template_code: t.code, seq: t.number }));
  for (const a of adds) if (have.some((h) => h.code === a.code)) throw bad(`کد ${a.code} روی این گره هست.`);
  await guard(db, projectId, v, ({ nodes, acts }) => ({ nodes, acts: [...acts, ...adds] }));
  for (const a of adds) {
    await db.query(
      `INSERT INTO wbs_activity (project_id, node_id, code, name, wf, template_activity_id, template_code, seq) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [projectId, nodeId, a.code, a.name, a.wf, a.template_activity_id, a.template_code, a.seq]);
  }
  await db.query("UPDATE wbs_node SET template_id = $2 WHERE id = $1", [nodeId, templateId]);
  return { added: adds.length, skipped: tas.length - adds.length };
}

/**
 * An activity by hand, or an activity edited: its W.F (activities of a node
 * within 100%), progress, name — and, when its own differ from its node's,
 * its dates and volumes (left out of the call: kept as they are; blank: the
 * node's again).
 */
const OWN = { planStart: "plan_start", planEnd: "plan_end", actualStart: "actual_start", actualEnd: "actual_end", volumePlan: "volume_plan", volumeActual: "volume_actual" };
export async function saveActivity(db, { projectId, nodeId, id = null, code = null, name, wf, progress = null, description = null, ...rest }) {
  const { node, v } = await nodeAndVersion(db, projectId, nodeId);
  if (!text(name)) throw bad("نام فعالیت لازم است.");
  const f = { name: text(name), wf: num(wf, "W.F", { max: 100 }), progress: num(progress, "پیشرفت", { max: 100 }), description: text(description) };
  const own = {};
  for (const [k, col] of Object.entries(OWN)) if (rest[k] !== undefined) own[col] = col.startsWith("volume") ? num(rest[k], col === "volume_plan" ? "حجم پیش‌بینی" : "حجم واقعی") : date(rest[k], k);
  let c = text(code);
  const { rows: have } = await db.query("SELECT * FROM wbs_activity WHERE node_id = $1", [nodeId]);
  const prev = id ? have.find((a) => a.id === id) : null;
  if (id && !prev) throw notFound("activity");
  const pick = (col) => (col in own ? own[col] : prev ? iso(prev[col]) ?? prev[col] : null);
  span(pick("plan_start"), pick("plan_end"), "برنامهٔ فعالیت"); span(pick("actual_start"), pick("actual_end"), "واقعی فعالیت");
  if (!c) {
    if (id) c = prev.code;
    else {
      const used = new Set(have.map((a) => a.code));
      let k = have.length + 1;
      while (used.has(w.activityCode(node.code, k, v.settings.separator))) k++;
      c = w.activityCode(node.code, k, v.settings.separator);
    }
  }
  if (have.some((a) => a.code === c && a.id !== id)) throw bad(`کد ${c} روی این گره هست.`);
  await guard(db, projectId, v, ({ nodes, acts }) => ({ nodes,
    acts: id ? acts.map((a) => (a.id === id ? { ...a, ...f, code: c } : a)) : [...acts, { id: "new", node_id: nodeId, code: c, seq: 1e9, ...f }] }));
  const all = { code: c, ...f, ...own };
  const cols = Object.keys(all);
  if (id) {
    const { rows: [r] } = await db.query(
      `UPDATE wbs_activity SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING *`, [id, ...cols.map((k) => all[k])]);
    return r;
  }
  const { rows: [r] } = await db.query(
    `INSERT INTO wbs_activity (project_id, node_id, seq, ${cols.join(", ")}) VALUES ($1,$2,$3,${cols.map((_, i) => `$${i + 4}`).join(",")}) RETURNING *`,
    [projectId, nodeId, Math.max(0, ...have.map((a) => a.seq)) + 1, ...cols.map((k) => all[k])]);
  return r;
}

export async function removeActivity(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM wbs_activity WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("activity");
}

// ── activity templates ───────────────────────────────────────────────────

export async function templatesWithActivities(db, { projectId }) {
  const { rows: ts } = await db.query("SELECT * FROM activity_template WHERE project_id = $1 ORDER BY seq, code", [projectId]);
  const { rows: as } = await db.query("SELECT * FROM template_activity WHERE project_id = $1 ORDER BY number", [projectId]);
  return ts.map((t) => {
    const acts = as.filter((a) => a.template_id === t.id).map((a) => ({ ...a, wf: a.wf == null ? null : Number(a.wf) }));
    return { ...t, activities: acts, wfTotal: Math.round(acts.reduce((s, a) => s + (a.wf || 0), 0) * 10000) / 10000 };
  });
}

export async function saveTemplate(db, { projectId, id = null, parentId = null, code, name, description = null }) {
  const c = text(code)?.toUpperCase();
  if (!c || !/^[A-Z0-9][A-Z0-9_.-]{0,19}$/.test(c)) throw bad("کد الگو: حرف و رقم لاتین، . - یا _ (مثل T-PIP).");
  if (!text(name)) throw bad("نام الگو لازم است.");
  const { rows: [dup] } = await db.query("SELECT 1 FROM activity_template WHERE project_id = $1 AND code = $2 AND id IS DISTINCT FROM $3", [projectId, c, id]);
  if (dup) throw bad(`کد الگوی ${c} هست.`);
  if (id) {
    const { rows: [old] } = await db.query("SELECT code FROM activity_template WHERE id = $1 AND project_id = $2", [id, projectId]);
    if (!old) throw notFound("template");
    const { rows: [r] } = await db.query("UPDATE activity_template SET code = $2, name = $3, description = $4 WHERE id = $1 RETURNING *", [id, c, text(name), text(description)]);
    if (old.code !== c) {
      // the activities' codes are the template's code and their number
      await db.query("UPDATE template_activity SET code = $2 || lpad(number::text, 2, '0') WHERE template_id = $1", [id, c]);
    }
    return r;
  }
  if (parentId) {
    const { rows: [p] } = await db.query("SELECT 1 FROM activity_template WHERE id = $1 AND project_id = $2", [parentId, projectId]);
    if (!p) throw notFound("parent");
  }
  const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM activity_template WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2", [projectId, parentId]);
  const { rows: [r] } = await db.query(
    "INSERT INTO activity_template (project_id, parent_id, code, name, description, seq) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [projectId, parentId, c, text(name), text(description), m.n]);
  return r;
}

export async function moveTemplate(db, { projectId, id, parentId = null, beforeId = null, afterId = null }) {
  const { rows: all } = await db.query("SELECT id, parent_id, seq, code FROM activity_template WHERE project_id = $1", [projectId]);
  const t = all.find((x) => x.id === id);
  if (!t) throw notFound("template");
  for (let p = parentId; p; p = all.find((x) => x.id === p)?.parent_id) if (p === id) throw bad("الگو را نمی‌توان زیر خودش برد.");
  if (parentId && !all.some((x) => x.id === parentId)) throw notFound("parent");
  await db.query("UPDATE activity_template SET parent_id = $2 WHERE id = $1", [id, parentId]);
  const sib = all.filter((x) => (x.parent_id || null) === (parentId || null) && x.id !== id).sort((a, b) => a.seq - b.seq || a.code.localeCompare(b.code)).map((x) => x.id);
  await setOrder(db, "activity_template", w.reorder([...sib, id], id, { beforeId, afterId }));
}

/** Copy a template with its activities (and the templates under it) as a child of another — new codes, the copy's activities numbered as the original's. */
export async function copyTemplate(db, { projectId, id, parentId }) {
  const { rows: all } = await db.query("SELECT * FROM activity_template WHERE project_id = $1", [projectId]);
  const src = all.find((x) => x.id === id);
  if (!src) throw notFound("template");
  if (parentId && !all.some((x) => x.id === parentId)) throw notFound("parent");
  const used = new Set(all.map((x) => x.code));
  const free = (c) => { let k = 2, n = `${c}-${k}`; while (used.has(n)) n = `${c}-${++k}`; used.add(n); return n; };
  const copy = async (t, parent) => {
    const code = free(t.code);
    const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM activity_template WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2", [projectId, parent]);
    const { rows: [r] } = await db.query(
      "INSERT INTO activity_template (project_id, parent_id, code, name, description, seq) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [projectId, parent, code, t.name, t.description, m.n]);
    await db.query(
      `INSERT INTO template_activity (project_id, template_id, number, code, name, wf, description)
       SELECT project_id, $2, number, $3 || lpad(number::text, 2, '0'), name, wf, description FROM template_activity WHERE template_id = $1`, [t.id, r.id, code]);
    for (const ch of all.filter((x) => x.parent_id === t.id)) await copy(ch, r.id);
    return r;
  };
  return copy(src, parentId || null);
}

export async function removeTemplate(db, { projectId, id }) {
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM activity_template WHERE parent_id = $1", [id]);
  if (n) throw bad("این الگو زیرمجموعه دارد.");
  await db.query("DELETE FROM activity_template WHERE id = $1 AND project_id = $2", [id, projectId]);
}

/** A template's activity: number (its code is the template code and two digits), name, W.F; the template's activities within 100%. */
export async function saveTemplateActivity(db, { projectId, templateId, id = null, number = null, name, wf, description = null }) {
  const { rows: [t] } = await db.query("SELECT * FROM activity_template WHERE id = $1 AND project_id = $2", [templateId, projectId]);
  if (!t) throw notFound("template");
  if (!text(name)) throw bad("نام فعالیت لازم است.");
  const f = num(wf, "W.F", { max: 100 });
  const { rows: have } = await db.query("SELECT id, number, wf FROM template_activity WHERE template_id = $1", [templateId]);
  let k = num(number, "شمارهٔ ردیف", { min: 1, max: 99 });
  if (k == null) k = id ? have.find((a) => a.id === id)?.number : Math.max(0, ...have.map((a) => a.number)) + 1;
  if (!Number.isInteger(k) || k < 1 || k > 99) throw bad("شمارهٔ ردیف عدد صحیح ۱ تا ۹۹ است.");
  if (have.some((a) => a.number === k && a.id !== id)) throw bad(`ردیف ${k} در این الگو هست.`);
  const over = w.wfOverflow(have.filter((a) => a.id !== id).map((a) => a.wf), f);
  if (over) throw bad(`جمع W.F فعالیت‌های الگو ${over}٪ می‌شود؛ بیش از ۱۰۰٪ نمی‌شود.`);
  const code = t.code + String(k).padStart(2, "0");
  if (id) {
    const { rows: [r] } = await db.query(
      "UPDATE template_activity SET number = $3, code = $4, name = $5, wf = $6, description = $7 WHERE id = $1 AND template_id = $2 RETURNING *",
      [id, templateId, k, code, text(name), f, text(description)]);
    if (!r) throw notFound("activity");
    return r;
  }
  const { rows: [r] } = await db.query(
    "INSERT INTO template_activity (project_id, template_id, number, code, name, wf, description) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [projectId, templateId, k, code, text(name), f, text(description)]);
  return r;
}

export async function removeTemplateActivity(db, { projectId, id }) {
  await db.query("DELETE FROM template_activity WHERE id = $1 AND project_id = $2", [id, projectId]);
}

/**
 * The template's activities as they are now, onto every WBS node that took
 * them: each attached activity gets the template activity's name, W.F,
 * description and number (so its code's last two digits), and a node that
 * took the template gets the template activities it does not have yet. A
 * version whose 100% rule the change would break is refused as a whole,
 * before anything is written. Activities whose template activity was removed
 * stay as they are (they are then activities by hand).
 */
export async function syncTemplate(db, { projectId, templateId, dryRun = false, userId }) {
  const { rows: [t] } = await db.query("SELECT * FROM activity_template WHERE id = $1 AND project_id = $2", [templateId, projectId]);
  if (!t) throw notFound("template");
  const { rows: tas } = await db.query("SELECT * FROM template_activity WHERE template_id = $1 ORDER BY number", [templateId]);
  const taIds = tas.map((x) => x.id);
  const { rows: nodes } = await db.query(
    `SELECT DISTINCT n.* FROM wbs_node n WHERE n.project_id = $1 AND (n.template_id = $2
       OR EXISTS (SELECT 1 FROM wbs_activity a WHERE a.node_id = n.id AND a.template_activity_id = ANY($3)))`, [projectId, templateId, taIds]);
  const byVersion = new Map();
  for (const n of nodes) (byVersion.get(n.version_id) || byVersion.set(n.version_id, []).get(n.version_id)).push(n);
  const plan = [];
  for (const [versionId, ns] of byVersion) {
    const v = await versionOf(db, projectId, versionId);
    const ids = ns.map((n) => n.id);
    const { rows: acts } = await db.query("SELECT * FROM wbs_activity WHERE node_id = ANY($1)", [ids]);
    const updates = [], adds = [];
    for (const n of ns) {
      const mine = acts.filter((a) => a.node_id === n.id);
      for (const ta of tas) {
        const code = w.activityCode(n.code, ta.number, v.settings.separator);
        const a = mine.find((x) => x.template_activity_id === ta.id);
        const clash = mine.find((x) => x.code === code && x.id !== a?.id);
        if (clash) throw bad(`${n.code}: کد ${code} را فعالیت «${clash.name}» دارد؛ اول آن را جابه‌جا کنید.`);
        if (a) {
          const next = { code, name: ta.name, wf: ta.wf == null ? null : Number(ta.wf), description: ta.description, template_code: ta.code };
          const same = a.code === next.code && a.name === next.name && (a.wf == null ? null : Number(a.wf)) === next.wf
            && (a.description || null) === (next.description || null) && a.template_code === next.template_code;
          if (!same) updates.push({ id: a.id, node: n.code, ...next });
        } else if (n.template_id === templateId) {
          adds.push({ id: `sync-${n.id}-${ta.id}`, node_id: n.id, node: n.code, code, name: ta.name, wf: ta.wf, description: ta.description,
            template_activity_id: ta.id, template_code: ta.code, seq: ta.number });
        }
      }
    }
    if (!updates.length && !adds.length) continue;
    await guard(db, projectId, v, ({ nodes: all, acts: aa }) => ({ nodes: all,
      acts: [...aa.map((a) => { const u = updates.find((x) => x.id === a.id); return u ? { ...a, ...u } : a; }), ...adds] }));
    plan.push({ v, updates, adds });
  }
  const summary = { updated: plan.reduce((s, p) => s + p.updates.length, 0), added: plan.reduce((s, p) => s + p.adds.length, 0),
    versions: plan.map((p) => p.v.code), nodes: [...new Set(plan.flatMap((p) => [...p.updates, ...p.adds].map((x) => x.node)))] };
  if (dryRun) return summary;
  for (const p of plan) {
    // codes move in two steps so that two activities swapping numbers do not collide on the way
    for (const u of p.updates) await db.query("UPDATE wbs_activity SET code = $2 WHERE id = $1", [u.id, `~sync~${u.id}`]);
    for (const u of p.updates) {
      await db.query("UPDATE wbs_activity SET code = $2, name = $3, wf = $4, description = $5, template_code = $6 WHERE id = $1",
        [u.id, u.code, u.name, u.wf, u.description, u.template_code]);
    }
    for (const a of p.adds) {
      await db.query(
        `INSERT INTO wbs_activity (project_id, node_id, code, name, wf, template_activity_id, template_code, description, seq) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [projectId, a.node_id, a.code, a.name, a.wf, a.template_activity_id, a.template_code, a.description, a.seq]);
    }
  }
  await LOG(db, projectId, `الگوی ${t.code}`, `اعمال روی WBS: ${summary.updated} فعالیت به‌روز، ${summary.added} فعالیت اضافه`, userId);
  return summary;
}
