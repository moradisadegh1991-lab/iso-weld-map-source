export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { approveRun } from "../../../../../lib/db/repos/runs.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

/**
 * Sign off a weld register.
 *
 * This is the endpoint that carries professional responsibility, so it is the
 * one place where the role check is not a formality: only an engineer passes
 * it. QC inspects and records NDT; it does not sign the design. The
 * permission rule lives in lib/authz.mjs and the data invariant — that an
 * approval records who signed and the hash of what they signed — lives in the
 * schema. Both have to agree before a row changes.
 */
export async function POST(request, { params }) {
  try {
    const { projectId } = await request.json();
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });

    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.APPROVE_REGISTER);

    return await withProject(db, projectId, async () => {
      const run = await approveRun(db, { projectId, runId: params.id, userId: user.id });
      return Response.json({ run });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
