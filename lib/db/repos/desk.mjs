/**
 * A member's desk (owner's requirements of 2026-10-22, items 13 and 14):
 * every request — a report of a form that follows a workflow — they take
 * part in, in two lists: the active ones (still in their workflow) and the
 * archive (approved or cancelled); and the forms they may start, those whose
 * first stage gives them the right to create.
 *
 * Taking part: a member of one of its workflow's groups (by name or through
 * a duty held today), its maker, or someone it was sent to. An active
 * request says what waits on the member now — sign, approve, return — read
 * from the same rules the request's own page follows (lib/reports/
 * workflow.mjs), with its stage's deadline and the member's review days.
 * Reading a request applies its stage deadlines first (reports.snapshotOf).
 * Call inside `withProject`.
 */
import * as rp from "./reports.mjs";
import * as wf from "../../reports/workflow.mjs";

/** Where a request of a form opens: the form's own page, with the request named. */
export function linkOf(type, reportId) {
  if (type.code === "CR") return `/contract-reports?report=${reportId}`;
  if (type.code === "DR") return `/daily-reports?report=${reportId}`;
  if (type.form) return `/forms/${encodeURIComponent(type.code)}?report=${reportId}`;
  return null;
}
const startOf = (type) => (type.code === "CR" ? "/contract-reports" : type.code === "DR" ? "/daily-reports" : type.form ? `/forms/${encodeURIComponent(type.code)}` : null);

export async function deskOf(db, { projectId, userId }) {
  const types = (await rp.reportTypes(db, { projectId })).filter((t) => t.workflow_id && t.active !== false);
  const active = [], archive = [], start = [];
  for (const type of types) {
    const stages = type.stages;
    const inWorkflow = wf.canView(stages, userId);
    if (stages.length && wf.checkCreate(stages, userId).ok && startOf(type)) start.push({ code: type.code, name: type.name, href: startOf(type) });
    const { rows } = await db.query(
      `SELECT r.id, r.report_no, r.report_date::text AS report_date, r.title, r.status, r.created_by, r.created_at
         FROM report r WHERE r.project_id = $1 AND r.report_type_id = $2
          AND ($3 OR r.created_by = $4 OR EXISTS (SELECT 1 FROM report_recipient x WHERE x.report_id = r.id AND x.user_id = $4))
        ORDER BY r.report_date DESC, r.report_no DESC`, [projectId, type.id, inWorkflow, userId]);
    for (const r of rows) {
      const base = { id: r.id, typeCode: type.code, typeName: type.name, reportNo: r.report_no, reportDate: r.report_date, title: r.title, href: linkOf(type, r.id) };
      if (r.status !== "open") { archive.push({ ...base, status: r.status }); continue; }
      // an open request: its deadlines applied, then what waits on this member
      const s = await rp.snapshotOf(db, { projectId, reportId: r.id });
      const snap = s.snapshot;
      if (snap.status !== "open") { archive.push({ ...base, status: snap.status }); continue; }
      const stage = snap.stages.find((x) => x.seq === snap.stageSeq);
      const mine = wf.groupsOf(snap.stages, userId, snap.stageSeq);
      const waits = [];
      if (mine.some((g) => wf.checkSign(snap, userId, g.groupId).ok)) waits.push("sign");
      if (wf.checkApprove(snap, userId).ok) waits.push("approve");
      if (mine.length && wf.checkReturn(snap, userId, "-").ok) waits.push("return");
      const due = wf.reviewDue(snap, snap.stageSeq).filter((d) => d.due && mine.some((g) => g.groupId === d.groupId)).map((d) => d.due).sort()[0] || null;
      const deadlineAt = stage?.deadlineDays
        ? new Date(Number((wf.arrivedAt(snap, snap.stageSeq) + BigInt(stage.deadlineDays) * 86400000000n) / 1000n)).toISOString() : null;
      active.push({ ...base, status: "open", stageSeq: snap.stageSeq, stageName: stage?.name || null, atMyStage: mine.length > 0, waits,
        reviewDue: due, overdue: !!due && Date.parse(due) < Date.now() && waits.includes("sign"), deadlineAt });
    }
  }
  // what waits on the member first, then the rest; newest first within each
  active.sort((a, b) => (b.waits.length > 0) - (a.waits.length > 0) || String(b.reportDate).localeCompare(String(a.reportDate)));
  archive.sort((a, b) => String(b.reportDate).localeCompare(String(a.reportDate)));
  return { active, archive, start };
}
