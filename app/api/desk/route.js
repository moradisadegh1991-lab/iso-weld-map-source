export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { CONTRACT_MANAGER_ROLES, contractAccess, visibleContracts } from "../../../lib/db/repos/users.mjs";
import { formAllowed } from "../../../lib/platform/tiles.mjs";
import * as reports from "../../../lib/db/repos/reports.mjs";
import { groupsOf } from "../../../lib/reports/workflow.mjs";
import { deskOf } from "../../../lib/db/repos/desk.mjs";
import { notificationsOf } from "../../../lib/db/repos/notifications.mjs";

/**
 * The signed-in member's desk (lib/db/repos/desk.mjs): their active and
 * archived requests, the forms they may start, and how many notifications
 * wait on them. Only ever their own.
 *
 *   GET ?projectId
 */
export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const projectId = params.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const context = { projectId, userId: user.id, role: membership.role, membership };
      const reportId = params.get("id");
      if (reportId) {
        const contractId = await allowedRequest(db, context, reportId);
        const state = await reports.snapshotOf(db, { projectId, reportId });
        const view = await reports.reportViewFromSnapshot(db, state, user.id);
        const stage = state.snapshot.stageSeq;
        const seen = new Set(groupsOf(state.snapshot.stages, user.id, stage).map((group) => group.groupId));
        const candidates = await recipientOptions(db, context, contractId);
        return Response.json({ stage, status: state.report.status, editable: view.may.edit,
          stages: view.signatureBoxes.map((step) => ({ ...step, groups: step.groups.map((group) => ({ ...group, here: step.stageSeq === stage && seen.has(group.groupId) })) })),
          users: candidates });
      }
      const contracts = await visibleContracts(db, context);
      const contractId = contracts.find((contract) => contract.id === params.get("contractId"))?.id || null;
      const desk = await deskOf(db, { ...context, contractId, contractIds: contracts.map((contract) => contract.id),
        allowType: (type) => !type.form || formAllowed(membership, type.code) });
      const n = await notificationsOf(db, { projectId, userId: user.id });
      return Response.json({ ...desk, notifications: { unread: n.unread, awaitingReply: n.awaitingReply } });
    });
  } catch (e) { return errorResponse(e); }
}


async function allowedRequest(db, context, id) {
  const { projectId, membership } = context;
  const { rows: [row] } = await db.query(
    `SELECT COALESCE(r.contract_id, t.form_contract_id) AS contract_id, t.code, t.form IS NOT NULL AS designed
       FROM report r JOIN report_type t ON t.id = r.report_type_id WHERE r.project_id = $1 AND r.id = $2`, [projectId, id]);
  if (!row || row.designed && !formAllowed(membership, row.code)
    || row.contract_id && !await contractAccess(db, { ...context, contractId: row.contract_id })) {
    throw Object.assign(new Error("not found"), { status: 404 });
  }
  return row.contract_id;
}

async function recipientOptions(db, { projectId, userId }, contractId) {
  return (await db.query(
    `SELECT u.id, COALESCE(u.display_name, u.email) AS name FROM project_member m JOIN app_user u ON u.id = m.user_id
      WHERE m.project_id = $1 AND u.is_active AND u.id <> $2
        AND ($3::uuid IS NULL OR u.is_developer OR m.role::text = ANY($4::text[]) OR EXISTS (
          SELECT 1 FROM contract_member c WHERE c.contract_id = $3 AND c.user_id = m.user_id))
      ORDER BY name`, [projectId, userId, contractId, CONTRACT_MANAGER_ROLES])).rows;
}

export async function POST(request) {
  try {
    const { projectId, reportId, userIds, note } = await request.json();
    if (!projectId || !reportId || !Array.isArray(userIds) || userIds.length > 100) return Response.json({ error: "invalid request" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const context = { projectId, userId: user.id, role: membership.role, membership };
      const contractId = await allowedRequest(db, context, reportId);
      const eligible = new Set((await recipientOptions(db, context, contractId)).map((person) => person.id));
      if (userIds.some((id) => !eligible.has(id))) return Response.json({ error: "گیرنده به این درخواست دسترسی ندارد." }, { status: 400 });
      return Response.json({ sent: await reports.sendReport(db, { ...context, reportId, userIds, note }) });
    });
  } catch (error) { return errorResponse(error); }
}
