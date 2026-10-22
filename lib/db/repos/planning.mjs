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

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (x) => Object.assign(new Error(`${x} not found`), { status: 404 });
const iso = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d ? String(d).slice(0, 10) : null);
const n = (v) => (v === null || v === undefined ? null : Number(v));
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
    const row = { ...p, start_on: iso(p.start_on), end_on: iso(p.end_on), done_before: n(p.done_before), volume_plan: n(p.volume_plan) };
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
  const { rows: [row] } = await db.query(
    "UPDATE activity_plan SET start_on = $2, end_on = $3, done_before = $4, volume_plan = $5, description = $6 WHERE id = $1 RETURNING *",
    [id, r.row.start_on, r.row.end_on, r.row.done_before, r.row.volume_plan, r.row.description]);
  await LOG(db, projectId, `برنامهٔ نسخهٔ ${v.code}`, `${a?.code || ""} ویرایش شد`, userId);
  return row;
}

/** Planning rows out of their versions (the activities stay on the WBS). */
export async function removePlanRows(db, { projectId, ids = [], userId }) {
  if (!ids.length) throw bad("ردیفی انتخاب نشده است.");
  const { rowCount } = await db.query("DELETE FROM activity_plan WHERE id = ANY($1) AND project_id = $2", [ids, projectId]);
  if (!rowCount) throw notFound("plan row");
  await LOG(db, projectId, "برنامهٔ نسخه", `${rowCount} ردیف حذف شد`, userId);
  return { removed: rowCount };
}

/**
 * Everything one version plans into another of the same PMS: rows the
 * target lacks are added; rows it has are overwritten only with `replace`.
 */
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
    const vals = [p.start_on, p.end_on, p.done_before, p.volume_plan, p.description];
    if (there.has(p.activity_id)) {
      if (!replace) { kept++; continue; }
      await db.query("UPDATE activity_plan SET start_on = $3, end_on = $4, done_before = $5, volume_plan = $6, description = $7 WHERE version_id = $1 AND activity_id = $2",
        [toVersionId, p.activity_id, ...vals]);
      replaced++;
    } else {
      await db.query(
        `INSERT INTO activity_plan (project_id, version_id, activity_id, start_on, end_on, done_before, volume_plan, description, seq, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [projectId, toVersionId, p.activity_id, ...vals, ++seq, userId]);
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
