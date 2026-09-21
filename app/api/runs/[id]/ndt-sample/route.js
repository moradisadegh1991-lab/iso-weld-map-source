export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { getPipingClass, applyNdtRequirements, drawNdtSample }
  from "../../../../../lib/db/repos/piping-class.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

/**
 * Resolve the governing examination requirement for a run, then draw the
 * radiographic sample.
 *
 * Both in one call because they belong together: the sample means nothing
 * until every weld knows which requirement it is under, and any class rule
 * that falls below the code floor is returned so somebody owns it.
 */
export async function POST(request, { params }) {
  try {
    const { projectId, pipingClassCode, lineId = null, seed = null } = await request.json();
    if (!projectId || !pipingClassCode) {
      return Response.json(
        { error: "projectId and pipingClassCode are required" }, { status: 400 });
    }
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.DRAW_NDT_SAMPLE);

    return await withProject(db, projectId, async () => {
      const pipingClass = await getPipingClass(db, { projectId, code: pipingClassCode });
      if (!pipingClass) {
        return Response.json({ error: `Piping Class ${pipingClassCode} تعریف نشده` }, { status: 404 });
      }
      const { applied, deviations } = await applyNdtRequirements(db, {
        projectId, runId: params.id, pipingClass });
      const sample = await drawNdtSample(db, {
        projectId, runId: params.id, lineId, pipingClass, seed, userId: user.id });
      return Response.json({ applied, deviations, ...sample }, { status: 201 });
    });
  } catch (e) { return errorResponse(e); }
}
