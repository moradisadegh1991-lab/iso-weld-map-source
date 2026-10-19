/**
 * The activity view after Primavera P6 and the daily progress entry (owner's
 * «PMS» document, 2026-10-16; migration 074; the rules are
 * lib/eps/activities.mjs and lib/eps/wbs.mjs). Call inside `withProject`.
 *
 * The quantity done is a section of the contract's daily report: adding it
 * here writes a new version of that report through its workflow — the same
 * stage rules, signatures and lock as everything else in the report.
 */
import * as w from "../../eps/wbs.mjs";
import * as ea from "../../eps/activities.mjs";
import * as cd from "../../reports/contract-daily.mjs";
import * as rp from "./reports.mjs";
import * as eps from "./eps.mjs";
import { editContractReport, contractCompanies } from "./contract-reports.mjs";
import { logEvent } from "./log.mjs";
import { versionScope, ruleState, ruleHistory, filterChoices } from "./eps-scope.mjs";
import { summarize as summarizeScope } from "../../eps/scope.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (x) => Object.assign(new Error(`${x} not found`), { status: 404 });
const text = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).replace(/\s+/g, " ").trim());
const iso = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d ? String(d).slice(0, 10) : null);
const date = (v, what) => {
  const t = text(v);
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw bad(`${what}: تاریخ به شکل YYYY-MM-DD.`);
  return t;
};
const num = (v, what, { min = 0 } = {}) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[٬,]/g, ""));
  if (!Number.isFinite(n)) throw bad(`${what}: «${v}» عدد نیست.`);
  if (min != null && n < min) throw bad(`${what} منفی نمی‌شود.`);
  return n;
};
const LOG = (db, projectId, label, comment, userId) => logEvent(db, { projectId, section: "controls", entityType: "eps", entityId: null, label, action: "updated", comment, userId });

/** An activity with its node, version and contract. */
async function activityOf(db, projectId, activityId) {
  const { rows: [a] } = await db.query(
    `SELECT a.*, n.version_id, n.code AS node_code, n.name AS node_name, v.pms_id, p.contract_id
       FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id JOIN eps_version v ON v.id = n.version_id JOIN eps_pms p ON p.id = v.pms_id
      WHERE a.id = $1 AND a.project_id = $2`, [activityId, projectId]);
  if (!a) throw notFound("activity");
  return a;
}

/** Every work-done line of the contract's daily reports, at each report's latest version, cancelled reports left out. */
export async function progressLines(db, { projectId, contractId }) {
  const { rows } = await db.query(
    `SELECT r.id, r.report_no, r.report_date, r.status, r.stage_seq, s.name AS stage_name,
            (SELECT content FROM report_version v WHERE v.report_id = r.id ORDER BY version_no DESC LIMIT 1) AS content
       FROM report r JOIN report_type rt ON rt.id = r.report_type_id LEFT JOIN report_stage s ON s.workflow_id = rt.workflow_id AND s.seq = r.stage_seq
      WHERE r.project_id = $1 AND r.contract_id = $2 AND r.status <> 'cancelled' ORDER BY r.report_date, r.report_no`, [projectId, contractId]);
  return rows.flatMap((r) => cd.activityLines(r.content).map((l) => ({
    ...l, reportId: r.id, reportNo: r.report_no, date: iso(r.report_date), status: r.status, stageName: r.stage_name })));
}

const sumBy = (lines, key) => {
  const m = new Map();
  for (const l of lines) m.set(l[key], (m.get(l[key]) || 0) + Number(l.qty || 0));
  return m;
};

/** Walk the computed tree: every activity with its done, progress, codes and free float; every node with its progress rolled up. */
function decorate(roots, { doneBy, codesBy, relations, scopeBy = new Map() }) {
  const acts = new Map();
  const walkActs = (n) => { n.activities.forEach((a) => acts.set(a.id, a)); n.children.forEach(walkActs); };
  roots.forEach(walkActs);
  const succOf = new Map();
  for (const r of relations) (succOf.get(r.pred_id) || succOf.set(r.pred_id, []).get(r.pred_id)).push(r);
  const roll = (n) => {
    let prog = 0, any = false;
    for (const a of n.activities) {
      // an activity linked to the platform's records takes its volume and its done from them, not from the daily reports
      const sc = scopeBy.get(a.id);
      if (sc) Object.assign(a, { volumeActual: sc.qty, scope: sc });
      // an imported plan's stated progress (PMS file, MS Project %) stands until a daily report records work on the activity
      const stated = !sc && !doneBy.has(a.id) && a.progress != null;
      const p = sc ? { done: sc.done, remain: sc.qty == null ? null : Math.round((sc.qty - sc.done) * 10000) / 10000, pct: sc.pct }
        : stated ? { done: null, remain: null, pct: a.progress, stated: true } : ea.progressOf(a, doneBy.get(a.id) || 0);
      Object.assign(a, { done: p.done, remain: p.remain, pct: p.pct, pctStated: !!p.stated, codeIds: codesBy.get(a.id) || [],
        freeFloat: ea.freeFloat(a, (succOf.get(a.id) || []).filter((r) => acts.has(r.succ_id)).map((r) => ({ ...r, succ: acts.get(r.succ_id) }))) });
      if (p.pct != null) { any = true; prog += ((a.wf || 0) / 100) * p.pct; }
    }
    for (const c of n.children) {
      roll(c);
      if (!n.activities.length && c.pct != null) { any = true; prog += ((c.wf || 0) / 100) * c.pct; }
    }
    n.pct = any ? Math.round(prog * 100) / 100 : null;
  };
  roots.forEach(roll);
  return acts;
}

/**
 * A version as the activity page shows it: the WBS with its activities, each
 * activity's done and progress from the daily reports, its codes and free
 * float; the relations (for the Gantt), the contract's activity codes,
 * companies and resources, and the templates that have activities.
 */
export async function activityView(db, { projectId, versionId }) {
  const view = await eps.wbsView(db, { projectId, versionId });
  const contractId = view.version.contract_id;
  const lines = await progressLines(db, { projectId, contractId });
  const relations = await relationsOf(db, versionId);
  const { rows: ac } = await db.query(
    "SELECT x.activity_id, x.code_id FROM wbs_activity_code x JOIN wbs_activity a ON a.id = x.activity_id JOIN wbs_node n ON n.id = a.node_id WHERE n.version_id = $1", [versionId]);
  const codesBy = new Map();
  for (const r of ac) (codesBy.get(r.activity_id) || codesBy.set(r.activity_id, []).get(r.activity_id)).push(r.code_id);
  const scope = await versionScope(db, { projectId, versionId });
  decorate(view.roots, { doneBy: sumBy(lines, "activityId"), codesBy, relations, scopeBy: scope.byActivity });
  const { rows: versions } = await db.query(
    `SELECT v.id, v.code, v.title, v.master, p.code AS pms_code FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id
      WHERE p.contract_id = $1 ORDER BY p.seq, v.seq`, [contractId]);
  return {
    ...view, relations, versions,
    codes: await codesOf(db, { projectId, contractId }),
    companies: await contractCompanies(db, contractId),
    resources: (await db.query("SELECT id, name, kind, unit FROM contract_resource WHERE contract_id = $1 ORDER BY seq, name", [contractId])).rows,
    templates: view.templates.filter((t) => t.activities.length),
    dates: [...new Set(lines.map((l) => l.date))].sort(),
    scope: scope.states.map((x) => ({ rule: x.rule, summary: x.summary, pending: x.pending, firstApply: x.firstApply, groups: x.groups.length })),
    scopeChoices: await filterChoices(db, { projectId }),
  };
}

async function relationsOf(db, versionId) {
  const { rows } = await db.query(
    `SELECT r.* FROM activity_relation r JOIN wbs_activity a ON a.id = r.pred_id JOIN wbs_node n ON n.id = a.node_id WHERE n.version_id = $1`, [versionId]);
  return rows;
}

/** Every activity of a version computed as the version shows it (with its node's figures): id → {act, node, version}. */
async function versionActs(db, projectId, versionId) {
  const { rows: [ver] } = await db.query(
    "SELECT v.*, p.code AS pms_code, p.contract_id FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id WHERE v.id = $1 AND v.project_id = $2", [versionId, projectId]);
  const out = new Map();
  if (!ver) return out;
  const { rows: nodes } = await db.query("SELECT * FROM wbs_node WHERE version_id = $1", [versionId]);
  const { rows: acts } = await db.query("SELECT a.* FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.version_id = $1", [versionId]);
  const t = w.computeTree({ version: ver, nodes, activities: acts, settings: w.checkSettings(ver.settings).settings });
  for (const n of t.byId.values()) for (const a of n.activities) out.set(a.id, { act: a, node: n, version: ver });
  return out;
}
/** One activity computed as its version shows it, or null. */
async function computedActivity(db, projectId, versionId, pick) {
  for (const x of (await versionActs(db, projectId, versionId)).values()) if (pick(x.act)) return x;
  return null;
}

/**
 * Everything the detail sub-forms show for one activity: its figures; the
 * work front; the versions (planning groups) that carry an activity of the
 * same code; its predecessors and successors; its progress; its roles and
 * their cost; its lines in the daily reports and their files; its codes;
 * its lines in the delay claim against the master plan.
 */
export async function activityDetail(db, { projectId, activityId, userId = null }) {
  const base = await activityOf(db, projectId, activityId);
  const here = await computedActivity(db, projectId, base.version_id, (a) => a.id === activityId);
  const act = here.act;
  const lines = (await progressLines(db, { projectId, contractId: base.contract_id }));
  const mine = lines.filter((l) => l.activityId === activityId);
  const doneByDate = {};
  for (const l of mine) doneByDate[l.date] = (doneByDate[l.date] || 0) + Number(l.qty || 0);
  // linked to the platform's records: volume and done are the items', and the daily reports carry none of it
  const { rows: [sRule] } = await db.query("SELECT * FROM scope_rule WHERE project_id = $1 AND (activity_id = $2 OR id = $3)", [projectId, activityId, base.scope_rule_id]);
  let scope = null;
  if (sRule) {
    const st = await ruleState(db, { projectId, rule: sRule });
    const items = sRule.mode === "aggregate" ? st.items : st.groups.find((g) => g.key === base.scope_item)?.items || [];
    const sum = summarizeScope(items, sRule);
    act.volumeActual = sum.qty;
    scope = { rule: sRule, madeBy: sRule.mode === "per_item", item: base.scope_item, removed: base.scope_removed, summary: sum,
      pending: sRule.mode === "aggregate" ? st.pending : null, history: await ruleHistory(db, { projectId, ruleId: sRule.id }),
      items: items.slice(0, 500).map((i) => ({ key: i.key, label: i.label, name: i.name, subsystem: i.subsystemCode, docNo: i.docNo, kind: i.kind,
        qty: i.measures?.[sRule.measure] ?? null, done: !!i.done?.[sRule.milestone] })), more: Math.max(0, items.length - 500) };
  }
  const p = scope ? { done: scope.summary.done, remain: scope.summary.qty - scope.summary.done, pct: scope.summary.pct }
    : ea.progressOf(act, mine.reduce((s, l) => s + Number(l.qty || 0), 0));
  const doneBy = sumBy(lines, "activityId");

  // planning groups: every version of the contract that has an activity of this code
  const { rows: same } = await db.query(
    `SELECT a.id, n.version_id FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id JOIN eps_version v ON v.id = n.version_id
       JOIN eps_pms p ON p.id = v.pms_id WHERE p.contract_id = $1 AND a.code = $2`, [base.contract_id, base.code]);
  const groups = [];
  for (const s of same) {
    const c = s.id === activityId ? here : await computedActivity(db, projectId, s.version_id, (a) => a.id === s.id);
    if (!c) continue;
    const pg = ea.progressOf(c.act, doneBy.get(s.id) || 0);
    const last = lines.filter((l) => l.activityId === s.id).map((l) => l.date).sort().pop() || null;
    groups.push({ versionId: c.version.id, code: c.version.code, title: c.version.title, description: c.version.description,
      registered: iso(c.version.registered_on), master: c.version.master, pms: c.version.pms_code, current: s.id === activityId,
      activityId: s.id, plan_start: c.act.plan_start, plan_end: c.act.plan_end, planDays: c.act.planDays, wv: c.act.wv,
      volumeActual: c.act.volumeActual, done: pg.done, remain: pg.remain, pct: pg.pct, lastWork: last });
  }

  groups.sort((x, y) => x.code.localeCompare(y.code));

  // relations, with the other activity's figures
  const rels = await relationsOf(db, base.version_id);
  const inVersion = await versionActs(db, projectId, base.version_id);
  const relRow = async (r, otherId) => {
    const o = inVersion.get(otherId);
    return { id: r.id, rel_type: r.rel_type, lag: r.lag, activityId: otherId, code: o?.act.code, name: o?.act.name, wbs: o?.node.code, wbsName: o?.node.name,
      plan_start: o?.act.plan_start, plan_end: o?.act.plan_end, planDays: o?.act.planDays };
  };
  const predecessors = [], successors = [];
  for (const r of rels) {
    if (r.succ_id === activityId) predecessors.push(await relRow(r, r.pred_id));
    if (r.pred_id === activityId) successors.push(await relRow(r, r.succ_id));
  }
  const succs = [];
  for (const s of successors) succs.push({ rel_type: s.rel_type, lag: s.lag, succ: { plan_start: s.plan_start, plan_end: s.plan_end } });

  // roles
  const { rows: roleRows } = await db.query(
    `SELECT r.*, c.name AS resource_name, c.kind, c.unit, cat.name AS category FROM activity_role r JOIN contract_resource c ON c.id = r.resource_id
       LEFT JOIN contract_category cat ON cat.id = c.category_id WHERE r.activity_id = $1 ORDER BY c.seq, c.name`, [activityId]);
  const roles = roleRows.map((r) => ({ ...r, ...ea.roleCost(r, act) }));

  // codes
  const { rows: codes } = await db.query(
    "SELECT c.* FROM wbs_activity_code x JOIN activity_code c ON c.id = x.code_id WHERE x.activity_id = $1 ORDER BY c.seq, c.code", [activityId]);

  // delay claim against the master plan of the activity's PMS
  const { rows: [masterV] } = await db.query("SELECT id, code FROM eps_version WHERE pms_id = $1 AND master", [base.pms_id]);
  const baseline = masterV ? await computedActivity(db, projectId, masterV.id, (a) => a.code === base.code) : null;
  const { rows: delays } = await db.query("SELECT * FROM activity_delay WHERE activity_id = $1 ORDER BY no", [activityId]);

  // files of the reports this activity's work is in
  const reportIds = [...new Set(mine.map((l) => l.reportId))];
  const { rows: files } = reportIds.length ? await db.query(
    `SELECT f.id, f.report_id, f.kind, f.name, f.caption, f.content_type, f.byte_size, f.uploaded_at, r.report_no, r.report_date
       FROM report_file f JOIN report r ON r.id = f.report_id WHERE f.report_id = ANY($1) AND f.removed_at IS NULL ORDER BY r.report_date, f.uploaded_at`, [reportIds]) : { rows: [] };
  const { rows: names } = await db.query("SELECT id, name FROM company WHERE id = ANY($1::uuid[])", [[...new Set(mine.map((l) => l.areaId).filter(Boolean))]]);
  const area = new Map(names.map((c) => [c.id, c.name]));

  // whether the user may write to each of those reports now (the report's workflow decides)
  const reportMay = {};
  if (userId) for (const id of reportIds) {
    try { const v = await rp.reportView(db, { projectId, reportId: id, userId }); reportMay[id] = { edit: v.may.edit, why: v.may.editWhy, stage: v.report.stage_name }; }
    catch { reportMay[id] = { edit: false, why: "شما در گردش کار این گزارش نیستید." }; }
  }
  return {
    scope, scopeChoices: await filterChoices(db, { projectId }),
    reportMay,
    activity: { ...act, node_code: base.node_code, node_name: base.node_name, done: p.done, remain: p.remain, pct: p.pct, scopeLinked: !!scope,
      remainDays: act.plan_end ? Math.max(0, ea.diffDays(new Date().toISOString().slice(0, 10), act.plan_end)) : null,
      freeFloat: ea.freeFloat(act, succs) },
    workFront: ea.workFront(act, doneByDate),
    groups, predecessors, successors, roles, codes,
    reports: mine.map((l) => ({ ...l, areaName: area.get(l.areaId) || null })),
    files: files.map((f) => ({ ...f, report_date: iso(f.report_date) })),
    baseline: baseline ? { version: masterV.code, plan_start: baseline.act.plan_start, plan_end: baseline.act.plan_end, planDays: baseline.act.planDays } : null,
    delays: delays.map((d) => ea.delayRow({ ...d, accept_start: iso(d.accept_start), accept_finish: iso(d.accept_finish) }, act, baseline?.act || null)),
  };
}

// ── relations ────────────────────────────────────────────────────────────

/** A relation between two activities of one version; one that would close a loop is refused. */
export async function saveRelation(db, { projectId, id = null, predId, succId, relType = "FS", lag = 0, userId }) {
  if (!ea.REL_TYPES[relType]) throw bad("نوع رابطه FS، SS، FF یا SF است.");
  const l = Number(lag || 0);
  if (!Number.isInteger(l) || Math.abs(l) > 3650) throw bad("تأخیر (Lag) عدد صحیح روز است.");
  const a = await activityOf(db, projectId, predId), b = await activityOf(db, projectId, succId);
  if (a.version_id !== b.version_id) throw bad("رابطه فقط میان فعالیت‌های یک نسخه برقرار می‌شود.");
  if (predId === succId) throw bad("فعالیت پیش‌نیاز خودش نیست.");
  const rels = (await relationsOf(db, a.version_id)).filter((r) => r.id !== id);
  if (rels.some((r) => r.pred_id === predId && r.succ_id === succId)) throw bad(`رابطهٔ ${a.code} ← ${b.code} هست.`);
  if (ea.closesLoop(rels, predId, succId)) throw bad(`رابطهٔ ${a.code} ← ${b.code} حلقه می‌سازد: ${b.code} از پیش به ${a.code} می‌رسد.`);
  let r;
  if (id) ({ rows: [r] } = await db.query("UPDATE activity_relation SET pred_id = $2, succ_id = $3, rel_type = $4, lag = $5 WHERE id = $1 AND project_id = $6 RETURNING *", [id, predId, succId, relType, l, projectId]));
  else ({ rows: [r] } = await db.query("INSERT INTO activity_relation (project_id, pred_id, succ_id, rel_type, lag) VALUES ($1,$2,$3,$4,$5) RETURNING *", [projectId, predId, succId, relType, l]));
  if (!r) throw notFound("relation");
  await LOG(db, projectId, `رابطهٔ ${a.code} ← ${b.code}`, `${relType}${l ? ` با ${l} روز` : ""}`, userId);
  return r;
}

export async function removeRelation(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM activity_relation WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("relation");
}

// ── activity codes ───────────────────────────────────────────────────────

export async function codesOf(db, { projectId, contractId }) {
  const { rows } = await db.query(
    `SELECT c.*, (SELECT count(*)::int FROM wbs_activity_code x WHERE x.code_id = c.id) AS used
       FROM activity_code c WHERE c.project_id = $1 AND c.contract_id = $2 ORDER BY c.seq, c.code`, [projectId, contractId]);
  return rows;
}

/** An activity code of the contract: code, the activity type it names, categories A–H, unit, valid, remark. */
export async function saveCode(db, { projectId, contractId, id = null, code, name, categories = [], unit = null, valid = true, remark = null }) {
  const c = text(code);
  if (!c) throw bad("کد فعالیت (Activity Code) لازم است.");
  if (!text(name)) throw bad("نوع فعالیت (نام) لازم است.");
  const cats = (Array.isArray(categories) ? categories : []).slice(0, 8).map((x) => text(x) || "");
  while (cats.length && !cats[cats.length - 1]) cats.pop();
  const { rows: [dup] } = await db.query("SELECT 1 FROM activity_code WHERE contract_id = $1 AND code = $2 AND id IS DISTINCT FROM $3", [contractId, c, id]);
  if (dup) throw bad(`کد ${c} در این قرارداد هست.`);
  if (id) {
    const { rows: [r] } = await db.query(
      "UPDATE activity_code SET code = $3, name = $4, categories = $5, unit = $6, valid = $7, remark = $8 WHERE id = $1 AND contract_id = $2 RETURNING *",
      [id, contractId, c, text(name), cats, text(unit), valid !== false, text(remark)]);
    if (!r) throw notFound("code");
    return r;
  }
  const { rows: [m] } = await db.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM activity_code WHERE contract_id = $1", [contractId]);
  const { rows: [r] } = await db.query(
    "INSERT INTO activity_code (project_id, contract_id, code, name, categories, unit, valid, remark, seq) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    [projectId, contractId, c, text(name), cats, text(unit), valid !== false, text(remark), m.n]);
  return r;
}

export async function removeCode(db, { projectId, id }) {
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM wbs_activity_code WHERE code_id = $1", [id]);
  if (n) throw bad(`این کد به ${n} فعالیت داده شده؛ اول آن را از فعالیت‌ها بردارید.`);
  const { rowCount } = await db.query("DELETE FROM activity_code WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("code");
}

/** Give codes to activities (or take them away): the codes must be the activities' contract's. */
export async function assignCode(db, { projectId, activityIds = [], codeId, remove = false }) {
  const { rows: [c] } = await db.query("SELECT * FROM activity_code WHERE id = $1 AND project_id = $2", [codeId, projectId]);
  if (!c) throw notFound("code");
  if (!remove && !c.valid) throw bad(`کد ${c.code} معتبر نیست و به فعالیت داده نمی‌شود.`);
  let n = 0;
  for (const id of activityIds) {
    const a = await activityOf(db, projectId, id);
    if (a.contract_id !== c.contract_id) throw bad("کد فعالیت از قرارداد دیگری است.");
    const r = remove ? await db.query("DELETE FROM wbs_activity_code WHERE activity_id = $1 AND code_id = $2", [id, codeId])
      : await db.query("INSERT INTO wbs_activity_code (project_id, activity_id, code_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [projectId, id, codeId]);
    n += r.rowCount;
  }
  return { changed: n };
}

// ── roles ────────────────────────────────────────────────────────────────

/** A contract resource on an activity: units per day (or a lump quantity) and rate; the cost is worked out on read. */
export async function saveRole(db, { projectId, activityId, id = null, resourceId, budgetUnit = "hour", perDay = null, rate = null, actualTime = null, status = "planned", remark = null }) {
  const a = await activityOf(db, projectId, activityId);
  const { rows: [res] } = await db.query("SELECT contract_id FROM contract_resource WHERE id = $1 AND project_id = $2", [resourceId, projectId]);
  if (!res || res.contract_id !== a.contract_id) throw bad("نقش (منبع) را از منابع همین قرارداد انتخاب کنید.");
  if (!ea.BUDGET_UNITS[budgetUnit]) throw bad("واحد بودجه نامعتبر است.");
  if (!ea.ROLE_STATUS[status]) throw bad("وضعیت نامعتبر است.");
  const vals = [resourceId, budgetUnit, num(perDay, "مقدار در روز"), num(rate, "نرخ"), num(actualTime, "زمان واقعی"), status, text(remark)];
  const { rows: [dup] } = await db.query("SELECT 1 FROM activity_role WHERE activity_id = $1 AND resource_id = $2 AND id IS DISTINCT FROM $3", [activityId, resourceId, id]);
  if (dup) throw bad("این نقش روی این فعالیت هست؛ ردیف موجود را ویرایش کنید.");
  let r;
  if (id) ({ rows: [r] } = await db.query(
    "UPDATE activity_role SET resource_id = $3, budget_unit = $4, per_day = $5, rate = $6, actual_time = $7, status = $8, remark = $9 WHERE id = $1 AND activity_id = $2 RETURNING *",
    [id, activityId, ...vals]));
  else ({ rows: [r] } = await db.query(
    "INSERT INTO activity_role (project_id, activity_id, resource_id, budget_unit, per_day, rate, actual_time, status, remark) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    [projectId, activityId, ...vals]));
  if (!r) throw notFound("role");
  return r;
}

export async function removeRole(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM activity_role WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("role");
}

// ── delay claim ──────────────────────────────────────────────────────────

export async function saveDelay(db, { projectId, activityId, id = null, description, delayCode = null, acceptStart = null, acceptFinish = null, critical = false, remark = null, userId }) {
  await activityOf(db, projectId, activityId);
  if (!text(description)) throw bad("شرح ردیف لایحه لازم است.");
  const s = date(acceptStart, "شروع پذیرفته"), f = date(acceptFinish, "پایان پذیرفته");
  if (s && f && f < s) throw bad("پایان پذیرفته پیش از شروع پذیرفته است.");
  const vals = [text(description), text(delayCode), s, f, !!critical, text(remark)];
  if (id) {
    const { rows: [r] } = await db.query(
      "UPDATE activity_delay SET description = $3, delay_code = $4, accept_start = $5, accept_finish = $6, critical = $7, remark = $8 WHERE id = $1 AND activity_id = $2 RETURNING *",
      [id, activityId, ...vals]);
    if (!r) throw notFound("delay");
    return r;
  }
  const { rows: [m] } = await db.query("SELECT COALESCE(max(no), 0) + 1 AS n FROM activity_delay WHERE activity_id = $1", [activityId]);
  const { rows: [r] } = await db.query(
    `INSERT INTO activity_delay (project_id, activity_id, no, description, delay_code, accept_start, accept_finish, critical, remark, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [projectId, activityId, m.n, ...vals, userId]);
  return r;
}

export async function removeDelay(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM activity_delay WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("delay");
}

// ── progress: the daily report's «activities» section ────────────────────

/** The contract's daily reports of a day, with whether the user may write to each now. */
export async function reportsOn(db, { projectId, contractId, day, userId }) {
  const d = date(day, "روز");
  if (!d) throw bad("روز را انتخاب کنید.");
  const { rows } = await db.query(
    "SELECT id, report_no, title, status FROM report WHERE project_id = $1 AND contract_id = $2 AND report_date = $3 AND status <> 'cancelled' ORDER BY report_no", [projectId, contractId, d]);
  const out = [];
  for (const r of rows) {
    let may = { edit: false, editWhy: "شما در گردش کار این گزارش نیستید." }, stage = null;
    try { const v = await rp.reportView(db, { projectId, reportId: r.id, userId }); may = { edit: v.may.edit, editWhy: v.may.editWhy }; stage = v.report.stage_name; } catch { /* not in its workflow */ }
    out.push({ ...r, stage, may });
  }
  return out;
}

/**
 * Lines of work done, into a report — one per activity: the quantity as a
 * number, the remaining work or a percentage of the activity's volume. At the
 * report's first stage a line is written as the stage's base; at a later
 * stage, as that stage's own row. The whole set is refused if any one line
 * is (unknown volume, nothing left, past the volume).
 */
export async function addProgress(db, { projectId, reportId, activityIds = [], mode = "number", value = null, areaId = null, mark = null, notes = null, userId }) {
  activityIds = [...new Set(activityIds)];
  if (!activityIds.length) throw bad("فعالیتی انتخاب نشده است.");
  const s = await rp.snapshotOf(db, { projectId, reportId });
  if (!s.report.contract_id) throw notFound("contract report");
  const lines = await progressLines(db, { projectId, contractId: s.report.contract_id });
  const doneBy = sumBy(lines, "activityId");
  const firstSeq = Math.min(...s.snapshot.stages.map((x) => x.seq));
  const later = s.snapshot.stageSeq !== firstSeq;
  const content = structuredClone(s.content.schema === 2 ? s.content : cd.EMPTY);
  content.activities = content.activities || [];
  const problems = [];
  const byVersion = new Map();
  for (const id of activityIds) {
    const a = await activityOf(db, projectId, id);
    if (a.contract_id !== s.report.contract_id) { problems.push(`${a.code}: از قرارداد این گزارش نیست.`); continue; }
    if (a.scope_rule_id || (await db.query("SELECT 1 FROM scope_rule WHERE activity_id = $1", [id])).rows.length) {
      problems.push(`${a.code}: پیشرفت این فعالیت از داده‌های پلتفرم (محدودهٔ پیوندشده) خوانده می‌شود و در گزارش روزانه دوباره ثبت نمی‌شود.`); continue;
    }
    if (!byVersion.has(a.version_id)) byVersion.set(a.version_id, await versionActs(db, projectId, a.version_id));
    const c = byVersion.get(a.version_id).get(id);
    const q = ea.qtyFrom(mode, value, { volume: c.act.volumeActual, done: doneBy.get(id) || 0, code: a.code });
    if (q.problem) { problems.push(q.problem); continue; }
    const vals = { activityId: id, areaId: areaId || null, mark: text(mark), qty: q.qty, notes: text(notes) };
    const rid = `a${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    content.activities.push(later ? { id: rid, base: null, stages: { [s.snapshot.stageSeq]: vals }, addedAt: s.snapshot.stageSeq } : { id: rid, base: vals, stages: {} });
  }
  if (problems.length) throw bad(problems.join(" "));
  await editContractReport(db, { projectId, reportId, content, userId });
  return { added: activityIds.length };
}

/**
 * A work-done line changed or dropped, at the report's current stage: at the
 * first stage its base is rewritten (or the line deleted); later, the
 * stage's own values are written (or the line marked removed for the stage).
 */
export async function editProgress(db, { projectId, reportId, rowId, qty = undefined, areaId = undefined, mark = undefined, notes = undefined, remove = false, userId }) {
  const s = await rp.snapshotOf(db, { projectId, reportId });
  const content = structuredClone(s.content);
  const row = (content.activities || []).find((r) => r.id === rowId);
  if (!row) throw notFound("line");
  const firstSeq = Math.min(...s.snapshot.stages.map((x) => x.seq));
  const S = s.snapshot.stageSeq;
  const now = cd.effective(row);
  const next = { activityId: now.activityId, areaId: areaId === undefined ? now.areaId ?? null : areaId || null,
    mark: mark === undefined ? now.mark ?? null : text(mark), qty: qty === undefined ? now.qty : num(qty, "مقدار"), notes: notes === undefined ? now.notes ?? null : text(notes) };
  if (!remove) {
    const lines = (await progressLines(db, { projectId, contractId: s.report.contract_id })).filter((l) => l.activityId === now.activityId && !(l.reportId === reportId && l.rowId === rowId));
    const a = await activityOf(db, projectId, now.activityId);
    const c = await computedActivity(db, projectId, a.version_id, (x) => x.id === now.activityId);
    const q = ea.qtyFrom("number", next.qty, { volume: c.act.volumeActual, done: lines.reduce((t, l) => t + Number(l.qty || 0), 0), code: a.code });
    if (q.problem) throw bad(q.problem);
  }
  const ownRow = row.addedAt === S && !row.base && !Object.keys(row.stages || {}).some((k) => Number(k) !== S);
  if (S === firstSeq || ownRow) {
    if (remove) content.activities = content.activities.filter((r) => r.id !== rowId);
    else if (ownRow) row.stages = { [S]: next };
    else row.base = next;
  } else {
    row.stages = { ...(row.stages || {}), [S]: remove ? { ...next, removed: true } : next };
  }
  await editContractReport(db, { projectId, reportId, content, userId });
  return { ok: true };
}

/**
 * The days chosen, as columns: the version's activities that have work on any
 * of them, with the quantity of each day and the total; the days that have
 * any work, for the filter list.
 */
export async function daysView(db, { projectId, versionId, days = [] }) {
  const view = await activityView(db, { projectId, versionId });
  const lines = await progressLines(db, { projectId, contractId: view.version.contract_id });
  const chosen = days.map((d) => date(d, "روز")).filter(Boolean).sort();
  const m = ea.daysMatrix(lines, chosen);
  // the planned and done columns over the chosen days (owner's requirements 2026-10-18, item 6)
  const ids = new Set(); const walk = (n) => { n.activities.forEach((x) => ids.add(x.id)); n.children.forEach(walk); }; view.roots.forEach(walk);
  const period = ea.periodColumns(view.roots, lines.filter((l) => ids.has(l.activityId)), chosen);
  return { ...view, days: chosen, matrix: Object.fromEntries(m), period: Object.fromEntries(period), allDays: [...new Set(lines.map((l) => l.date))].sort() };
}

/** The progress lines of a version's activities, for the activity-code summary of the entry page. */
export async function versionLines(db, { projectId, versionId }) {
  const { rows: [v] } = await db.query("SELECT p.contract_id FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id WHERE v.id = $1 AND v.project_id = $2", [versionId, projectId]);
  if (!v) throw notFound("version");
  const { rows } = await db.query("SELECT a.id FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.version_id = $1", [versionId]);
  const ids = new Set(rows.map((r) => r.id));
  return (await progressLines(db, { projectId, contractId: v.contract_id })).filter((l) => ids.has(l.activityId));
}
