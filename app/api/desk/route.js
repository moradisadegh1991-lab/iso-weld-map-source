export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
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
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const desk = await deskOf(db, { projectId, userId: user.id });
      const n = await notificationsOf(db, { projectId, userId: user.id });
      return Response.json({ ...desk, notifications: { unread: n.unread, awaitingReply: n.awaitingReply } });
    });
  } catch (e) { return errorResponse(e); }
}
