export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import { claimsBoard, decideClaims } from "../../../lib/db/repos/claims.mjs";
import { updateProjectProfile } from "../../../lib/db/repos/projects.mjs";

/** Contractor claims waiting for the employer, and the decisions taken. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json({
      ...(await claimsBoard(db, { projectId })),
      me: { id: user.id, party: membership.inspection_party || null,
        canDecide: membership.inspection_party === "company" && can(membership, ACTIONS.RECORD_INSPECTION),
        canSet: can(membership, ACTIONS.MANAGE_MEMBERS) },
    }));
  } catch (e) { return errorResponse(e); }
}

/** kind "decide": approve or reject claims; kind "setting": turn the approval on or off. */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    return await withProject(db, projectId, async () => {
      if (kind === "decide") {
        assertCan(membership, ACTIONS.RECORD_INSPECTION);
        return Response.json(await decideClaims(db, { projectId, items: body.items || [], decision: body.decision, reason: body.reason, userId: user.id }));
      }
      if (kind === "setting") {
        assertCan(membership, ACTIONS.MANAGE_MEMBERS);
        await updateProjectProfile(db, { projectId, patch: { site_work_approval: !!body.enabled } });
        return Response.json(await claimsBoard(db, { projectId }));
      }
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
