export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { reviewQueue } from "../../../lib/db/repos/review.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";

/** What is waiting for a piping engineer, worst first. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => Response.json({
      queue: await reviewQueue(db, {
        projectId, limit: Number(url.searchParams.get("limit")) || 50 }),
    }));
  } catch (e) { return errorResponse(e); }
}
