/**
 * PMS ↔ the platform's records (migration 075; the rules are
 * lib/eps/scope.mjs). The items are read from where each discipline keeps
 * them, and their milestones judged by the same engines the discipline
 * pages use: the NDT compliance for welds, the precedence chains for
 * equipment, foundations and structures, the recorded steps for cables and
 * instruments. A new drawing, P&ID or register adds items; a withdrawn one
 * takes them away; the next read or apply carries that into the PMS.
 * Call inside `withProject`.
 */
import * as sc from "../../eps/scope.mjs";
import * as w from "../../eps/wbs.mjs";
import * as eps from "./eps.mjs";
import { createLoader } from "../loader.mjs";
import { tagStatus } from "./activities.mjs";
import { weldCompliance } from "./piping-hub.mjs";
import { STATUS } from "../../ndt/compliance.mjs";
import { stepDone } from "../../controls/progress.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (x) => Object.assign(new Error(`${x} not found`), { status: 404 });
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Every item of a discipline in the project, normalised. `cache` (a Map) keeps one load per request. */
export async function platformItems(db, { projectId, discipline, cache = null }) {
  if (cache?.has(discipline)) return cache.get(discipline);
  const p = load(db, projectId, discipline);
  cache?.set(discipline, p);
  return p;
}

async function load(db, projectId, discipline) {
  const { rows: subs } = await db.query("SELECT id, code, unit_id FROM subsystem WHERE project_id = $1", [projectId]);
  const sub = new Map(subs.map((s) => [s.id, s]));
  const base = (key, label, subsystemId, extra = {}) => ({
    key, discipline, label, subsystemId: subsystemId || null, subsystemCode: sub.get(subsystemId)?.code || null,
    unitId: extra.unitId ?? sub.get(subsystemId)?.unit_id ?? null, ...extra });
  if (discipline === "piping") {
    const welds = await weldCompliance(db, { projectId });
    const { rows: meta } = await db.query(
      `SELECT f.weld_uid, d.doc_no, l.unit_id FROM reporting.fact_weld f LEFT JOIN document d ON d.id = f.document_key
         LEFT JOIN line l ON l.id = f.line_key WHERE f.project_key = $1`, [projectId]);
    const m = new Map(meta.map((r) => [String(r.weld_uid), r]));
    return welds.map((x) => base(`weld:${x.weld_uid}`, `${x.line_no || "?"} / ${x.weld_no}`, x.subsystem_id, {
      name: x.spool_no ? `اسپول ${x.spool_no}` : null, unitId: m.get(String(x.weld_uid))?.unit_id || undefined, docNo: m.get(String(x.weld_uid))?.doc_no || null,
      kind: x.shop_field || null, group: x.line_no || null,
      measures: { count: 1, dia_inch: Number(x.nps) > 0 ? Number(x.nps) : null },
      done: { welded: !!x.is_welded, ndt: !!x.is_welded && !!STATUS[x.ndt?.status]?.done } }));
  }
  if (discipline === "electrical") {
    const { rows } = await db.query("SELECT cable_key, cable_no, subsystem_key, voltage_class, length_m, from_ref, to_ref, is_pulled, is_ready FROM reporting.fact_cable WHERE project_key = $1", [projectId]);
    return rows.map((r) => base(`cable:${r.cable_key}`, r.cable_no, r.subsystem_key, { name: [r.from_ref, r.to_ref].filter(Boolean).join(" → ") || null,
      kind: r.voltage_class || null, measures: { count: 1, length_m: num(r.length_m) }, done: { pulled: r.is_pulled || r.is_ready, ready: r.is_ready } }));
  }
  if (discipline === "instrumentation") {
    const { rows } = await db.query(
      `SELECT f.instrument_key, f.tag_no, f.subsystem_key, f.category, f.is_installed, f.is_ready, i.service
         FROM reporting.fact_instrument f JOIN instrument i ON i.id = f.instrument_key WHERE f.project_key = $1`, [projectId]);
    return rows.map((r) => base(`instrument:${r.instrument_key}`, r.tag_no, r.subsystem_key, { name: r.service || null, kind: r.category || null,
      measures: { count: 1 }, done: { installed: r.is_installed || r.is_ready, ready: r.is_ready } }));
  }
  // equipment, foundations and structures are tags, judged by their precedence chains
  const kind = { equipment: null, civil: "foundation", structural: "structure" }[discipline];
  const { rows } = await db.query(
    `SELECT t.id, t.tag_no, t.kind, t.description, t.subsystem_id, fs.volume_m3, fs.drawing_ref FROM tag t
       LEFT JOIN foundation_spec fs ON fs.tag_id = t.id
      WHERE t.project_id = $1 AND ${discipline === "equipment" ? "t.discipline = 'equipment'" : "t.kind = $2"} ORDER BY t.tag_no`,
    discipline === "equipment" ? [projectId] : [projectId, kind]);
  const L = createLoader(db, projectId);
  await L.prime(rows.map((r) => r.id));
  const out = [];
  for (const r of rows) {
    const s = await tagStatus(db, { projectId, tagId: r.id, loader: L });
    const steps = s.steps || [];
    const codes = Object.keys(sc.DISCIPLINES[discipline].milestones);
    // "ready" certifies everything before it: a tag ready is done at every milestone
    const ready = stepDone(steps, "ready");
    const done = Object.fromEntries(codes.map((c) => [c, ready || stepDone(steps, c)]));
    out.push(base(`tag:${r.id}`, r.tag_no, r.subsystem_id, { name: r.description || null, kind: r.kind || null, docNo: r.drawing_ref || null,
      measures: { count: 1, volume_m3: num(r.volume_m3) }, done }));
  }
  return out;
}

// ── rules ────────────────────────────────────────────────────────────────

/** The PMS whose tree a call names, by the PMS or by one of its versions. */
async function pmsOf(db, projectId, { pmsId = null, versionId = null }) {
  if (pmsId) return pmsId;
  const { rows: [v] } = await db.query("SELECT pms_id FROM eps_version WHERE id = $1 AND project_id = $2", [versionId, projectId]);
  if (!v) throw notFound("version");
  return v.pms_id;
}

/** A rule on an activity (aggregate) or on a WBS node (per_item). One per activity, one per node. */
export async function saveRule(db, { projectId, id = null, activityId = null, nodeId = null, userId, ...input }) {
  const { rule, problems } = sc.checkRule({ ...input, mode: nodeId ? "per_item" : input.mode === "per_item" && !activityId ? "per_item" : "aggregate" });
  if (problems.length) throw bad(problems.join(" "));
  let pmsId;
  if (rule.mode === "aggregate") {
    const { rows: [a] } = await db.query("SELECT a.*, n.pms_id FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE a.id = $1 AND a.project_id = $2", [activityId, projectId]);
    if (!a) throw notFound("activity");
    if (a.scope_rule_id) throw bad("این فعالیت را قاعدهٔ گره ساخته است؛ محدوده‌اش همان قلمِ خودش است.");
    pmsId = a.pms_id;
  } else {
    const { rows: [n] } = await db.query("SELECT * FROM wbs_node WHERE id = $1 AND project_id = $2", [nodeId, projectId]);
    if (!n) throw notFound("node");
    pmsId = n.pms_id;
  }
  const { rows: [have] } = await db.query("SELECT * FROM scope_rule WHERE (activity_id = $1 OR node_id = $2) AND project_id = $3", [activityId, nodeId, projectId]);
  if (have && have.id !== id) id = have.id;
  const vals = [rule.discipline, rule.filter, rule.measure, rule.milestone, rule.auto_apply];
  let r;
  if (id) {
    ({ rows: [r] } = await db.query(
      "UPDATE scope_rule SET discipline = $3, filter = $4, measure = $5, milestone = $6, auto_apply = $7 WHERE id = $1 AND project_id = $2 RETURNING *", [id, projectId, ...vals]));
    if (!r) throw notFound("rule");
  } else {
    ({ rows: [r] } = await db.query(
      `INSERT INTO scope_rule (project_id, pms_id, mode, activity_id, node_id, discipline, filter, measure, milestone, auto_apply, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [projectId, pmsId, rule.mode, rule.mode === "aggregate" ? activityId : null, rule.mode === "per_item" ? nodeId : null, ...vals, userId]));
  }
  await logEvent(db, { projectId, section: "controls", entityType: "eps", entityId: null, label: "محدودهٔ پلتفرم",
    action: "updated", comment: `${sc.DISCIPLINES[rule.discipline].title} · ${sc.MODES[rule.mode]}`, userId });
  return r;
}

/** A rule removed. Activities it made stay as activities by hand (their rule link is cleared by the database). */
export async function removeRule(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM scope_rule WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw notFound("rule");
}

/** A rule as it stands now: its items, in groups, summed, and what changed since it was last applied. */
export async function ruleState(db, { projectId, rule, cache = new Map() }) {
  const all = await platformItems(db, { projectId, discipline: rule.discipline, cache });
  const items = sc.itemsOf(rule, all);
  const gs = sc.groups(items, rule);
  const units = rule.mode === "per_item" ? gs.map((g) => ({ key: g.key, label: g.label, qty: g.unknown ? null : g.qty }))
    : items.map((i) => ({ key: i.key, label: i.label, qty: i.measures?.[rule.measure] ?? null }));
  const { rows: seen } = await db.query("SELECT item_key AS key, label, qty FROM scope_item_seen WHERE rule_id = $1", [rule.id]);
  const pending = sc.diff(seen.map((s) => ({ ...s, qty: num(s.qty) })), units);
  return { rule, items, groups: gs, summary: sc.summarize(items, rule), pending, firstApply: !rule.applied_at };
}

/**
 * Apply a rule: what it holds now becomes what it last saw, and the change is
 * recorded. For a per-item rule the node's activities follow its groups —
 * one made for each new group, weighted by its share; one whose group left
 * deleted, or kept at W.F 0 and marked when work, relations, roles, codes or
 * delay lines hang on it. Refused whole if the node's activities would weigh
 * more than 100%.
 */
export async function applyRule(db, { projectId, ruleId, userId, auto = false, cache = new Map() }) {
  const { rows: [rule] } = await db.query("SELECT * FROM scope_rule WHERE id = $1 AND project_id = $2", [ruleId, projectId]);
  if (!rule) throw notFound("rule");
  const st = await ruleState(db, { projectId, rule, cache });
  let made = 0, dropped = 0, kept = 0;
  if (rule.mode === "per_item") {
    const { rows: [node] } = await db.query("SELECT * FROM wbs_node WHERE id = $1", [rule.node_id]);
    const settings = await eps.planSettings(db, { projectId, pmsId: rule.pms_id });
    const { rows: acts } = await db.query("SELECT * FROM wbs_activity WHERE node_id = $1", [node.id]);
    const mine = acts.filter((a) => a.scope_rule_id === rule.id);
    const byKey = new Map(mine.map((a) => [a.scope_item, a]));
    const wts = sc.weights(st.groups);
    const wf = new Map(st.groups.map((g, i) => [g.key, wts[i]]));
    const leaving = mine.filter((a) => !st.groups.some((g) => g.key === a.scope_item) && !a.scope_removed);
    const hanging = new Set();
    if (leaving.length) {
      const ids = leaving.map((a) => a.id);
      const { rows } = await db.query(
        `SELECT pred_id AS id FROM activity_relation WHERE pred_id = ANY($1) UNION SELECT succ_id FROM activity_relation WHERE succ_id = ANY($1)
         UNION SELECT activity_id FROM activity_role WHERE activity_id = ANY($1) UNION SELECT activity_id FROM activity_delay WHERE activity_id = ANY($1)
         UNION SELECT activity_id FROM wbs_activity_code WHERE activity_id = ANY($1)`, [ids]);
      rows.forEach((r) => hanging.add(r.id));
      // a line of work done in a daily report hangs on it too
      const { rows: rep } = await db.query(
        `SELECT DISTINCT jsonb_path_query(c.content, 'lax $.activities[*].**.activityId') #>> '{}' AS a
           FROM report r, LATERAL (SELECT content FROM report_version v WHERE v.report_id = r.id ORDER BY version_no DESC LIMIT 1) c
          WHERE r.project_id = $1 AND r.status <> 'cancelled'`, [projectId]);
      rep.forEach((r) => r.a && hanging.add(r.a));
    }
    const used = new Set([...acts.map((a) => a.code), ...(await eps.childCodes(db, node.id))]);
    let k = 1;
    const nextCode = () => { while (used.has(w.activityCode(node.code, k, settings.separator))) k++; const c = w.activityCode(node.code, k, settings.separator); used.add(c); return c; };
    const plan = {
      add: st.groups.filter((g) => !byKey.has(g.key)).map((g) => ({ id: `scope-${g.key}`, node_id: node.id, code: nextCode(), name: g.name ? `${g.label} — ${g.name}` : g.label, wf: wf.get(g.key), seq: 1e6 + k, g })),
      update: mine.filter((a) => wf.has(a.scope_item)).map((a) => ({ id: a.id, wf: wf.get(a.scope_item), back: a.scope_removed })),
      drop: leaving.filter((a) => !hanging.has(a.id)).map((a) => a.id),
      keep: leaving.filter((a) => hanging.has(a.id)).map((a) => a.id),
    };
    await eps.guardPlan(db, { projectId, pmsId: rule.pms_id, change: ({ nodes, acts: aa }) => ({ nodes,
      acts: [...aa.filter((a) => !plan.drop.includes(a.id)).map((a) => {
        const u = plan.update.find((x) => x.id === a.id);
        return u ? { ...a, wf: u.wf } : plan.keep.includes(a.id) ? { ...a, wf: 0 } : a;
      }), ...plan.add] }) });
    for (const a of plan.add) {
      await db.query(
        `INSERT INTO wbs_activity (project_id, node_id, code, name, wf, seq, scope_rule_id, scope_item, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [projectId, node.id, a.code, a.name.slice(0, 300), a.wf, Math.max(0, ...acts.map((x) => x.seq)) + made + 1, rule.id, a.g.key, `از ${sc.DISCIPLINES[rule.discipline].title}`]);
      made++;
    }
    for (const u of plan.update) await db.query("UPDATE wbs_activity SET wf = $2, scope_removed = false WHERE id = $1", [u.id, u.wf]);
    if (plan.drop.length) await db.query("DELETE FROM wbs_activity WHERE id = ANY($1)", [plan.drop]);
    if (plan.keep.length) await db.query("UPDATE wbs_activity SET wf = 0, scope_removed = true WHERE id = ANY($1)", [plan.keep]);
    dropped = plan.drop.length; kept = plan.keep.length;
  }
  const units = rule.mode === "per_item" ? st.groups.map((g) => ({ key: g.key, label: g.label, qty: g.unknown ? null : g.qty }))
    : st.items.map((i) => ({ key: i.key, label: i.label, qty: i.measures?.[rule.measure] ?? null }));
  await db.query("DELETE FROM scope_item_seen WHERE rule_id = $1", [rule.id]);
  for (const u of units) {
    await db.query("INSERT INTO scope_item_seen (project_id, rule_id, item_key, label, qty) VALUES ($1,$2,$3,$4,$5)", [projectId, rule.id, u.key, u.label, u.qty]);
  }
  if (st.pending.any || !rule.applied_at) {
    await db.query("INSERT INTO scope_change (project_id, rule_id, added, removed, changed, auto, by_user) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [projectId, rule.id, JSON.stringify(st.pending.added), JSON.stringify(st.pending.removed), JSON.stringify(st.pending.changed), auto, userId]);
  }
  await db.query("UPDATE scope_rule SET applied_at = clock_timestamp(), applied_by = $2 WHERE id = $1", [rule.id, userId]);
  return { added: st.pending.added.length, removed: st.pending.removed.length, changed: st.pending.changed.length, made, dropped, kept };
}

/** Every rule of a PMS's tree (named by a version too) with its state; and, per activity, the volume and done the platform gives it. */
export async function versionScope(db, { projectId, pmsId = null, versionId = null, cache = new Map() }) {
  const P = await pmsOf(db, projectId, { pmsId, versionId });
  const { rows: rules } = await db.query("SELECT * FROM scope_rule WHERE pms_id = $1 AND project_id = $2 ORDER BY created_at", [P, projectId]);
  const states = [];
  for (const r of rules) states.push(await ruleState(db, { projectId, rule: r, cache }));
  const byActivity = new Map();
  for (const s of states) {
    if (s.rule.mode === "aggregate") byActivity.set(s.rule.activity_id, { ...s.summary, ruleId: s.rule.id, discipline: s.rule.discipline, measure: s.rule.measure, milestone: s.rule.milestone });
  }
  const { rows: made } = await db.query(
    "SELECT a.id, a.scope_rule_id, a.scope_item FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1 AND a.scope_rule_id IS NOT NULL", [P]);
  for (const a of made) {
    const s = states.find((x) => x.rule.id === a.scope_rule_id);
    const g = s?.groups.find((x) => x.key === a.scope_item);
    byActivity.set(a.id, g ? { items: g.items, doneCount: g.doneCount, qty: g.qty, done: g.done, unknown: g.unknown, pct: g.pct, ruleId: s.rule.id,
      discipline: s.rule.discipline, measure: s.rule.measure, milestone: s.rule.milestone, item: g.label }
      : { items: 0, qty: 0, done: 0, unknown: 0, pct: null, ruleId: a.scope_rule_id, removed: true });
  }
  return { states, byActivity };
}

/** Apply every rule of a PMS's tree that applies itself and has something to apply. */
export async function autoApply(db, { projectId, pmsId = null, versionId = null, userId, cache = new Map() }) {
  const { states } = await versionScope(db, { projectId, pmsId, versionId, cache });
  const done = [];
  for (const s of states) {
    if (!s.rule.auto_apply || !(s.pending.any || s.firstApply)) continue;
    try { done.push({ ruleId: s.rule.id, ...(await applyRule(db, { projectId, ruleId: s.rule.id, userId, auto: true, cache })) }); }
    catch (e) { done.push({ ruleId: s.rule.id, error: e.message }); }
  }
  return done;
}

/** The changes recorded for a rule, newest first. */
export async function ruleHistory(db, { projectId, ruleId }) {
  const { rows } = await db.query(
    `SELECT c.*, u.display_name AS by_name FROM scope_change c LEFT JOIN app_user u ON u.id = c.by_user
      WHERE c.rule_id = $1 AND c.project_id = $2 ORDER BY c.at DESC LIMIT 50`, [ruleId, projectId]);
  return rows;
}

/**
 * Scope the PMS does not hold: for each discipline, the platform's items no
 * rule of the PMS takes in — what a new drawing, P&ID or register brought
 * that no activity covers yet.
 */
export async function unplanned(db, { projectId, pmsId = null, versionId = null, cache = new Map() }) {
  const P = await pmsOf(db, projectId, { pmsId, versionId });
  const { rows: rules } = await db.query("SELECT * FROM scope_rule WHERE pms_id = $1 AND project_id = $2", [P, projectId]);
  const out = {};
  for (const d of Object.keys(sc.DISCIPLINES)) {
    const all = await platformItems(db, { projectId, discipline: d, cache });
    const mine = rules.filter((r) => r.discipline === d);
    const left = all.filter((i) => !mine.some((r) => sc.matches(i, r.filter)));
    out[d] = { total: all.length, covered: all.length - left.length, items: left.slice(0, 300).map((i) => ({ key: i.key, label: i.label, name: i.name, subsystem: i.subsystemCode, kind: i.kind, group: i.group })), more: Math.max(0, left.length - 300) };
  }
  return out;
}

/** What a filter can be built from: the project's subsystems and units. */
export async function filterChoices(db, { projectId }) {
  const { rows: subsystems } = await db.query("SELECT id, code, name FROM subsystem WHERE project_id = $1 ORDER BY code", [projectId]);
  const { rows: units } = await db.query("SELECT id, code, name FROM unit WHERE project_id = $1 ORDER BY code", [projectId]);
  return { subsystems, units };
}
