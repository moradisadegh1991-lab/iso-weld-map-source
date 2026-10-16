export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { hotspots } from "../../../../lib/db/repos/review.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";

/**
 * Which fields the engineers keep correcting.
 *
 * The report that improves extraction. Aggregate accuracy says the model is
 * 94% right; this says which field the other 6% is in, and that is the one
 * you can act on — by changing the prompt, the tiling, or the model.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => Response.json(
      await hotspots(db, { projectId, since: url.searchParams.get("since") || null })));
  } catch (e) { return errorResponse(e); }
}
