export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { workFront } from "../../../lib/db/repos/workfront.mjs";

/** The work front: every item with work left, its next step, its material and when it can start. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const today = url.searchParams.get("today") || undefined;
    return await withProject(db, projectId, async () => Response.json(await workFront(db, { projectId, today })));
  } catch (e) { return errorResponse(e); }
}
