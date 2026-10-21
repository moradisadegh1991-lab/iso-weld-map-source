export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { usageReport } from "../../../lib/llm/accounting.mjs";

/**
 * GET ?projectId — the project's model account (lib/llm/accounting.mjs):
 * tokens by month, model, person and pass, the cost where a price is
 * configured, this month against the allowance, and the latest calls.
 * The project's administrator reads it (MANAGE_MEMBERS), like the rest of
 * the users-and-access page it sits on.
 */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return Response.json(await withProject(db, projectId, () => usageReport(db, { projectId })));
  } catch (e) { return errorResponse(e); }
}
