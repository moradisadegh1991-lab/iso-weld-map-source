export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { searchJoints } from "../../../lib/db/repos/joint.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";

/** GET ?projectId=&q=   welds of the current revisions: number, line, spool, drawing or welder stamp. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () =>
      Response.json({ welds: await searchJoints(db, { projectId, q: url.searchParams.get("q") || "" }) }));
  } catch (e) { return errorResponse(e); }
}
