/**
 * Handover forms (migration 072; rules in lib/reports/forms.mjs, workflow in
 * lib/reports/workflow.mjs). A form is a report type with a definition: the
 * employer's supervision of a section designs it, sets its workflow (stages,
 * groups, signers) and its print layout, and reports of it are made, signed
 * and printed like any other report. Call inside `withProject`.
 */
import * as rp from "./reports.mjs";
import * as fm from "../../reports/forms.mjs";
import { CLAIM_TABLES, labels } from "./claims.mjs";
import { AREAS, inArea } from "../../platform/areas.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const forbidden = (m) => Object.assign(new Error(m), { status: 403, code: "FORBIDDEN" });
const notFound = (w) => Object.assign(new Error(`${w} not found`), { status: 404 });
const iso = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d ? String(d).slice(0, 10) : null);

/** Built-in report types, whose content has its own code: not a form's code. */
export const RESERVED_CODES = ["DR", "CR"];
/** A new form's workflow, before its designer sets the members: the contractor hands over, the employer's supervision takes over. */
export const FORM_STAGES = [
  { seq: 1, name: "پیمانکار", groups: [{ seq: 1, name: "پیمانکار", title: "نمایندهٔ پیمانکار" }] },
  { seq: 2, name: "نظارت کارفرما", groups: [{ seq: 1, name: "نظارت", title: "نظارت کارفرما" }] },
];

/**
 * Who designs a section's forms: the project's admin, or a member who signs
 * for the employer (inspection party «کارفرما») and works in that section.
 */
export function mayDesign(membership, section) {
  if (!membership || !AREAS[section]) return false;
  if (["admin", "developer"].includes(membership.role)) return true;
  return membership.inspection_party === "company" && membership.role !== "viewer" && inArea(membership, section);
}
export const designableSections = (membership) => Object.keys(AREAS).filter((s) => mayDesign(membership, s));

export async function formTypes(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT t.id, t.code, t.name, t.description, t.section, t.form, t.active, u.display_name AS designed_by_name,
            (SELECT count(*)::int FROM report r WHERE r.report_type_id = t.id) AS reports
       FROM report_type t LEFT JOIN app_user u ON u.id = t.designed_by
      WHERE t.project_id = $1 AND t.form IS NOT NULL ORDER BY t.section, t.code`, [projectId]);
  return rows;
}

export async function formTypeByCode(db, { projectId, code }) {
  const { rows: [t] } = await db.query("SELECT * FROM report_type WHERE project_id = $1 AND code = $2 AND form IS NOT NULL", [projectId, String(code || "")]);
  if (!t) throw notFound("form");
  return t;
}

/** The type behind a type id. */
export async function typeOf(db, { projectId, reportTypeId }) {
  const { rows: [t] } = await db.query("SELECT * FROM report_type WHERE id = $1 AND project_id = $2", [reportTypeId, projectId]);
  return t || null;
}

/**
 * Every report type that follows the workflow behind a type, workflow, stage,
 * group or page id — for the workflow setup a form's designer may change: a
 * workflow shared with a form outside their sections is not theirs to change.
 */
export async function typesOf(db, { projectId, reportTypeId = null, workflowId = null, stageId = null, groupId = null, pageId = null }) {
  const wid = workflowId ? ["SELECT $1::uuid AS id", workflowId]
    : groupId ? ["SELECT s.workflow_id AS id FROM review_group g JOIN report_stage s ON s.id = g.stage_id WHERE g.id = $1", groupId]
      : stageId ? ["SELECT workflow_id AS id FROM report_stage WHERE id = $1", stageId]
        : pageId ? ["SELECT workflow_id AS id FROM workflow_page WHERE id = $1", pageId]
          : reportTypeId ? ["SELECT workflow_id AS id FROM report_type WHERE id = $1", reportTypeId] : null;
  if (!wid) return [];
  const { rows: [w] } = await db.query(wid[0], [wid[1]]);
  if (!w?.id) return reportTypeId ? [await typeOf(db, { projectId, reportTypeId })].filter(Boolean) : [];
  const { rows } = await db.query("SELECT * FROM report_type WHERE workflow_id = $1 AND project_id = $2", [w.id, projectId]);
  return rows;
}

/** Design a form, or redesign it. A new form gets the two-stage workflow; its members are the designer's to set. */
export async function saveFormType(db, { projectId, id = null, code, name, description = null, section, definition, membership, userId }) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,11}$/.test(c)) throw bad("کد فرم: حروف لاتین بزرگ، رقم، - یا _، حداکثر ۱۲ نویسه (مثل HO-PIP).");
  if (RESERVED_CODES.includes(c)) throw bad(`کد ${c} برای گزارش‌های ساخته‌شدهٔ سامانه است.`);
  if (!String(name || "").trim()) throw bad("نام فرم لازم است.");
  if (!AREAS[section]) throw bad("بخش فرم را انتخاب کنید.");
  if (!mayDesign(membership, section)) throw forbidden(`طراحی فرم‌های بخش «${AREAS[section]}» با نظارت کارفرمای همین بخش (یا مدیر پروژه) است.`);
  const { def, problems } = fm.checkDefinition(definition);
  if (problems.length) throw bad(problems.join(" "));
  const { rows: [dup] } = await db.query("SELECT id FROM report_type WHERE project_id = $1 AND code = $2 AND id IS DISTINCT FROM $3", [projectId, c, id]);
  if (dup) throw bad(`کد ${c} برای نوع گزارش دیگری ثبت شده است.`);
  let t;
  if (id) {
    const have = await typeOf(db, { projectId, reportTypeId: id });
    if (!have?.form) throw notFound("form");
    if (!mayDesign(membership, have.section)) throw forbidden(`این فرم از بخش «${AREAS[have.section]}» است.`);
    ({ rows: [t] } = await db.query(
      `UPDATE report_type SET code = $3, name = $4, description = $5, section = $6, form = $7 WHERE id = $1 AND project_id = $2 RETURNING *`,
      [id, projectId, c, String(name).trim(), description ? String(description).trim() : null, section, def]));
  } else {
    ({ rows: [t] } = await db.query(
      `INSERT INTO report_type (project_id, code, name, description, section, form, designed_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [projectId, c, String(name).trim(), description ? String(description).trim() : null, section, def, userId]));
    for (const st of FORM_STAGES) {
      const s = await rp.upsertStage(db, { projectId, reportTypeId: t.id, seq: st.seq, name: st.name });
      for (const g of st.groups) await rp.upsertGroup(db, { projectId, stageId: s.id, ...g });
    }
  }
  await logEvent(db, { projectId, section: "reports", entityType: "report_setup", entityId: t.id, label: `فرم ${t.code}`,
    action: id ? "updated" : "created", comment: `${t.name} — ${def.columns.length} ستون، ${def.header.length} فیلد سربرگ`, userId });
  return t;
}

const sectionOfTag = (kind) => (kind === "foundation" ? "civil" : kind === "structure" ? "structural" : "equipment");

/**
 * The work the employer accepted on `date` in `section`: contractor claims
 * approved, done that day (lib/db/repos/claims.mjs). What a handover form
 * with source «claims» takes as its rows.
 */
export async function acceptedWork(db, { projectId, section, date }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw bad("تاریخ را به شکل YYYY-MM-DD بدهید.");
  const out = [];
  for (const [table, t] of Object.entries(CLAIM_TABLES)) {
    if (table !== "tag_activity" && t.section !== section) continue;
    const { rows } = await db.query(
      `SELECT a.*, c.code AS contractor, u.display_name AS claimant, ua.display_name AS approver
         ${table === "tag_activity" ? ", tg.kind AS tag_kind" : ""}
         FROM ${table} a LEFT JOIN contractor c ON c.id = a.contractor_id
         LEFT JOIN app_user u ON u.id = a.recorded_by LEFT JOIN app_user ua ON ua.id = a.approved_by
         ${table === "tag_activity" ? "LEFT JOIN tag tg ON tg.id = a.tag_id" : ""}
        WHERE a.project_id = $1 AND a.approved_by IS NOT NULL AND a.status = 'done' AND a.done_at::date = $2::date
        ORDER BY a.approved_at`, [projectId, date]);
    const mine = table === "tag_activity" ? rows.filter((r) => sectionOfTag(r.tag_kind) === section) : rows;
    if (!mine.length) continue;
    const ls = await labels(db, table, mine);
    mine.forEach((r, k) => out.push({ table, id: r.id, item: ls[k].item, step: ls[k].step, code: r.code, discipline: AREAS[section],
      contractor: r.contractor || null, doneAt: iso(r.done_at), refNo: r.ref_no || null, claimant: r.claimant || null, approver: r.approver || null }));
  }
  return out;
}

/**
 * A new report of a form, for a day. Rows typed, or — when the form takes
 * them from accepted work and none were typed — that day's accepted work.
 */
export async function createFormReport(db, { projectId, code, reportDate, title = null, header = {}, rows = null, fromWork = false, userId }) {
  const t = await formTypeByCode(db, { projectId, code });
  let list = rows || [];
  if (fromWork) {
    if (t.form.source !== "claims") throw bad("ردیف‌های این فرم از کارهای تحویل‌گرفته نمی‌آیند.");
    list = fm.rowsFromWork(t.form, await acceptedWork(db, { projectId, section: t.section, date: reportDate }));
  }
  const { content, problems } = fm.checkFormContent(t.form, { header, rows: list });
  if (problems.length) throw bad(problems.join(" "));
  return rp.createReport(db, { projectId, reportTypeId: t.id, reportDate, title: title || `${t.name} — ${reportDate}`, content, userId });
}

/** A new version: checked against the definition the report was made with; adding, changing and removing rows are separate rights. */
export async function editFormReport(db, { projectId, reportId, header = {}, rows = [], userId }) {
  const { rows: [v] } = await db.query(
    `SELECT v.content FROM report_version v JOIN report r ON r.id = v.report_id
      WHERE v.report_id = $1 AND r.project_id = $2 ORDER BY v.version_no DESC LIMIT 1`, [reportId, projectId]);
  if (!v?.content?.def) throw notFound("form report");
  const { content, problems } = fm.checkFormContent(v.content.def, { header, rows });
  if (problems.length) throw bad(problems.join(" "));
  return rp.editReport(db, { projectId, reportId, content, userId, inspect: (prev) => fm.rowChanges(prev, content) });
}

/** One report as the user may see it, with the workflow panel's stages. */
export async function formReportView(db, { projectId, reportId, userId }) {
  const v = await rp.reportView(db, { projectId, reportId, userId });
  const t = await typeOf(db, { projectId, reportTypeId: v.report.report_type_id });
  if (!t?.form) throw notFound("form report");
  const stages = await rp.workflowOf(db, { projectId, reportTypeId: t.id });
  const snap = (await rp.snapshotOf(db, { projectId, reportId })).snapshot;
  return {
    ...v, type: { id: t.id, code: t.code, name: t.name, section: t.section, sectionName: AREAS[t.section] },
    def: v.content.def, totals: fm.columnTotals(v.content.def, v.content.rows || []),
    stages: stages.map((s) => ({ seq: s.seq, name: s.name, approverName: s.approverName, deputyName: s.deputyName,
      approved: s.seq < snap.stageSeq || v.report.status === "approved", current: v.report.status === "open" && s.seq === snap.stageSeq })),
  };
}
