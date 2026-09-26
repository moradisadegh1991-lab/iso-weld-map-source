export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { applyCorrection, editsOf } from "../../../../../lib/db/repos/review.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

export async function GET(request, ctx) {
  const params = await ctx.params; // Next 15: route params arrive as a promise
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () =>
      Response.json({ edits: await editsOf(db, { projectId, runId: params.id }) }));
  } catch (e) { return errorResponse(e); }
}

/**
 * Apply an engineer's correction.
 *
 * Every field they changed is recorded with both values. That log is the most
 * useful dataset this produces: it says which field extraction gets wrong,
 * which aggregate accuracy never could.
 */
export async function POST(request, ctx) {
  const params = await ctx.params; // Next 15: route params arrive as a promise
  try {
    const { projectId, payload, reason = null, options = {} } = await request.json();
    if (!projectId || !payload) {
      return Response.json({ error: "projectId and payload are required" }, { status: 400 });
    }
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.EDIT_EXTRACTION);

    return await withProject(db, projectId, async () => Response.json(
      await applyCorrection(db, {
        projectId, runId: params.id, payload, reason, options, userId: user.id }),
      { status: 200 }));
  } catch (e) { return errorResponse(e); }
}
