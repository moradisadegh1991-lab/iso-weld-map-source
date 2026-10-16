export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { ndtCoverage } from "../../../../../lib/db/repos/piping-class.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

/** How much of a drawn sample has been shot, and which welder has none of it. */
export async function GET(request, ctx) {
  const params = await ctx.params; // Next 15: route params arrive as a promise
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () =>
      Response.json(await ndtCoverage(db, { projectId, selectionId: params.id })));
  } catch (e) { return errorResponse(e); }
}
