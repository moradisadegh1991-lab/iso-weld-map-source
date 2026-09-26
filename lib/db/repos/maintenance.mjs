/**
 * Handover to maintenance, phase 2: the maintenance plan, spare parts and
 * periodic calibration. Every rule is lib/cmms/maintenance.mjs; this reads
 * and writes. Call inside `withProject`.
 */
import { createHash } from "node:crypto";
import {
  STRATEGIES, UNITS, SOURCES, CRAFTS, SPARE_CATEGORIES, taskProblems, intervalText, spareProblems,
  interchangeability, spareCover, calibrationDue,
} from "../../cmms/maintenance.mjs";
import { flocFor, toCsv } from "../../cmms/handover.mjs";
import { calibrationRequirement, judgeCalibration, CALIBRATED_HERE } from "../../instrumentation/isa.mjs";
import { stock } from "./warehouse.mjs";

// ── the maintenance plan ─────────────────────────────────────────────────

/**
 * Write a task. A new code starts at revision 0; changing a code whose
 * revision is approved opens the next revision as a draft (the approved one
 * stays in force until the new one is approved); a draft is edited in place.
 */
export async function savePmTask(db, { projectId, tagId, taskCode, title, strategy, intervalValue = null, intervalUnit = null,
  craft = null, durationH = null, source, sourceRef, notes = null, userId = null }) {
  await equipmentTag(db, projectId, tagId);
  const t = { taskCode: clean(taskCode)?.toUpperCase(), title: clean(title), strategy, craft: clean(craft), source, sourceRef: clean(sourceRef),
    intervalValue: strategy === "run_to_failure" ? null : blankNum(intervalValue),
    intervalUnit: strategy === "run_to_failure" ? null : clean(intervalUnit), durationH: blankNum(durationH), notes: clean(notes) };
  const problems = taskProblems(t);
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: revs } = await db.query(
    "SELECT * FROM pm_task WHERE project_id = $1 AND tag_id = $2 AND task_code = $3 ORDER BY revision DESC", [projectId, tagId, t.taskCode]);
  const vals = [t.title, t.strategy, t.intervalValue, t.intervalUnit, t.craft, t.durationH, t.source, t.sourceRef, t.notes];
  const draft = revs.find((r) => r.status === "draft");
  if (draft) {
    const { rows: [row] } = await db.query(
      `UPDATE pm_task SET title=$1, strategy=$2, interval_value=$3, interval_unit=$4, craft=$5, duration_h=$6, source=$7, source_ref=$8,
              notes=$9, prepared_by=$10 WHERE id = $11 RETURNING *`, [...vals, userId, draft.id]);
    return row;
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO pm_task (title, strategy, interval_value, interval_unit, craft, duration_h, source, source_ref, notes,
                          prepared_by, project_id, tag_id, task_code, revision)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [...vals, userId, projectId, tagId, t.taskCode, revs.length ? revs[0].revision + 1 : 0]);
  return row;
}

/** Approve a draft; the revision in force before it is superseded in the same transaction. */
export async function approvePmTask(db, { projectId, taskId, userId }) {
  const t = await taskRow(db, projectId, taskId);
  if (t.status !== "draft") throw bad("فقط پیش‌نویس تأیید می‌شود.");
  if (t.prepared_by && t.prepared_by === userId) throw bad("تهیه‌کنندهٔ تسک آن را تأیید نمی‌کند؛ نفر دوم تأیید می‌کند.");
  await db.query(`UPDATE pm_task SET status = 'superseded', superseded_at = clock_timestamp()
                   WHERE project_id = $1 AND tag_id = $2 AND task_code = $3 AND status = 'approved'`, [projectId, t.tag_id, t.task_code]);
  const { rows: [row] } = await db.query(
    "UPDATE pm_task SET status = 'approved', approved_by = $2, approved_at = clock_timestamp() WHERE id = $1 RETURNING *", [taskId, userId]);
  return row;
}

/** Throw a draft away. An approved or superseded revision is kept. */
export async function discardPmDraft(db, { projectId, taskId }) {
  const t = await taskRow(db, projectId, taskId);
  if (t.status !== "draft") throw bad("فقط پیش‌نویس حذف می‌شود؛ نسخهٔ تأییدشده سابقه است و می‌ماند.");
  await db.query("DELETE FROM pm_task WHERE id = $1", [taskId]);
  return { removed: true };
}

/** Every task of the project, grouped by the latest state of each code. */
export async function pmPlan(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT p.*, t.tag_no, t.description AS tag_description, pu.display_name AS prepared_by_name, au.display_name AS approved_by_name
       FROM pm_task p JOIN tag t ON t.id = p.tag_id
       LEFT JOIN app_user pu ON pu.id = p.prepared_by LEFT JOIN app_user au ON au.id = p.approved_by
      WHERE p.project_id = $1 ORDER BY t.tag_no, p.task_code, p.revision DESC`, [projectId]);
  return rows.map(taskOut);
}

// ── spare parts ──────────────────────────────────────────────────────────

export async function saveSpare(db, { projectId, tagId, partNo, manufacturer = null, description, category, uom = "EA",
  qtyInstalled = null, qtyRecommended = null, qtyApproved = null, itemId = null, spirRef = null, userId = null }) {
  await equipmentTag(db, projectId, tagId);
  const s = { partNo: clean(partNo), manufacturer: clean(manufacturer), description: clean(description), category, uom: clean(uom) || "EA",
    qtyInstalled: blankNum(qtyInstalled), qtyRecommended: blankNum(qtyRecommended), qtyApproved: blankNum(qtyApproved),
    itemId: itemId || null, spirRef: clean(spirRef) };
  const problems = spareProblems(s);
  if (problems.length) throw bad(problems.join(" · "));
  if (s.itemId) {
    const { rows: [i] } = await db.query("SELECT uom FROM material_item WHERE id = $1 AND project_id = $2", [s.itemId, projectId]);
    if (!i) throw notFound("material item");
    if (i.uom !== s.uom) throw bad(`واحد قطعه (${s.uom}) با واحد کالای انبار (${i.uom}) یکی نیست؛ تبدیل بی‌صدا انجام نمی‌شود.`);
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO spare_part (project_id, tag_id, part_no, manufacturer, description, category, uom, qty_installed, qty_recommended,
                             qty_approved, item_id, spir_ref, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (project_id, tag_id, part_no, category) DO UPDATE SET manufacturer = EXCLUDED.manufacturer,
        description = EXCLUDED.description, uom = EXCLUDED.uom, qty_installed = EXCLUDED.qty_installed,
        qty_recommended = EXCLUDED.qty_recommended, qty_approved = EXCLUDED.qty_approved, item_id = EXCLUDED.item_id,
        spir_ref = EXCLUDED.spir_ref, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [projectId, tagId, s.partNo, s.manufacturer, s.description, s.category, s.uom, s.qtyInstalled, s.qtyRecommended, s.qtyApproved,
     s.itemId, s.spirRef, userId]);
  await db.query("INSERT INTO spare_part_revision (project_id, tag_id, part_no, action, snapshot, by_user) VALUES ($1,$2,$3,'saved',$4,$5)",
    [projectId, tagId, s.partNo, JSON.stringify(s), userId]);
  return row;
}

export async function removeSpare(db, { projectId, spareId, userId = null }) {
  const { rows: [s] } = await db.query("SELECT * FROM spare_part WHERE id = $1 AND project_id = $2", [spareId, projectId]);
  if (!s) throw notFound("spare part");
  await db.query("DELETE FROM spare_part WHERE id = $1", [spareId]);
  await db.query("INSERT INTO spare_part_revision (project_id, tag_id, part_no, action, snapshot, by_user) VALUES ($1,$2,$3,'removed',$4,$5)",
    [projectId, s.tag_id, s.part_no, JSON.stringify(s), userId]);
  return { removed: true };
}

/** Every SPIR line with what stock covers of it, and the interchangeability across tags. */
export async function sparesBoard(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT s.*, t.tag_no, i.code AS item_code FROM spare_part s JOIN tag t ON t.id = s.tag_id
       LEFT JOIN material_item i ON i.id = s.item_id WHERE s.project_id = $1 ORDER BY t.tag_no, s.category, s.part_no`, [projectId]);
  // Issuable balance per warehouse item: accepted, MTC in order, less what went out.
  const onHand = {};
  for (const l of await stock(db, { projectId })) if (l.issuable) onHand[l.itemId] = (onHand[l.itemId] || 0) + l.onHand;
  // One seal on the shelf covers one line, not every line that names it: stock
  // is handed out across the lines of an item — commissioning first (it is
  // consumed before handover), then operational, then capital; by tag within.
  const left = { ...onHand };
  const allotted = {};
  for (const s of [...rows].filter((r) => r.item_id && r.qty_approved !== null)
    .sort((a, b) => ALLOT[a.category] - ALLOT[b.category] || a.tag_no.localeCompare(b.tag_no))) {
    const take = Math.min(Number(s.qty_approved), left[s.item_id] || 0);
    allotted[s.id] = take;
    left[s.item_id] = (left[s.item_id] || 0) - take;
  }
  const parts = rows.map((s) => ({
    id: s.id, tagId: s.tag_id, tagNo: s.tag_no, partNo: s.part_no, manufacturer: s.manufacturer, description: s.description,
    category: s.category, uom: s.uom, qtyInstalled: n(s.qty_installed), qtyRecommended: n(s.qty_recommended), qtyApproved: n(s.qty_approved),
    itemId: s.item_id, itemCode: s.item_code, spirRef: s.spir_ref,
    cover: spareCover({ qtyApproved: s.qty_approved, itemLinked: !!s.item_id, onHand: allotted[s.id] ?? 0 }),
  }));
  return { parts, interchangeable: interchangeability(parts) };
}

// ── periodic calibration ─────────────────────────────────────────────────

export async function setCalibrationPlan(db, { projectId, instrumentId, intervalMonths, source, sourceRef, userId = null }) {
  const { rows: [i] } = await db.query("SELECT id FROM instrument WHERE id = $1 AND project_id = $2", [instrumentId, projectId]);
  if (!i) throw notFound("instrument");
  const m = Number(intervalMonths);
  if (!(Number.isInteger(m) && m >= 1 && m <= 120)) throw bad("بازهٔ کالیبراسیون باید عدد صحیح ۱ تا ۱۲۰ ماه باشد.");
  if (!SOURCES[source]) throw bad("منبع بازه لازم است: دستورالعمل سازنده، RCM، الزام قانونی یا استاندارد شرکت.");
  if (!clean(sourceRef)) throw bad("مرجع منبع لازم است — پلتفرم بازهٔ کالیبراسیون پیشنهاد نمی‌دهد.");
  const plan = { intervalMonths: m, source, sourceRef: clean(sourceRef) };
  const { rows: [row] } = await db.query(
    `INSERT INTO calibration_plan (instrument_id, project_id, interval_months, source, source_ref, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (instrument_id) DO UPDATE SET interval_months = EXCLUDED.interval_months, source = EXCLUDED.source,
        source_ref = EXCLUDED.source_ref, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *`,
    [instrumentId, projectId, m, plan.source, plan.sourceRef, userId]);
  await db.query("INSERT INTO calibration_plan_revision (project_id, instrument_id, snapshot, by_user) VALUES ($1,$2,$3,$4)",
    [projectId, instrumentId, JSON.stringify(plan), userId]);
  return row;
}

/**
 * Every instrument with its plan and when it is next due. The last PASSING
 * calibration is judged as the instrumentation module judges it: points
 * against the tolerance for transmitters and gauges; for valves, switches
 * and elements, the technician's signed calibration step.
 */
export async function calibrationBoard(db, { projectId, today = new Date().toISOString().slice(0, 10), soonDays = 30 }) {
  const { rows: insts } = await db.query(
    `SELECT i.*, s.code AS subsystem, t.tag_no AS eq_tag_no, p.interval_months, p.source, p.source_ref
       FROM instrument i LEFT JOIN subsystem s ON s.id = i.subsystem_id LEFT JOIN tag t ON t.id = i.eq_tag_id
       LEFT JOIN calibration_plan p ON p.instrument_id = i.id WHERE i.project_id = $1 ORDER BY i.tag_no`, [projectId]);
  const { rows: cals } = await db.query(
    "SELECT instrument_id, points, calibrated_on FROM calibration WHERE project_id = $1 ORDER BY calibrated_on, created_at", [projectId]);
  const { rows: signed } = await db.query(
    "SELECT instrument_id, done_at FROM instrument_activity WHERE project_id = $1 AND code = 'calibrated' AND status = 'done'", [projectId]);
  const { rows: [pj] } = await db.query("SELECT calibration_tolerance_pct FROM project WHERE id = $1", [projectId]);
  const tol = pj?.calibration_tolerance_pct == null ? null : Number(pj.calibration_tolerance_pct);
  return insts.map((i) => {
    let lastPass = null, lastFailed = false;
    if (CALIBRATED_HERE.has(i.category)) {
      const req = calibrationRequirement({ category: i.category, rangeLo: i.range_lo, rangeHi: i.range_hi, tolerancePct: i.tolerance_pct }, { tolerancePct: tol });
      const mine = cals.filter((c) => c.instrument_id === i.id).map((c) => ({ on: day(c.calibrated_on), v: judgeCalibration(c.points, req) }));
      const passes = mine.filter((c) => c.v.valid && c.v.ok);
      lastPass = passes.length ? passes[passes.length - 1].on : null;
      const latest = mine[mine.length - 1];
      lastFailed = !!latest && latest.v.valid && !latest.v.ok;
    } else {
      const s = signed.find((x) => x.instrument_id === i.id);
      lastPass = s ? day(s.done_at) : null;
    }
    const plan = i.interval_months ? { intervalMonths: i.interval_months, source: i.source, sourceRef: i.source_ref } : null;
    return { id: i.id, tagNo: i.tag_no, category: i.category, service: i.service, subsystem: i.subsystem, eqTagNo: i.eq_tag_no,
      plan, lastPass, due: calibrationDue({ plan, lastPass, lastFailed, today, soonDays }) };
  });
}

// ── handover: the plan in the checklist, and the exports ─────────────────

/** Tag id → number of approved PM tasks. */
export async function approvedTaskCounts(db, { projectId }) {
  const { rows } = await db.query(
    "SELECT tag_id, count(*)::int AS n FROM pm_task WHERE project_id = $1 AND status = 'approved' GROUP BY tag_id", [projectId]);
  return Object.fromEntries(rows.map((r) => [r.tag_id, r.n]));
}

const PM_COLUMNS = [
  ["floc", "Functional Location"], ["tagNo", "Tag"], ["taskCode", "Task"], ["revision", "Revision"], ["title", "Description"],
  ["strategy", "Strategy"], ["intervalValue", "Interval"], ["intervalUnit", "Interval unit"], ["craft", "Craft"],
  ["durationH", "Duration (h)"], ["source", "Interval source"], ["sourceRef", "Source reference"], ["approvedAt", "Approved at"],
  ["approvedBy", "Approved by"],
];
const SPARE_COLUMNS = [
  ["floc", "Functional Location"], ["tagNo", "Tag"], ["partNo", "Part no."], ["manufacturer", "Manufacturer"],
  ["description", "Description"], ["category", "Category"], ["uom", "UoM"], ["qtyInstalled", "Qty installed"],
  ["qtyRecommended", "Qty recommended (SPIR)"], ["qtyApproved", "Qty approved"], ["itemCode", "Warehouse item"], ["spirRef", "SPIR ref."],
];

/**
 * The approved plan, or the spare-parts list, as neutral CSV keyed by
 * functional location — logged with its hash like the asset master.
 * Only APPROVED tasks leave: a draft is not a plan.
 */
export async function exportMaintenance(db, { projectId, kind, userId = null }) {
  const { rows: [p] } = await db.query("SELECT cmms_plant_code, floc_template FROM project WHERE id = $1", [projectId]);
  const { rows: tags } = await db.query(
    `SELECT t.id, t.tag_no, s.code AS subsystem, s.system_code, u.code AS unit FROM tag t
       LEFT JOIN subsystem s ON s.id = t.subsystem_id LEFT JOIN unit u ON u.id = s.unit_id WHERE t.project_id = $1`, [projectId]);
  const floc = Object.fromEntries(tags.map((t) => [t.id, flocFor(p.floc_template,
    { plant: p.cmms_plant_code, unit: t.unit, system: t.system_code, subsystem: t.subsystem, tag: t.tag_no }).code]));
  let columns, rows;
  if (kind === "pm_plan") {
    columns = PM_COLUMNS;
    rows = (await pmPlan(db, { projectId })).filter((t) => t.status === "approved").map((t) => ({
      floc: floc[t.tagId], tagNo: t.tagNo, taskCode: t.taskCode, revision: t.revision, title: t.title, strategy: t.strategy,
      intervalValue: t.intervalValue, intervalUnit: t.intervalUnit, craft: t.craft, durationH: t.durationH, source: t.source,
      sourceRef: t.sourceRef, approvedAt: t.approvedAt ? new Date(t.approvedAt).toISOString() : "", approvedBy: t.approvedByName }));
  } else if (kind === "spares") {
    columns = SPARE_COLUMNS;
    rows = (await sparesBoard(db, { projectId })).parts.map((s) => ({ ...s, floc: floc[s.tagId] }));
  } else throw bad(`خروجی «${kind}» شناخته نشد.`);
  const csv = toCsv(columns, rows);
  const sha256 = createHash("sha256").update(csv, "utf8").digest("hex");
  await db.query("INSERT INTO handover_export (project_id, rows_total, rows_ready, sha256, by_user, kind) VALUES ($1,$2,$3,$4,$5,$6)",
    [projectId, rows.length, rows.filter((r) => r.floc).length, sha256, userId, kind]);
  return { csv, sha256, rows: rows.length };
}

const ALLOT = { commissioning: 0, operational: 1, capital: 2 };

export const LABELS = { strategies: STRATEGIES, units: UNITS, sources: SOURCES, crafts: CRAFTS, spareCategories: SPARE_CATEGORIES };

// ── internals ────────────────────────────────────────────────────────────

function taskOut(r) {
  return { id: r.id, tagId: r.tag_id, tagNo: r.tag_no, tagDescription: r.tag_description, taskCode: r.task_code, revision: r.revision,
    title: r.title, strategy: r.strategy, intervalValue: n(r.interval_value), intervalUnit: r.interval_unit,
    interval: intervalText({ strategy: r.strategy, intervalValue: r.interval_value, intervalUnit: r.interval_unit }),
    craft: r.craft, durationH: n(r.duration_h), source: r.source, sourceRef: r.source_ref, notes: r.notes, status: r.status,
    preparedBy: r.prepared_by, preparedByName: r.prepared_by_name, approvedByName: r.approved_by_name, approvedAt: r.approved_at,
    supersededAt: r.superseded_at };
}

async function equipmentTag(db, projectId, tagId) {
  const { rows: [t] } = await db.query("SELECT id, discipline FROM tag WHERE id = $1 AND project_id = $2", [tagId, projectId]);
  if (!t) throw notFound("tag");
  if (t.discipline !== "equipment") throw bad("برنامهٔ نگهداری و قطعات یدکی برای تگ تجهیز ثبت می‌شود.");
  return t;
}

async function taskRow(db, projectId, taskId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(taskId || ""))) throw notFound("pm task");
  const { rows: [t] } = await db.query("SELECT * FROM pm_task WHERE id = $1 AND project_id = $2", [taskId, projectId]);
  if (!t) throw notFound("pm task");
  return t;
}

const clean = (v) => (v === null || v === undefined || !String(v).trim() ? null : String(v).trim());
const blankNum = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : Number(v));
const n = (v) => (v === null || v === undefined ? null : Number(v));
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
