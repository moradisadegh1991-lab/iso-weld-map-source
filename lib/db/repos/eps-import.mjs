/**
 * A plan file into the contract's EPS as a PMS (lib/eps/import.mjs decides
 * what each row becomes): the file replaces what a PMS holds, or becomes a
 * new PMS of the contract — never a version (owner's request 2026-10-24).
 * A version is the planner's schedule of a PMS and is made on the EPS page.
 * Call inside `withProject`.
 */
import { randomUUID, createHash } from "node:crypto";
import { parseMspdi } from "../../controls/mspdi.mjs";
import { parsePmsRows } from "../../controls/pms.mjs";
import { fromSchedule, fromPms, fromSheet } from "../../eps/import.mjs";
import * as XLSX from "xlsx";
import * as eps from "./eps.mjs";
import { readPmsWorkbook } from "./pms.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });

async function insertMany(db, table, cols, rows, chunk = 150) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const vals = [];
    const tuples = part.map((r, k) => `(${cols.map((_, j) => `$${k * cols.length + j + 1}`).join(",")})`);
    for (const r of part) vals.push(...r);
    await db.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")}`, vals);
  }
}

/** Read a file into the plan shape: `kind` "mspdi" (MS Project XML), "pms" (the PMS workbook) or "sheet" (an EPS sheet). */
export function readPlanFile(kind, content) {
  if (kind === "mspdi") {
    const text = Buffer.isBuffer(content) ? content.toString("utf8") : String(content || "");
    const s = parseMspdi(text);
    if (!s.tasks.length) throw bad("برنامه هیچ فعالیتی ندارد.");
    return { ...fromSchedule(s), title: s.title, start: s.startDate, finish: s.finishDate, sha: createHash("sha256").update(text).digest("hex") };
  }
  if (kind === "pms") {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const { title, nodes } = parsePmsRows(readPmsWorkbook(buf).rows);
    if (!nodes.some((n) => n.kind === "step")) throw bad("در این فایل هیچ گام PMS (ستون کد CC) پیدا نشد.");
    return { ...fromPms(nodes), title, sha: createHash("sha256").update(buf).digest("hex") };
  }
  if (kind === "sheet") {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    const name = wb.SheetNames.find((n) => /^(wbs|eps)$/i.test(n.trim())) || wb.SheetNames[0];
    const plan = fromSheet(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }));
    if (!plan.nodes.length) throw bad(plan.problems.join(" ") || "در این فایل هیچ گرهٔ WBS پیدا نشد.");
    return { ...plan, title: null, sha: createHash("sha256").update(buf).digest("hex") };
  }
  throw bad("نوع فایل برنامه شناخته نشد (MS Project XML، اکسل PMS یا اکسل EPS).");
}

const day = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

/**
 * The file as a PMS: `mode` "replace" empties the PMS `pmsId` (its versions,
 * WBS and activities — eps.clearPms, refused whole while a daily report names
 * one of its activities) and writes the file into it; "new" makes PMS
 * `pmsCode` of the contract (its title the file's, unless one is given) and
 * writes the file into it. Either way in one transaction.
 */
export async function importPlan(db, { projectId, contractId = null, mode, pmsId = null, pmsCode = null, title = null, kind, sourceName, content, userId }) {
  const plan = readPlanFile(kind, content);
  const from = `ورود از ${sourceName} (${kind === "mspdi" ? "MS Project" : kind === "sheet" ? "EPS اکسل" : "PMS اکسل"}، sha256 ${plan.sha.slice(0, 12)})`;
  const go = async (tx) => {
    let pms;
    if (mode === "replace") {
      if (!pmsId) throw bad("PMSی را که فایل جایگزینش می‌شود انتخاب کنید.");
      await eps.clearPms(tx, { projectId, id: pmsId, userId });
      ({ rows: [pms] } = await tx.query("SELECT * FROM eps_pms WHERE id = $1 AND project_id = $2", [pmsId, projectId]));
    } else if (mode === "new") {
      if (!contractId) throw bad("قرارداد را انتخاب کنید.");
      pms = await eps.savePms(tx, { projectId, contractId, code: pmsCode, title: title || plan.title || sourceName, description: from,
        planStart: day(plan.start), planEnd: day(plan.finish), userId });
    } else throw bad("ورود فایل: جایگزینی یک PMS یا PMS تازه.");
    return { pms, ...(await writePlan(tx, { projectId, pmsId: pms.id, plan })) };
  };
  return db.inTransaction || !db.transaction ? go(db) : db.transaction(go);
}

/**
 * Write a read plan into a PMS's tree, or into a version: the tree takes the
 * plan's nodes and activities it does not have yet (matched by code — a
 * node by its code, an activity by its code on its node); with a version,
 * the version plans every activity of the file with the file's dates and
 * quantity (an activity the tree already had keeps its own figures; the
 * file's go into this version's plan).
 */
export async function writePlan(db, { projectId, pmsId = null, versionId = null, plan }) {
  const v = await eps.planOf(db, projectId, { pmsId, versionId });
  const P = v.pms_id;
  const { rows: haveNodes } = await db.query("SELECT id, code FROM wbs_node WHERE pms_id = $1", [P]);
  const nodeByCode = new Map(haveNodes.map((n) => [n.code, n.id]));
  const ids = new Map(plan.nodes.map((n) => [n.key, nodeByCode.get(n.code) || randomUUID()]));
  const ordered = [];
  const seen = new Set();
  const place = (n) => {                     // parents before children
    if (seen.has(n.key)) return;
    const p = n.parentKey ? plan.nodes.find((x) => x.key === n.parentKey) : null;
    if (p) place(p);
    seen.add(n.key); ordered.push(n);
  };
  plan.nodes.forEach(place);
  let newNodes = 0;
  for (const n of ordered) {
    if (nodeByCode.has(n.code)) continue;
    nodeByCode.set(n.code, ids.get(n.key));
    newNodes++;
    await insertMany(db, "wbs_node",
      ["id", "project_id", "pms_id", "parent_id", "code", "name", "seq", "wf", "plan_start", "plan_end", "actual_start", "actual_end", "unit", "volume_plan", "volume_actual"],
      [[ids.get(n.key), projectId, P, n.parentKey ? ids.get(n.parentKey) : null, n.code, n.name, n.seq ?? 1, n.wf ?? null,
        n.plan_start || null, n.plan_end || null, n.actual_start || null, n.actual_end || null, n.unit || null, n.volume ?? null, n.volume ?? null]]);
  }
  const { rows: haveActs } = await db.query("SELECT a.id, a.node_id, a.code FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE n.pms_id = $1", [P]);
  const actByKey = new Map(haveActs.map((a) => [`${a.node_id} ${a.code}`, a.id]));
  const aid = new Map();
  const fresh = [];
  for (const a of plan.activities) {
    const k = `${ids.get(a.nodeKey)} ${a.code}`;
    if (!actByKey.has(k)) { actByKey.set(k, randomUUID()); fresh.push(a); }
    aid.set(a.key, actByKey.get(k));
  }
  await insertMany(db, "wbs_activity",
    ["id", "project_id", "node_id", "code", "name", "seq", "wf", "progress", "plan_start", "plan_end", "actual_start", "actual_end", "volume_plan", "volume_actual"],
    fresh.map((a) => [aid.get(a.key), projectId, ids.get(a.nodeKey), a.code, a.name, a.seq ?? 1, a.wf ?? null, a.progress ?? null,
      a.plan_start || null, a.plan_end || null, a.actual_start || null, a.actual_end || null, a.volume ?? null, a.volume ?? null]));
  const planned = new Set();
  let seq = 0;
  for (const a of versionId ? plan.activities : []) {
    const id = aid.get(a.key);
    if (planned.has(id)) continue;
    planned.add(id);
    await db.query(
      `INSERT INTO activity_plan (project_id, version_id, activity_id, start_on, end_on, volume_plan, seq) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (version_id, activity_id) DO UPDATE SET start_on = EXCLUDED.start_on, end_on = EXCLUDED.end_on, volume_plan = EXCLUDED.volume_plan`,
      [projectId, versionId, id, a.plan_start || null, a.plan_end || null, a.volume ?? null, ++seq]);
  }
  const rels = plan.relations.filter((r) => r.predKey !== r.succKey && aid.get(r.predKey) !== aid.get(r.succKey));
  for (const r of rels) {
    await db.query("INSERT INTO activity_relation (project_id, pred_id, succ_id, rel_type, lag) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (pred_id, succ_id) DO NOTHING",
      [projectId, aid.get(r.predKey), aid.get(r.succKey), r.type, Math.max(-3650, Math.min(3650, r.lag))]);
  }
  const view = await eps.wbsView(db, { projectId, pmsId: v.pms_id });
  return { nodes: plan.nodes.length, activities: plan.activities.length, relations: rels.length, newNodes, newActivities: fresh.length, planned: planned.size,
    problems: [...plan.problems, ...(view.problems || [])] };
}

/**
 * A schedule or PMS imported before plans were EPS versions (062), carried
 * into a version from what was stored then — no file needed again.
 */
export async function convertLegacy(db, { projectId, pmsId, versionCode, source, importId, userId }) {
  let plan, label;
  if (source === "schedule") {
    const { rows: [imp] } = await db.query("SELECT * FROM schedule_import WHERE id = $1 AND project_id = $2", [importId, projectId]);
    if (!imp) throw bad("برنامهٔ واردشده پیدا نشد.");
    const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
    const { rows: tasks } = await db.query("SELECT * FROM schedule_task WHERE import_id = $1 ORDER BY task_no", [importId]);
    const { rows: links } = await db.query("SELECT * FROM schedule_link WHERE import_id = $1", [importId]);
    const fields = [...new Set(tasks.flatMap((t) => Object.keys(t.custom || {})))];
    plan = fromSchedule({ fields, tasks: tasks.map((t) => ({ uid: t.uid, level: t.level, outline: t.outline, wbs: t.wbs, summary: t.is_summary, name: t.name,
      parentUid: t.parent_uid, start: iso(t.start_date), finish: iso(t.finish_date), actStart: iso(t.act_start), actFinish: iso(t.act_finish),
      pct: t.pct == null ? null : Number(t.pct), custom: t.custom || {} })),
      links: links.map((l) => ({ predUid: l.pred_uid, succUid: l.succ_uid, type: l.link_type, lagDays: Number(l.lag_days) })) });
    plan.start = iso(imp.start_date); plan.finish = iso(imp.finish_date);
    label = `برنامهٔ ${imp.source_name}`;
  } else if (source === "pms") {
    const { rows: [imp] } = await db.query("SELECT * FROM pms_import WHERE id = $1 AND project_id = $2", [importId, projectId]);
    if (!imp) throw bad("PMS واردشده پیدا نشد.");
    const { rows } = await db.query("SELECT * FROM pms_node WHERE import_id = $1 ORDER BY seq", [importId]);
    const n = (v) => (v == null ? null : Number(v));
    plan = fromPms(rows.map((r) => ({ seq: r.seq, parent: r.parent_seq, kind: r.kind, level: r.level, row: r.row_no, name: r.name, code: r.code, unit: r.unit,
      stepWeight: n(r.step_weight), wf: n(r.wf), qty: n(r.qty), progress: n(r.progress) })));
    label = `PMS ${imp.source_name}`;
  } else throw bad("منبع تبدیل شناخته نشد.");
  const version = await eps.saveVersion(db, { projectId, pmsId, code: versionCode, title: label,
    description: `تبدیل‌شده از ورودی قبلی (${label})`, startOn: plan.start || null, endOn: plan.finish || null, userId });
  return { version, ...(await writePlan(db, { projectId, versionId: version.id, plan })) };
}

/** What was imported before plans were EPS versions, to be carried over. */
export async function legacyImports(db, { projectId }) {
  const { rows: schedules } = await db.query(
    "SELECT id, source_name, title, task_count, created_at FROM schedule_import WHERE project_id = $1 ORDER BY created_at DESC", [projectId]);
  const { rows: pms } = await db.query(
    "SELECT id, source_name, title, data_date, created_at FROM pms_import WHERE project_id = $1 ORDER BY created_at DESC", [projectId]);
  return { schedules, pms };
}

