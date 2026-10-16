export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { repairRates, weldsAwaitingNdt } from "../../../../lib/db/repos/execution.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";

/**
 * Repair rate per welder, plus the welds still waiting for NDT.
 *
 * The second list is the handover gap caught early: every weld on it is an
 * ITR that will be missing from the dossier if nobody acts.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const since = url.searchParams.get("since") || null;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => Response.json({
      welders: await repairRates(db, { projectId, since }),
      awaitingNdt: await weldsAwaitingNdt(db, { projectId }),
    }));
  } catch (e) { return errorResponse(e); }
}
