/**
 * EPS, PMS versions, WBS, activity templates and WBS activities (migrations
 * 073, 083; the rules are lib/eps/wbs.mjs). Only what a person types is
 * stored; every derived figure is worked out on read. Call inside
 * `withProject`.
 *
 * The WBS is the PMS's, one tree for all its versions (083). A call names
 * the tree by `pmsId`, or by `versionId` — then the version's planning rows
 * (activity_plan: start, finish, planned quantity) stand over the
 * activities' own, and an activity the version does not carry keeps its own.
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

export async function savePms(db, { projectId, contractId, id = null, code, title, pmsType = null, description = null, registeredOn = null, planStart = null, planEnd = null, actualStart = null, actualEnd = null, budgetPlan, budgetActual, userId }) {
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
    // the root's budget: left out of the call, kept; the tree's 100% rule must still hold under it
    if (budgetPlan !== undefined || budgetActual !== undefined) r = await savePmsBudget(db, { projectId, id, budgetPlan: budgetPlan === undefined ? r.budget_plan : budgetPlan,
      budgetActual: budgetActual === undefined ? r.budget_actual : budgetActual });
  } else {
    const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM eps_pms WHERE contract_id = $1", [contractId]);
    ({ rows: [r] } = await db.query(
      `INSERT INTO eps_pms (project_id, contract_id, code, title, registered_on, plan_start, plan_end, actual_start, actual_end, seq, created_by, pms_type, description,
         settings, budget_plan, budget_actual)
       VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [projectId, contractId, c, text(title), reg, ...d, m.n, userId, text(pmsType), text(description), w.checkSettings(w.DEFAULT_SETTINGS).settings,
        num(budgetPlan, "بودجهٔ برنامه‌ای"), num(budgetActual, "بودجهٔ واقعی")]));
  }
  await LOG(db, projectId, `PMS ${c}`, id ? "ویرایش" : "ایجاد", userId);
  return r;
}

/** The root budget of a PMS's WBS; a budget under which the tree's weights no longer hold is refused. */
export async function savePmsBudget(db, { projectId, id, budgetPlan = null, budgetActual = null }) {
  const v = await planOf(db, projectId, { pmsId: id });
  const b = [num(budgetPlan, "بودجهٔ برنامه‌ای"), num(budgetActual, "بودجهٔ واقعی")];
  const t = await treeOf(db, projectId, { ...v, budget_plan: b[0], budget_actual: b[1] });
  const before = new Set((await treeOf(db, projectId, v)).problems);
  const fresh = t.problems.filter((p) => !before.has(p));
  if (fresh.length) throw bad(fresh.join(" "));
  const { rows: [r] } = await db.query("UPDATE eps_pms SET budget_plan = $2, budget_actual = $3 WHERE id = $1 RETURNING *", [id, ...b]);
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
      `INSERT INTO eps_version (project_id, pms_id, code, title, description, registered_on, start_on, end_on, budget_plan, budget_actual, seq, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE),$7,$8,$9,$10,$11,$12) RETURNING *`,
      [projectId, pmsId, ...vals, m.n, userId]));
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
    // its planning rows are activities of the PMS it leaves: it does not take them to a tree they are not on
    const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM activity_plan WHERE version_id = $1", [id]);
    if (n) throw bad(`این نسخه ${n} ردیف برنامه از فعالیت‌های PMS خودش دارد و به PMS دیگری نمی‌رود.`);
    // the PMS it joins keeps its own master plan: a master version that moves goes as an ordinary one
    const { rows: [m] } = await db.query("SELECT 1 FROM eps_version WHERE pms_id = $1 AND master", [to]);
    await db.query("UPDATE eps_version SET pms_id = $2, master = master AND $3 WHERE id = $1", [id, to, !m]);
  }
  const { rows } = await db.query("SELECT id FROM eps_version WHERE pms_id = $1 ORDER BY seq, code", [to]);
  return setOrder(db, "eps_version", w.reorder(rows.map((x) => x.id), id, { beforeId, afterId }));
}

export async function removeEps(db, { projectId, kind, id, userId = null }) {
  if (kind === "pms") {
    await removePms(db, { projectId, id, userId });
  } else {
    const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM activity_plan WHERE version_id = $1", [id]);
    if (n) throw bad(`این نسخه ${n} ردیف برنامه دارد؛ اول ردیف‌های برنامه (Planning) را حذف کنید.`);
    await db.query("DELETE FROM eps_version WHERE id = $1 AND project_id = $2", [id, projectId]);
  }
}

/**
 * Everything under a PMS, counted — what deleting it (or replacing it from a
 * file) takes with it — and what stops that: a contract daily report that
 * names one of its activities (a report is a record of work done; it is not
 * rewritten), or a control account measured on one of its nodes (that is
 * project control's to move first).
 */
export async function pmsContents(db, { projectId, id }) {
  const { rows: [p] } = await db.query("SELECT id, code, title FROM eps_pms WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!p) throw notFound("pms");
  const one = async (sql) => (await db.query(sql, [id])).rows[0].n;
  const acts = "SELECT a.id FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1";
  const counts = {
    versions: await one("SELECT count(*)::int AS n FROM eps_version WHERE pms_id = $1"),
    plans: await one("SELECT count(*)::int AS n FROM activity_plan x JOIN eps_version v ON v.id = x.version_id WHERE v.pms_id = $1"),
    nodes: await one("SELECT count(*)::int AS n FROM wbs_node WHERE pms_id = $1"),
    activities: await one(`SELECT count(*)::int AS n FROM (${acts}) a`),
    relations: await one(`SELECT count(*)::int AS n FROM activity_relation WHERE pred_id IN (${acts}) OR succ_id IN (${acts})`),
    scopeRules: await one("SELECT count(*)::int AS n FROM scope_rule WHERE pms_id = $1"),
  };
  const { rows: ids } = await db.query(acts, [id]);
  const { rows: reports } = ids.length ? await db.query(
    `SELECT DISTINCT r.report_no FROM report r JOIN report_version v ON v.report_id = r.id
      WHERE r.project_id = $1 AND EXISTS (SELECT 1 FROM unnest($2::text[]) x WHERE strpos(v.content::text, x) > 0) ORDER BY 1`,
    [projectId, ids.map((r) => r.id)]) : { rows: [] };
  const { rows: accounts } = await db.query(
    "SELECT a.code FROM control_account a JOIN wbs_node n ON n.id = a.wbs_node_id WHERE n.pms_id = $1 ORDER BY 1", [id]);
  const blockers = [
    ...(reports.length ? [`${reports.length} گزارش روزانهٔ قرارداد فعالیت‌های این PMS را نام برده‌اند (${reports.slice(0, 5).map((r) => r.report_no).join("، ")}${reports.length > 5 ? "، …" : ""}); گزارش ثبت کار انجام‌شده است و بازنویسی نمی‌شود.`] : []),
    ...(accounts.length ? [`حساب کنترلی ${accounts.map((a) => a.code).join("، ")} روی گره‌های این PMS اندازه‌گیری می‌شود؛ اول در کنترل پروژه آن را از WBS بردارید.`] : []),
  ];
  return { pms: p, counts, blockers };
}

/**
 * Empty a PMS: its versions with their planning rows and the rows under
 * them, its WBS nodes (deepest first) with their activities, relations,
 * codes, roles, delays and scope rules, and the project's own column values
 * of all of these. The PMS row itself stays (a replacement from a file
 * writes into it). Refused, whole, while pmsContents names a blocker.
 */
export async function clearPms(db, { projectId, id, userId = null }) {
  const c = await pmsContents(db, { projectId, id });
  if (c.blockers.length) throw Object.assign(new Error(`PMS ${c.pms.code} پاک نمی‌شود: ${c.blockers.join(" ")}`), { status: 409, code: "IN_USE" });
  const go = async (tx) => {
    const { rows: keys } = await tx.query(
      `SELECT id::text AS k FROM eps_version WHERE pms_id = $1
       UNION ALL SELECT id::text FROM wbs_node WHERE pms_id = $1
       UNION ALL SELECT a.id::text FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1`, [id]);
    const versions = "SELECT id FROM eps_version WHERE pms_id = $1";
    await tx.query(`DELETE FROM activity_requirement WHERE version_id IN (${versions})`, [id]);
    await tx.query(`DELETE FROM activity_comment WHERE version_id IN (${versions})`, [id]);
    await tx.query(`DELETE FROM activity_plan WHERE version_id IN (${versions})`, [id]);
    await tx.query("DELETE FROM eps_version WHERE pms_id = $1", [id]);
    await tx.query("DELETE FROM scope_rule WHERE pms_id = $1", [id]);
    // a node's parent is held ON DELETE RESTRICT: the leaves go first, level by level up
    for (;;) {
      const { rowCount } = await tx.query(
        "DELETE FROM wbs_node n WHERE n.pms_id = $1 AND NOT EXISTS (SELECT 1 FROM wbs_node c WHERE c.parent_id = n.id)", [id]);
      if (!rowCount) break;
    }
    if (keys.length) await tx.query("DELETE FROM custom_value WHERE row_key = ANY($1::text[])", [keys.map((k) => k.k)]);
  };
  if (db.inTransaction || !db.transaction) await go(db); else await db.transaction(go);
  await LOG(db, projectId, `PMS ${c.pms.code}`, `پاک شد: ${c.counts.versions} نسخه، ${c.counts.nodes} گره، ${c.counts.activities} فعالیت`, userId);
  return c;
}

/** A PMS and everything under it (clearPms), then the PMS itself. */
export async function removePms(db, { projectId, id, userId = null }) {
  const go = async (tx) => {
    const c = await clearPms(tx, { projectId, id, userId });
    await tx.query("DELETE FROM custom_value WHERE row_key = $1", [String(id)]);
    await tx.query("DELETE FROM eps_pms WHERE id = $1 AND project_id = $2", [id, projectId]);
    return c;
  };
  return db.inTransaction || !db.transaction ? go(db) : db.transaction(go);
}

/**
 * Bring the W.F of a node's children (child nodes and activities together),
 * or of the PMS's top nodes (`nodeId` null), down to 100% (lib/eps/wbs.mjs
 * fitTo100). A child node whose W.F is worked out from its budget
 * (budget_to_wf) is not typed here: such a node is refused, with what to
 * do instead.
 */
export async function fitWf(db, { projectId, pmsId, nodeId = null, userId = null }) {
  const v = await planOf(db, projectId, { pmsId });
  const t = await treeOf(db, projectId, v);
  const over = w.wfOverflows(t).find((o) => o.id === (nodeId || null));
  if (!over) return { updated: 0 };
  if (v.settings.budgetMode === "budget_to_wf" && over.children.some((k) => k.kind === "node" && k.wf))
    throw bad("روش محاسبه «W.F از بودجه» است: W.F گره‌ها از بودجهٔ آن‌ها درمی‌آید. بودجهٔ فرزندان را اصلاح کنید، یا روش محاسبه را عوض کنید.");
  const fit = w.fitTo100(over.children);
  const go = async (tx) => {
    for (const k of fit) {
      if (k.kind === "node") await tx.query("UPDATE wbs_node SET wf = $2 WHERE id = $1 AND pms_id = $3", [k.id, k.wf, v.pms_id]);
      else await tx.query("UPDATE wbs_activity SET wf = $2 WHERE id = $1", [k.id, k.wf]);
    }
  };
  if (db.inTransaction || !db.transaction) await go(db); else await db.transaction(go);
  await LOG(db, projectId, `WBS ${v.pms_code}`, `W.F فرزندان ${over.code || "ریشه"} از ${over.sum}٪ به ۱۰۰٪ رسید (${fit.length} ردیف)`, userId);
  return { updated: fit.length, from: over.sum };
}

/** The contract's EPS: its PMSs in order, each with its versions in order, and the durations. */
export async function epsBoard(db, { projectId, contractId }) {
  const { rows: pms } = await db.query("SELECT * FROM eps_pms WHERE project_id = $1 AND contract_id = $2 ORDER BY seq, code", [projectId, contractId]);
  const { rows: vs } = await db.query(
    `SELECT v.*, (SELECT count(*)::int FROM activity_plan x WHERE x.version_id = v.id) AS planned FROM eps_version v
      WHERE v.project_id = $1 AND v.pms_id = ANY($2) ORDER BY v.seq, v.code`, [projectId, pms.map((p) => p.id)]);
  const { rows: nc } = await db.query("SELECT pms_id, count(*)::int AS n FROM wbs_node WHERE pms_id = ANY($1) GROUP BY pms_id", [pms.map((p) => p.id)]);
  const nodes = new Map(nc.map((x) => [x.pms_id, x.n]));
  const d = (r, a, b) => ({ [a]: iso(r[a]), [b]: iso(r[b]) });
  return pms.map((p) => ({
    ...p, registered_on: iso(p.registered_on), ...d(p, "plan_start", "plan_end"), ...d(p, "actual_start", "actual_end"),
    planDays: w.duration(p.plan_start, p.plan_end), actualDays: w.duration(p.actual_start, p.actual_end), nodes: nodes.get(p.id) || 0,
    versions: vs.filter((v) => v.pms_id === p.id).map((v) => ({ ...v, registered_on: iso(v.registered_on), ...d(v, "start_on", "end_on"),
      days: w.duration(v.start_on, v.end_on) })),
  }));
}

// ── WBS ──────────────────────────────────────────────────────────────────

/**
 * The tree a call names, as `{ pmsId }` or `{ versionId }`: the PMS (its
 * code, contract, settings and root budget) and, with a version, the version
 * whose planning rows stand over the activities. `id` is the version's, or
 * null for the PMS's tree as it is.
 */
export async function planOf(db, projectId, { pmsId = null, versionId = null } = {}) {
  let ver = null;
  if (versionId) {
    ({ rows: [ver] } = await db.query("SELECT * FROM eps_version WHERE id = $1 AND project_id = $2", [versionId, projectId]));
    if (!ver) throw notFound("version");
    if (pmsId && pmsId !== ver.pms_id) throw bad("این نسخه از PMS دیگری است.");
  }
  const pid = pmsId || ver?.pms_id;
  if (!pid) throw bad("PMS یا نسخه را انتخاب کنید.");
  const { rows: [p] } = await db.query("SELECT * FROM eps_pms WHERE id = $1 AND project_id = $2", [pid, projectId]);
  if (!p) throw notFound("pms");
  return {
    ...(ver || {}), id: ver?.id ?? null, code: ver?.code ?? p.code, title: ver?.title ?? p.title, master: !!ver?.master, isVersion: !!ver,
    pms_id: p.id, pms_code: p.code, pms_title: p.title, contract_id: p.contract_id,
    settings: w.checkSettings(p.settings).settings, budget_plan: p.budget_plan, budget_actual: p.budget_actual,
    version_budget_plan: ver?.budget_plan ?? null, version_budget_actual: ver?.budget_actual ?? null,
  };
}

export async function saveSettings(db, { projectId, pmsId = null, versionId = null, settings, userId }) {
  const v = await planOf(db, projectId, { pmsId, versionId });
  const { settings: s, problems } = w.checkSettings(settings);
  if (problems.length) throw bad(problems.join(" "));
  // a mode under which the tree's weights no longer hold is refused, not applied
  const t = await treeOf(db, projectId, { ...v, settings: s });
  if (t.problems.length) throw bad(`با این روش محاسبه: ${t.problems.join(" ")}`);
  await db.query("UPDATE eps_pms SET settings = $2 WHERE id = $1", [v.pms_id, s]);
  await LOG(db, projectId, `تنظیمات WBS ${v.pms_code}`, `${w.BUDGET_MODES[s.budgetMode]} · جداکننده «${s.separator}»`, userId);
  return s;
}

/**
 * The worked-out figures written into the stored ones (owner's requirements
 * 2026-10-22, item 9, «به‌روزرسانی اوزان/بودجه»): under «budget from W.F»
 * each node's budget becomes W.F × its parent's budget; under «W.F from
 * budget» each node's W.F becomes its budget ÷ its parent's. Manual keeps
 * what was typed, so there is nothing to bring up to date. Returns how many
 * nodes changed.
 */
export async function refreshWeights(db, { projectId, pmsId = null, versionId = null, userId }) {
  const v = await planOf(db, projectId, { pmsId, versionId });
  const mode = v.settings.budgetMode;
  if (mode === "manual") throw bad("روش محاسبه «دستی» است؛ چیزی برای به‌روزرسانی نیست. اول روش محاسبه را در تنظیمات WBS انتخاب کنید.");
  const t = await treeOf(db, projectId, v);
  let n = 0;
  for (const x of t.byId.values()) {
    const [col, now, was] = mode === "wf_to_budget" ? ["budget_plan", x.budgetPlan, num(x.budget_plan)] : ["wf", x.wf, num(x.wf_typed)];
    if (now === was || (now == null && was == null)) continue;
    await db.query(`UPDATE wbs_node SET ${col} = $2 WHERE id = $1 AND pms_id = $3`, [x.id, now, v.pms_id]);
    n++;
  }
  await LOG(db, projectId, `WBS ${v.pms_code}`, `به‌روزرسانی ${mode === "wf_to_budget" ? "بودجه از W.F" : "W.F از بودجه"}: ${n} گره`, userId);
  return { updated: n };
}

/**
 * The tree's stored rows; with a version, each activity it plans carries the
 * plan's dates and planned quantity over its own, and the plan itself as
 * `plan` (an activity the version does not plan: `plan` null, its own kept).
 */
export async function rowsOf(db, v) {
  const { rows: nodes } = await db.query("SELECT * FROM wbs_node WHERE pms_id = $1", [v.pms_id]);
  let { rows: acts } = await db.query("SELECT a.* FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1", [v.pms_id]);
  if (v.id) {
    const { rows: plans } = await db.query("SELECT * FROM activity_plan WHERE version_id = $1", [v.id]);
    const by = new Map(plans.map((x) => [x.activity_id, x]));
    acts = acts.map((a) => { const x = by.get(a.id); return x ? { ...w.overlayPlan(a, x) } : { ...a, plan: null }; });
  }
  return { nodes, acts };
}
async function treeOf(db, projectId, v, change = null) {
  let { nodes, acts } = await rowsOf(db, v);
  if (change) ({ nodes, acts } = change({ nodes, acts }));
  return w.computeTree({ version: v, nodes, activities: acts, settings: v.settings });
}
/** Refuse a change that breaks the 100% rule somewhere it did not already break. */
async function guard(db, projectId, v, change) {
  const before = new Set((await treeOf(db, projectId, v)).problems);
  const after = (await treeOf(db, projectId, v, change)).problems.filter((p) => !before.has(p));
  if (after.length) throw bad(after.join(" "));
}

/** The PMS's WBS (as a version plans it, when one is named) with every derived figure, and the templates with their activities. */
export async function wbsView(db, { projectId, pmsId = null, versionId = null }) {
  const v = await planOf(db, projectId, { pmsId, versionId });
  const t = await treeOf(db, projectId, v);
  const strip = (n) => ({ ...n, children: n.children.map(strip) });
  return {
    version: { ...v, registered_on: iso(v.registered_on), start_on: iso(v.start_on), end_on: iso(v.end_on), days: w.duration(v.start_on, v.end_on) },
    settings: v.settings, roots: t.roots.map(strip), rootWf: t.rootWf, problems: t.problems,
    // where the children's W.F add up past 100% (the WBS page's list, with its «fit to 100%»)
    overflows: w.wfOverflows(t),
    templates: await templatesWithActivities(db, { projectId }),
    // the PMS itself, for its own sub-form under the tree (PMS DETAIL)
    pms: await (async () => { const { rows: [p] } = await db.query("SELECT * FROM eps_pms WHERE id = $1", [v.pms_id]);
      return { ...p, registered_on: iso(p.registered_on), plan_start: iso(p.plan_start), plan_end: iso(p.plan_end), actual_start: iso(p.actual_start), actual_end: iso(p.actual_end) }; })(),
  };
}

const NODE_FIELDS = (b) => ({
  name: text(b.name), budget_plan: num(b.budgetPlan, "بودجهٔ پیش‌بینی"), budget_actual: num(b.budgetActual, "بودجهٔ واقعی"),
  qty: num(b.qty, "تعداد"), unit: text(b.unit), volume_plan: num(b.volumePlan, "حجم پیش‌بینی"), volume_actual: num(b.volumeActual, "حجم واقعی"),
  wf: num(b.wf, "W.F", { max: 100 }), plan_start: date(b.planStart, "شروع برنامه"), plan_end: date(b.planEnd, "پایان برنامه"),
  actual_start: date(b.actualStart, "شروع واقعی"), actual_end: date(b.actualEnd, "پایان واقعی"), description: text(b.description),
});

/** The codes of a node's child nodes: an activity numbered automatically on that node does not take one of them (a template's numbers stay the template's). */
export async function childCodes(db, nodeId) {
  const { rows } = await db.query("SELECT code FROM wbs_node WHERE parent_id = $1", [nodeId]);
  return new Set(rows.map((r) => r.code));
}

/** The code a new node under `parentId` gets by default. */
export async function suggestNodeCode(db, { projectId, pmsId = null, versionId = null, parentId = null }) {
  const v = await planOf(db, projectId, { pmsId, versionId });
  const { rows: sib } = await db.query("SELECT code FROM wbs_node WHERE pms_id = $1 AND parent_id IS NOT DISTINCT FROM $2", [v.pms_id, parentId]);
  const parent = parentId ? (await db.query("SELECT code FROM wbs_node WHERE id = $1 AND pms_id = $2", [parentId, v.pms_id])).rows[0] : null;
  if (parentId && !parent) throw notFound("parent");
  const level = parentId ? (await levelOf(db, parentId)) + 1 : 1;
  const pCode = parent ? parent.code : v.pms_code;
  // a node's children and its activities share one numbering: PM01.C.02.01 is never both
  const { rows: acts } = parentId ? await db.query("SELECT code FROM wbs_activity WHERE node_id = $1", [parentId]) : { rows: [] };
  return w.suggestCode(pCode, level, w.nextNumber(pCode, [...sib, ...acts].map((x) => x.code), level, v.settings), v.settings);
}
async function levelOf(db, id) {
  const { rows: [r] } = await db.query(
    `WITH RECURSIVE up AS (SELECT id, parent_id, 1 AS d FROM wbs_node WHERE id = $1
       UNION ALL SELECT n.id, n.parent_id, up.d + 1 FROM wbs_node n JOIN up ON n.id = up.parent_id) SELECT max(d)::int AS d FROM up`, [id]);
  return r.d;
}

/** A WBS node, new or edited. The code is suggested when none is typed; the children's W.F stays within 100%. */
export async function saveNode(db, { projectId, pmsId = null, versionId = null, id = null, parentId = null, code = null, templateId, ...b }) {
  const v = await planOf(db, projectId, { pmsId, versionId });
  const P = v.pms_id;
  const f = NODE_FIELDS(b);
  if (!f.name) throw bad("نام گره لازم است.");
  span(f.plan_start, f.plan_end, "برنامه"); span(f.actual_start, f.actual_end, "واقعی");
  let c = text(code);
  const have = id ? (await db.query("SELECT * FROM wbs_node WHERE id = $1 AND pms_id = $2", [id, P])).rows[0] : null;
  if (id && !have) throw notFound("node");
  const parent = id ? have.parent_id : parentId || null;
  if (!c) c = id ? have.code : await suggestNodeCode(db, { projectId, pmsId: P, parentId: parent });
  const { rows: [dup] } = await db.query("SELECT 1 FROM wbs_node WHERE pms_id = $1 AND code = $2 AND id IS DISTINCT FROM $3", [P, c, id]);
  if (dup) throw bad(`کد ${c} در این WBS هست.`);
  const tpl = templateId === undefined ? (have?.template_id ?? null) : templateId || null;
  if (tpl) {
    const { rows: [t] } = await db.query("SELECT 1 FROM activity_template WHERE id = $1 AND project_id = $2", [tpl, projectId]);
    if (!t) throw bad("الگوی فعالیت پیدا نشد.");
  }
  const tmpId = id || "new";
  await guard(db, projectId, v, ({ nodes, acts }) => ({
    nodes: id ? nodes.map((n) => (n.id === id ? { ...n, ...f, code: c } : n))
      : [...nodes, { id: tmpId, pms_id: P, parent_id: parent, code: c, seq: 1e9, ...f }], acts }));
  let r;
  const cols = Object.keys(f);
  if (id) {
    ({ rows: [r] } = await db.query(
      `UPDATE wbs_node SET code = $3, template_id = $4, ${cols.map((k, i) => `${k} = $${i + 5}`).join(", ")} WHERE id = $1 AND pms_id = $2 RETURNING *`,
      [id, P, c, tpl, ...cols.map((k) => f[k])]));
    if (c !== have.code) await rebaseUnder(db, id, have.code, c, v.settings.separator);
  } else {
    if (parent) {
      const { rows: [p] } = await db.query("SELECT 1 FROM wbs_node WHERE id = $1 AND pms_id = $2", [parent, P]);
      if (!p) throw notFound("parent");
    }
    const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM wbs_node WHERE pms_id = $1 AND parent_id IS NOT DISTINCT FROM $2", [P, parent]);
    ({ rows: [r] } = await db.query(
      `INSERT INTO wbs_node (project_id, pms_id, parent_id, code, seq, template_id, ${cols.join(", ")})
       VALUES ($1,$2,$3,$4,$5,$6,${cols.map((_, i) => `$${i + 7}`).join(",")}) RETURNING *`,
      [projectId, P, parent, c, m.n, tpl, ...cols.map((k) => f[k])]));
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
export async function moveNode(db, { projectId, pmsId = null, versionId = null, id, parentId = null, beforeId = null, afterId = null }) {
  const v = await planOf(db, projectId, { pmsId, versionId });
  const P = v.pms_id;
  const { rows: [n] } = await db.query("SELECT * FROM wbs_node WHERE id = $1 AND pms_id = $2", [id, P]);
  if (!n) throw notFound("node");
  const to = parentId || null;
  if (to) {
    if ((await subtree(db, id)).includes(to)) throw bad("گره را نمی‌توان زیر خودش یا فرزندانش برد.");
    const { rows: [p] } = await db.query("SELECT 1 FROM wbs_node WHERE id = $1 AND pms_id = $2", [to, P]);
    if (!p) throw notFound("parent");
  }
  if (to !== n.parent_id) {
    await guard(db, projectId, v, ({ nodes, acts }) => ({ nodes: nodes.map((x) => (x.id === id ? { ...x, parent_id: to } : x)), acts }));
    const code = await suggestNodeCode(db, { projectId, pmsId: P, parentId: to });
    await db.query("UPDATE wbs_node SET parent_id = $2, code = $3 WHERE id = $1", [id, to, code]);
    await rebaseUnder(db, id, n.code, code, v.settings.separator);
  }
  const { rows: sib } = await db.query("SELECT id FROM wbs_node WHERE pms_id = $1 AND parent_id IS NOT DISTINCT FROM $2 ORDER BY seq, code", [P, to]);
  await setOrder(db, "wbs_node", w.reorder(sib.map((x) => x.id), id, { beforeId, afterId }));
}

/** Copy a node with everything under it — nodes and activities — under another node (or the root), with new codes. */
export async function copyNode(db, { projectId, pmsId = null, versionId = null, id, parentId = null }) {
  const v = await planOf(db, projectId, { pmsId, versionId });
  const P = v.pms_id;
  const ids = await subtree(db, id);
  if (!ids.length) throw notFound("node");
  if (parentId && ids.includes(parentId)) throw bad("گره در زیر خودش کپی نمی‌شود.");
  const { rows: nodes } = await db.query("SELECT * FROM wbs_node WHERE id = ANY($1)", [ids]);
  const { rows: acts } = await db.query("SELECT * FROM wbs_activity WHERE node_id = ANY($1)", [ids]);
  const top = nodes.find((x) => x.id === id);
  const code = await suggestNodeCode(db, { projectId, pmsId: P, parentId });
  const sep = v.settings.separator;
  const map = new Map();
  const make = async (src, newParent) => {
    const c = src.id === id ? code : w.rebase(src.code, top.code + sep, code + sep);
    const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM wbs_node WHERE pms_id = $1 AND parent_id IS NOT DISTINCT FROM $2", [P, newParent]);
    const { rows: [r] } = await db.query(
      `INSERT INTO wbs_node (project_id, pms_id, parent_id, code, name, seq, budget_plan, budget_actual, qty, unit, volume_plan, volume_actual, wf,
         plan_start, plan_end, actual_start, actual_end, description, template_id)
       SELECT project_id, pms_id, $2, $3, name, $4, budget_plan, budget_actual, qty, unit, volume_plan, volume_actual, wf,
         plan_start, plan_end, actual_start, actual_end, description, template_id FROM wbs_node WHERE id = $1 RETURNING *`, [src.id, newParent, c, m.n]);
    map.set(src.id, r);
    for (const a of acts.filter((x) => x.node_id === src.id)) {
      await db.query(
        `INSERT INTO wbs_activity (project_id, node_id, code, name, wf, template_activity_id, template_code, progress, description, seq, act_type, activity_no, wf_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,NULL,$11)`,
        [projectId, r.id, w.rebase(a.code, src.code + sep, c + sep), a.name, a.wf, a.template_activity_id, a.template_code, a.description, a.seq, a.act_type, a.wf_rate]);
    }
    for (const ch of nodes.filter((x) => x.parent_id === src.id).sort((a, b) => a.seq - b.seq)) await make(ch, r.id);
  };
  await guard(db, projectId, v, ({ nodes: all, acts: aa }) => ({
    nodes: [...all, ...nodes.map((x) => ({ ...x, id: `copy-${x.id}`, parent_id: x.id === id ? parentId : `copy-${x.parent_id}`, code: `copy-${x.code}` }))], acts: aa }));
  await make(top, parentId);
  return map.get(id);
}

export async function removeNode(db, { projectId, pmsId = null, versionId = null, id }) {
  const v = await planOf(db, projectId, { pmsId, versionId });
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM wbs_node WHERE parent_id = $1", [id]);
  if (n) throw bad("این گره فرزند دارد؛ اول فرزندان را جابه‌جا یا حذف کنید.");
  const { rows: [acc] } = await db.query("SELECT code FROM control_account WHERE wbs_node_id = $1", [id]);
  if (acc) throw bad(`این گره حساب کنترلی ${acc.code} است؛ اول حساب را از کنترل پروژه بردارید.`);
  const { rowCount } = await db.query("DELETE FROM wbs_node WHERE id = $1 AND pms_id = $2 AND project_id = $3", [id, v.pms_id, projectId]);
  if (!rowCount) throw notFound("node");
}

// ── activities on a WBS node ─────────────────────────────────────────────

async function nodeAndVersion(db, projectId, nodeId) {
  const { rows: [n] } = await db.query("SELECT * FROM wbs_node WHERE id = $1 AND project_id = $2", [nodeId, projectId]);
  if (!n) throw notFound("node");
  return { node: n, v: await planOf(db, projectId, { pmsId: n.pms_id }) };
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
export async function saveActivity(db, { projectId, nodeId, id = null, code = null, name, wf, progress = null, description = null, actType, activityNo, wfRate,
  statusText, updateDate, suspended, addToInvoice, scaleUpPct, constraintStart, constraintEnd, ...rest }) {
  const { node, v } = await nodeAndVersion(db, projectId, nodeId);
  if (!text(name)) throw bad("نام فعالیت لازم است.");
  const f = { name: text(name), wf: num(wf, "W.F", { max: 100 }), progress: num(progress, "پیشرفت", { max: 100 }), description: text(description) };
  // type, ID and W.F rate: left out of the call, kept as they are
  if (actType !== undefined) f.act_type = text(actType);
  if (activityNo !== undefined) f.activity_no = text(activityNo);
  if (wfRate !== undefined) f.wf_rate = num(wfRate, "WF rate", { min: null });
  // the activity-detail fields of image 1 (084), likewise
  if (statusText !== undefined) f.status_text = text(statusText);
  if (updateDate !== undefined) f.update_date = date(updateDate, "تاریخ به‌روزرسانی");
  if (suspended !== undefined) f.suspended = suspended === true || suspended === "true";
  if (addToInvoice !== undefined) f.add_to_invoice = addToInvoice === true || addToInvoice === "true";
  if (scaleUpPct !== undefined) f.scale_up_pct = num(scaleUpPct, "Scale up", { min: null });
  if (constraintStart !== undefined) f.constraint_start = date(constraintStart, "شروع محدودیت");
  if (constraintEnd !== undefined) f.constraint_end = date(constraintEnd, "پایان محدودیت");
  if (f.constraint_start !== undefined || f.constraint_end !== undefined) {
    const { rows: [old] } = id ? await db.query("SELECT constraint_start, constraint_end FROM wbs_activity WHERE id = $1", [id]) : { rows: [{}] };
    span(f.constraint_start !== undefined ? f.constraint_start : iso(old?.constraint_start), f.constraint_end !== undefined ? f.constraint_end : iso(old?.constraint_end), "محدودیت");
  }
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
      const used = new Set([...have.map((a) => a.code), ...(await childCodes(db, nodeId))]);
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
  const byPms = new Map();
  for (const n of nodes) (byPms.get(n.pms_id) || byPms.set(n.pms_id, []).get(n.pms_id)).push(n);
  const plan = [];
  for (const [pmsId, ns] of byPms) {
    const v = await planOf(db, projectId, { pmsId });
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

/** The 100% rule over a change to a PMS's tree, for other repositories (refused where it newly breaks). */
export async function guardPlan(db, { projectId, pmsId = null, versionId = null, change }) {
  return guard(db, projectId, await planOf(db, projectId, { pmsId, versionId }), change);
}
/** A PMS's WBS settings, for other repositories. */
export const planSettings = async (db, { projectId, pmsId = null, versionId = null }) => (await planOf(db, projectId, { pmsId, versionId })).settings;
