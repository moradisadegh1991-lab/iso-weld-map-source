export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import * as rp from "../../../lib/db/repos/reports.mjs";
import { listProjectUsers } from "../../../lib/db/repos/users.mjs";
import { logEvent } from "../../../lib/db/repos/log.mjs";
import { PERMISSIONS } from "../../../lib/reports/workflow.mjs";

/**
 * The workflow of each report type: its stages, their review groups and the
 * members of each with their rights. Set by whoever manages the project's
 * members — the same person who decides who is on the project decides who
 * signs what.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => {
      const users = (await listProjectUsers(db, { projectId }))
        .map((u) => ({ id: u.user_id, name: u.display_name || u.email, email: u.email, party: u.inspection_party, role: u.role, active: u.is_active }));
      return Response.json({ types: await rp.reportTypes(db, { projectId }), users, permissions: PERMISSIONS });
    });
  } catch (e) { return errorResponse(e); }
}

const LABEL = {
  type: (b) => `نوع ${b.code}`, stage: (b) => `مرحلهٔ ${b.seq} «${b.name}»`, group: (b) => `گروه «${b.name}»`,
  template: () => "الگوی گزارش روزانه", member: () => "عضو گروه", "member-remove": () => "حذف عضو", "stage-remove": () => "حذف مرحله", "group-remove": () => "حذف گروه",
};

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    if (!LABEL[kind]) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => {
      const a = { ...body, projectId };
      const row = await {
        type: () => rp.upsertReportType(db, a),
        template: async () => (await rp.applyDailyTemplate(db, a)).type,
        stage: () => rp.upsertStage(db, { ...a, seq: Number(body.seq) }),
        group: () => rp.upsertGroup(db, { ...a, seq: Number(body.seq) }),
        member: () => rp.setGroupMember(db, a),
        "member-remove": () => rp.removeGroupMember(db, a),
        "stage-remove": () => rp.removeStage(db, a),
        "group-remove": () => rp.removeGroup(db, a),
      }[kind]();
      // who changed who may sign what is itself on the record
      await logEvent(db, { projectId, section: "reports", entityType: "report_setup", entityId: row?.id || null,
        label: LABEL[kind](body), action: kind.endsWith("remove") ? "cancelled" : "updated",
        comment: kind === "member" ? (body.permissions || []).map((p) => PERMISSIONS[p] || p).join("، ") : null, userId: user.id });
      return Response.json({ ok: true, row: row || null });
    });
  } catch (e) { return errorResponse(e); }
}
