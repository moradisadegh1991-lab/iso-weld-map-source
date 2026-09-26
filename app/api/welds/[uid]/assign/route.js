export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { assignWeld } from "../../../../../lib/db/repos/execution.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

/**
 * Assign a weld to a welder — or refuse, with the clause.
 *
 * A refusal here is a 422 carrying the full verdict, not a generic error: the
 * person at the other end is a site supervisor who needs to know whether to
 * find another welder, chase a certificate, or send someone for a re-test.
 */
export async function POST(request, ctx) {
  const params = await ctx.params; // Next 15: route params arrive as a promise
  try {
    const body = await request.json();
    const { projectId, welderId, weldedAt } = body;
    if (!projectId || !welderId || !weldedAt) {
      return Response.json(
        { error: "projectId, welderId and weldedAt are required" }, { status: 400 });
    }
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.ASSIGN_WELD);

    return await withProject(db, projectId, async () => {
      try {
        const out = await assignWeld(db, { ...body, projectId, weldUid: params.uid, userId: user.id });
        return Response.json(out, { status: 201 });
      } catch (e) {
        if (e.verdict) {
          return Response.json({ error: e.message, code: e.code, verdict: e.verdict },
            { status: e.status });
        }
        throw e;
      }
    });
  } catch (e) { return errorResponse(e); }
}
