/**
 * Schedule and PMS (migration 062; engines in lib/controls/mspdi.mjs and
 * lib/controls/pms.mjs). Call inside `withProject`.
 */
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { parseMspdi } from "../../controls/mspdi.mjs";
import {
  parsePmsRows, checkPms, rollup, childrenOf, isElement, suggestLinks, planCurve, monthlyDates,
} from "../../controls/pms.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => (v == null ? null : Number(v));

/** Insert many rows in a few statements. */
async function insertMany(db, table, cols, rows, chunk = 200) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const vals = [];
    const tuples = part.map((r, k) => `(${cols.map((_, j) => `$${k * cols.length + j + 1}`).join(",")})`);
    for (const r of part) vals.push(...r);
    await db.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")}`, vals);
  }
}

// ── schedule ─────────────────────────────────────────────────────────────

/** An MS Project schedule saved as XML. Every import is kept; the newest is current. */
export async function importSchedule(db, { projectId, userId = null, sourceName, content }) {
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : String(content || "");
  const s = parseMspdi(text);
  if (!s.tasks.length) throw bad("برنامه هیچ فعالیتی ندارد.");
  const { rows: [imp] } = await db.query(
    `INSERT INTO schedule_import (project_id, title, author, source_name, source_sha256, status_date, start_date,
                                  finish_date, last_saved, task_count, imported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [projectId, s.title, s.author, sourceName, sha(text), s.statusDate, s.startDate, s.finishDate, s.lastSaved,
      s.tasks.length, userId]);
  await insertMany(db, "schedule_task",
    ["project_id", "import_id", "uid", "task_no", "name", "wbs", "outline", "level", "parent_uid", "is_summary",
      "is_milestone", "start_date", "finish_date", "bl_start", "bl_finish", "act_start", "act_finish",
      "duration_days", "pct", "critical", "custom"],
    s.tasks.map((t) => [projectId, imp.id, t.uid, t.id, t.name, t.wbs, t.outline, t.level, t.parentUid, t.summary,
      t.milestone, t.start, t.finish, t.blStart, t.blFinish, t.actStart, t.actFinish, t.durationDays, t.pct,
      t.critical, JSON.stringify(t.custom)]));
  if (s.links.length) {
    await insertMany(db, "schedule_link", ["project_id", "import_id", "pred_uid", "succ_uid", "link_type", "lag_days"],
      s.links.map((l) => [projectId, imp.id, l.predUid, l.succUid, l.type, l.lagDays]));
  }
  return { import: imp, tasks: s.tasks.length, links: s.links.length };
}

async function currentSchedule(db, projectId) {
  const { rows: [imp] } = await db.query(
    "SELECT * FROM schedule_import WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1", [projectId]);
  if (!imp) return null;
  const { rows: tasks } = await db.query(
    `SELECT uid, task_no, name, wbs, outline, level, parent_uid, is_summary, is_milestone,
            to_char(start_date,'YYYY-MM-DD') AS start, to_char(finish_date,'YYYY-MM-DD') AS finish,
            to_char(bl_start,'YYYY-MM-DD') AS bl_start, to_char(bl_finish,'YYYY-MM-DD') AS bl_finish,
            to_char(act_start,'YYYY-MM-DD') AS act_start, to_char(act_finish,'YYYY-MM-DD') AS act_finish,
            duration_days, pct, critical, custom
       FROM schedule_task WHERE import_id = $1 ORDER BY task_no`, [imp.id]);
  return { import: imp, tasks: tasks.map((t) => ({
    ...t, summary: t.is_summary, blStart: t.bl_start, blFinish: t.bl_finish,
    duration_days: num(t.duration_days), pct: num(t.pct),
  })) };
}

// ── PMS ──────────────────────────────────────────────────────────────────

/** The PMS sheet of a workbook: the one named PMS, else the first. */
export function readPmsWorkbook(buf) {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const name = wb.SheetNames.find((n) => n.trim().toUpperCase() === "PMS") || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: "A", raw: true, defval: null, blankrows: false });
  const saved = wb.Props?.ModifiedDate ? new Date(wb.Props.ModifiedDate) : null;
  return { sheet: name, rows, fileSavedAt: saved && !Number.isNaN(saved.getTime()) ? saved.toISOString() : null };
}

/**
 * A PMS workbook. The data date is what the caller states — a workbook that
 * does not print one leaves it UNKNOWN (NULL), never the save time.
 * `linkWithin` names the top-level branch whose elements are linked to the
 * current schedule (e.g. "OLF1"); without it nothing is linked automatically.
 */
export async function importPms(db, { projectId, userId = null, sourceName, content, dataDate = null, linkWithin = null }) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const { rows, fileSavedAt } = readPmsWorkbook(buf);
  const { title, nodes, stated } = parsePmsRows(rows);
  if (!nodes.some((n) => n.kind === "step")) throw bad("در این فایل هیچ گام PMS (ستون کد CC) پیدا نشد.");
  if (dataDate && dataDate > today()) throw bad("تاریخ داده نمی‌تواند در آینده باشد.");
  const problems = checkPms(nodes);
  const computed = rollup(nodes).get(nodes.find((n) => n.parent == null).seq).progress;
  const { rows: [imp] } = await db.query(
    `INSERT INTO pms_import (project_id, title, source_name, source_sha256, data_date, file_saved_at, stated_total,
                             computed_total, problems, imported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
    [projectId, title, sourceName, sha(buf), dataDate, fileSavedAt, stated, computed, JSON.stringify(problems), userId]);
  await insertMany(db, "pms_node",
    ["project_id", "import_id", "seq", "parent_seq", "kind", "level", "row_no", "name", "code", "unit", "step_weight",
      "wf", "qty", "done_qty", "progress", "progress_last", "progress_this"],
    nodes.map((n) => [projectId, imp.id, n.seq, n.parent, n.kind, n.level, n.row, n.name || "—", n.code, n.unit,
      n.stepWeight, n.wf, n.qty, n.doneQty, n.progress, n.progressLast, n.progressThis]));
  let linked = 0, elements = 0;
  if (linkWithin) {
    const sched = await currentSchedule(db, projectId);
    if (!sched) throw bad("برای پیوند خودکار، اول برنامهٔ زمان‌بندی را وارد کنید.");
    const branch = nodes.find((n) => n.kind === "group" && n.name.includes(linkWithin));
    if (!branch) throw bad(`شاخه‌ای با نام «${linkWithin}» در PMS نیست.`);
    const under = (n) => { for (let x = n; x; x = x.parent == null ? null : nodes[x.parent]) if (x.seq === branch.seq) return true; return false; };
    const links = suggestLinks(nodes, sched.tasks, under);
    elements = links.length;
    const made = links.filter((l) => l.uid != null);
    linked = made.length;
    if (made.length) {
      await insertMany(db, "pms_link", ["project_id", "pms_import_id", "node_seq", "schedule_import_id", "task_uid", "linked_by", "user_id"],
        made.map((l) => [projectId, imp.id, l.seq, sched.import.id, l.uid, l.by, userId]));
    }
  }
  return { import: imp, nodes: nodes.length, steps: nodes.filter((n) => n.kind === "step").length, problems: problems.length,
    stated, computed, linked, elements };
}

async function currentPms(db, projectId) {
  const { rows: [imp] } = await db.query(
    "SELECT * FROM pms_import WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1", [projectId]);
  return imp || null;
}

/** State the data date an import did not carry. Once stated it stays; a correction is a new import. */
export async function setDataDate(db, { projectId, pmsImportId, dataDate }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataDate || ""))) throw bad("تاریخ داده را وارد کنید.");
  if (dataDate > today()) throw bad("تاریخ داده نمی‌تواند در آینده باشد.");
  const { rowCount } = await db.query(
    "UPDATE pms_import SET data_date = $3 WHERE id = $2 AND project_id = $1 AND data_date IS NULL",
    [projectId, pmsImportId, dataDate]);
  if (!rowCount) throw bad("تاریخ دادهٔ این PMS قبلاً ثبت شده است؛ برای اصلاح، فایل را دوباره وارد کنید.");
}

/** Link an element of the current PMS to a summary task of the current schedule (or unlink with null). */
export async function linkElement(db, { projectId, seq, taskUid = null, userId = null }) {
  const imp = await currentPms(db, projectId);
  const sched = await currentSchedule(db, projectId);
  if (!imp || !sched) throw bad("هم PMS و هم برنامهٔ زمان‌بندی باید وارد شده باشند.");
  const { rows: nodes } = await db.query(
    "SELECT seq, parent_seq, kind FROM pms_node WHERE import_id = $1 AND (seq = $2 OR parent_seq = $2)", [imp.id, seq]);
  const self = nodes.find((n) => n.seq === Number(seq));
  if (!self || self.kind !== "group" || !nodes.some((n) => n.kind === "step")) throw bad("فقط آیتمی که گام دارد به فعالیت برنامه پیوند می‌خورد.");
  if (taskUid != null && !sched.tasks.some((t) => t.uid === Number(taskUid))) throw bad("این فعالیت در برنامهٔ جاری نیست.");
  await db.query(
    `INSERT INTO pms_link (project_id, pms_import_id, node_seq, schedule_import_id, task_uid, linked_by, user_id)
     VALUES ($1,$2,$3,$4,$5,'person',$6)`, [projectId, imp.id, Number(seq), sched.import.id, taskUid == null ? null : Number(taskUid), userId]);
}

/** A step's progress reported after the workbook. */
export async function recordProgress(db, { projectId, seq, asOf, pct, source, userId = null }) {
  const imp = await currentPms(db, projectId);
  if (!imp) throw bad("PMS وارد نشده است.");
  const { rows: [n] } = await db.query("SELECT kind FROM pms_node WHERE import_id = $1 AND seq = $2", [imp.id, Number(seq)]);
  if (!n || n.kind !== "step") throw bad("پیشرفت فقط برای یک گام ثبت می‌شود.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOf || ""))) throw bad("تاریخ را وارد کنید.");
  if (asOf > today()) throw bad("تاریخ پیشرفت نمی‌تواند در آینده باشد.");
  if (imp.data_date && asOf < iso(imp.data_date)) throw bad("این تاریخ پیش از تاریخ دادهٔ PMS است.");
  const p = Number(pct);
  if (!Number.isFinite(p) || p < 0 || p > 100) throw bad("درصد باید بین ۰ و ۱۰۰ باشد.");
  if (!String(source || "").trim()) throw bad("منبع گزارش (مثلاً شمارهٔ گزارش روزانه) لازم است.");
  await db.query(
    `INSERT INTO pms_progress (project_id, pms_import_id, node_seq, as_of, pct, source, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`, [projectId, imp.id, Number(seq), asOf, p, String(source).trim(), userId]);
}

// ── the combined view ────────────────────────────────────────────────────

const iso = (d) => (d == null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

export async function pmsView(db, { projectId, asOf = null }) {
  const sched = await currentSchedule(db, projectId);
  const imp = await currentPms(db, projectId);
  const out = { schedule: sched && { ...sched.import, status_date: iso(sched.import.status_date),
    start_date: iso(sched.import.start_date), finish_date: iso(sched.import.finish_date) }, tasks: sched ? sched.tasks : [], pms: null };
  if (!imp) return out;
  const { rows } = await db.query(
    `SELECT seq, parent_seq, kind, level, row_no, name, code, unit, step_weight, wf, qty, done_qty, progress,
            progress_last, progress_this FROM pms_node WHERE import_id = $1 ORDER BY seq`, [imp.id]);
  const nodes = rows.map((r) => ({ seq: r.seq, parent: r.parent_seq, kind: r.kind, level: r.level, row: r.row_no,
    name: r.name, code: r.code, unit: r.unit, stepWeight: num(r.step_weight), wf: num(r.wf), qty: num(r.qty),
    doneQty: num(r.done_qty), progress: num(r.progress), progressLast: num(r.progress_last), progressThis: num(r.progress_this) }));
  const { rows: reports } = await db.query(
    `SELECT node_seq, to_char(as_of,'YYYY-MM-DD') AS as_of, pct, source, created_at FROM pms_progress
      WHERE pms_import_id = $1 ORDER BY as_of, created_at`, [imp.id]);
  const { rows: linkRows } = await db.query(
    `SELECT DISTINCT ON (node_seq) node_seq, task_uid, linked_by, schedule_import_id FROM pms_link
      WHERE pms_import_id = $1 ORDER BY node_seq, created_at DESC`, [imp.id]);
  const dataDate = iso(imp.data_date);
  const until = asOf || today();
  // A step's progress on a date: the newest report on or before it, else the workbook's.
  const latest = new Map();
  for (const r of reports) if (r.as_of <= until) latest.set(r.node_seq, r);
  const progressOf = (on) => (s) => {
    let p = s.progress ?? 0;
    for (const r of reports) if (r.node_seq === s.seq && r.as_of <= on) p = Number(r.pct) / 100;
    return p;
  };
  const now = rollup(nodes, progressOf(until));
  const kids = childrenOf(nodes);
  const taskByUid = new Map((sched?.tasks || []).map((t) => [t.uid, t]));
  // A link names a task by its MS Project UID, which stays the same from one
  // issue of the plan to the next; so a re-imported plan keeps its links. A
  // UID the current plan no longer has reads as unlinked.
  const links = new Map(linkRows.map((l) => [l.node_seq, { uid: l.task_uid, by: l.linked_by }]));
  const elements = nodes.filter((n) => isElement(n, kids)).map((n) => {
    const l = links.get(n.seq);
    const task = l && l.uid != null ? taskByUid.get(l.uid) || null : null;
    return { seq: n.seq, wf: n.wf, task, by: task ? l.by : null };
  });

  // Plan vs actual over the linked elements only.
  let curve = null;
  const linked = elements.filter((e) => e.task);
  if (linked.length) {
    const starts = linked.flatMap((e) => [e.task.blStart, e.task.start]).filter(Boolean).sort();
    const ends = linked.flatMap((e) => [e.task.blFinish, e.task.finish]).filter(Boolean).sort();
    const dates = monthlyDates(starts[0], ends.at(-1));
    const baseline = planCurve(linked, { dates, use: "baseline" });
    const forecast = planCurve(linked, { dates, use: "current" });
    const linkedW = linked.reduce((s, e) => s + (e.wf || 0), 0);
    const actualAt = (on) => {
      const r = rollup(nodes, progressOf(on));
      return (100 * linked.reduce((s, e) => s + (e.wf || 0) * (r.get(e.seq).progress ?? 0), 0)) / linkedW;
    };
    const actual = [];
    if (dataDate) actual.push({ on: dataDate, pct: actualAt(dataDate), source: "PMS" });
    for (const d of [...new Set(reports.map((r) => r.as_of))]) if (d <= until) actual.push({ on: d, pct: actualAt(d), source: "گزارش" });
    curve = { dates, baseline: baseline.points, forecast: forecast.points, actual,
      // With no data date, the workbook's figure is known but not WHEN — shown apart, not plotted.
      undated: dataDate ? null : actualAt("9999-12-31"), coveredWf: linkedW,
      totalWf: elements.reduce((s, e) => s + (e.wf || 0), 0) };
  }
  const problems = Array.isArray(imp.problems) ? imp.problems : [];
  return {
    ...out,
    pms: {
      import: { ...imp, data_date: dataDate, file_saved_at: imp.file_saved_at, stated_total: num(imp.stated_total),
        computed_total: num(imp.computed_total) },
      nodes: nodes.map((n) => ({ ...n, now: now.get(n.seq)?.progress ?? null,
        report: latest.get(n.seq) ? { as_of: latest.get(n.seq).as_of, pct: Number(latest.get(n.seq).pct), source: latest.get(n.seq).source } : null })),
      elements: elements.map((e) => ({ seq: e.seq, uid: e.task?.uid ?? null, by: e.by })),
      problems, reports: reports.length, curve, asOf: until,
    },
  };
}
