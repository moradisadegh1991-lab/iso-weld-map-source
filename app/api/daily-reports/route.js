export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import * as rp from "../../../lib/db/repos/reports.mjs";
import { dailyPrefill } from "../../../lib/db/repos/daily-report.mjs";
import { checkDaily, dailyTotals, SOURCE, SHIFT, WEATHER } from "../../../lib/reports/daily.mjs";
import { checkCreate } from "../../../lib/reports/workflow.mjs";
import { listCatalog } from "../../../lib/db/repos/catalog.mjs";

/**
 * The daily site report (report type DR). Who may do what to a report is
 * decided by its workflow (lib/reports/workflow.mjs) from the groups the
 * project set up — not by the member's role, so this route asks only that
 * the caller is on the project.
 *
 *   GET ?projectId=              the reports the caller may see, and whether they may start one
 *   GET ?projectId=&id=          one report: content, totals, signature boxes, history, what the caller may do
 *   GET ?projectId=&prefill=DATE what the project already holds for that day, offered to the form
 */
const CODE = "DR";
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });

async function dailyType(db, projectId) {
  const { rows: [t] } = await db.query("SELECT * FROM report_type WHERE project_id = $1 AND code = $2", [projectId, CODE]);
  return t || null;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const prefill = url.searchParams.get("prefill");
      if (prefill) return Response.json(await dailyPrefill(db, { projectId, date: prefill }));
      const id = url.searchParams.get("id");
      if (id) {
        const v = await rp.reportView(db, { projectId, reportId: id, userId: user.id });
        return Response.json({ ...v, totals: dailyTotals(v.content), labels: { SOURCE, SHIFT, WEATHER } });
      }
      const type = await dailyType(db, projectId);
      if (!type) return Response.json({ type: null, reports: [], may: { create: false } });
      const stages = await rp.workflowOf(db, { projectId, reportTypeId: type.id });
      const { rows: users } = await db.query(
        `SELECT u.id, COALESCE(u.display_name, u.email) AS name FROM project_member m JOIN app_user u ON u.id = m.user_id
          WHERE m.project_id = $1 AND u.is_active ORDER BY 2`, [projectId]);
      return Response.json({
        type: { id: type.id, code: type.code, name: type.name, stages: stages.map((s) => ({ seq: s.seq, name: s.name })) },
        reports: await rp.listReports(db, { projectId, reportTypeId: type.id, userId: user.id }),
        may: { create: checkCreate(stages, user.id).ok }, users, labels: { SOURCE, SHIFT, WEATHER },
        catalog: (await listCatalog(db, { projectId, activeOnly: true })).map((i) => ({ kind: i.kind, name: i.name, discipline: i.discipline, unit: i.unit })),
      });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const content = () => {
      const { content: c, problems } = checkDaily(body.content || {});
      if (problems.length) throw bad(problems.join(" · "));
      return c;
    };
    return await withProject(db, projectId, async () => {
      const a = { projectId, userId: user.id, reportId: body.reportId };
      const run = {
        create: async () => {
          const type = await dailyType(db, projectId);
          if (!type) throw bad("گردش‌کار گزارش روزانه هنوز تنظیم نشده است (تنظیم گردش‌کار).");
          return rp.createReport(db, { ...a, reportTypeId: type.id, reportDate: body.reportDate, title: body.title, content: content() });
        },
        edit: () => rp.editReport(db, { ...a, content: content() }),
        sign: () => rp.signReport(db, { ...a, groupId: body.groupId || null }),
        withdraw: () => rp.withdrawSignature(db, { ...a, groupId: body.groupId || null }),
        approve: () => rp.approveStage(db, { ...a, comment: body.comment }),
        return: () => rp.returnReport(db, { ...a, comment: body.comment }),
        cancel: () => rp.cancelReport(db, { ...a, comment: body.comment }),
        send: () => rp.sendReport(db, { ...a, userIds: body.userIds || [], note: body.note }),
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ ok: true, row: (await run()) ?? null });
    });
  } catch (e) { return errorResponse(e); }
}
