export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { getProjectProfile, updateProjectProfile } from "../../../lib/db/repos/projects.mjs";

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () =>
      Response.json({ project: await getProjectProfile(db, { projectId }) }));
  } catch (e) { return errorResponse(e); }
}

/**
 * Editing the project's particulars is an admin action.
 *
 * MANAGE_MEMBERS is the closest existing grant and only `admin` holds it,
 * which is the intent: the contract value and the client's name are not
 * things a site engineer should be able to change, and inventing a new
 * action for one screen would put the permission model in two places.
 */
export async function PATCH(request) {
  try {
    const { projectId, patch } = await request.json().catch(() => ({}));
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () =>
      Response.json({ project: await updateProjectProfile(db, { projectId, patch: patch || {} }) }));
  } catch (e) { return errorResponse(e); }
}
