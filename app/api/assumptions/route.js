export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  listAssumptions, proposeAssumption, reviseAssumption, decideAssumption, assumptionHistory,
  addBaseline, missingInformation,
} from "../../../lib/db/repos/assumptions.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const assumptionId = url.searchParams.get("assumptionId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (assumptionId) return Response.json({ history: await assumptionHistory(db, { projectId, assumptionId }) });
      return Response.json({
        assumptions: await listAssumptions(db, { projectId }),
        missing: await missingInformation(db, { projectId }),
      });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    // Proposing and revising is engineering; deciding is a sign-off.
    assertCan(membership, kind === "decide" ? ACTIONS.APPROVE_REGISTER : ACTIONS.EDIT_EXTRACTION);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "baseline") return Response.json(await addBaseline(db, args));
      if (kind === "propose") return Response.json({ assumption: await proposeAssumption(db, args) });
      if (kind === "revise") return Response.json({ assumption: await reviseAssumption(db, args) });
      if (kind === "decide") return Response.json({ assumption: await decideAssumption(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
