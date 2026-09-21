export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { compareRuns, compareWithPrevious } from "../../../../../lib/db/repos/revisions.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

/**
 * What this revision changed, and what it costs.
 *
 * With `?against=<runId>` it compares two named runs; without it, the run
 * before this one for the same drawing sheet. The response carries the
 * weld-level diff and the spool impact split by fabrication status, because
 * the second is the part somebody has to act on today.
 */
export async function GET(request, { params }) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const against = url.searchParams.get("against");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });

    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const result = against
        ? await compareRuns(db, { projectId, fromRunId: against, toRunId: params.id })
        : await compareWithPrevious(db, { projectId, runId: params.id });
      return Response.json(result);
    });
  } catch (e) {
    return errorResponse(e);
  }
}
