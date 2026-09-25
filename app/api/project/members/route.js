export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { listMembers, setInspectionParty } from "../../../../lib/db/repos/projects.mjs";

/** GET ?projectId= the members, their role and inspection party · POST { projectId, userId, party } */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => Response.json({ members: await listMembers(db, { projectId }) }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const { projectId, userId, party } = await request.json().catch(() => ({}));
    if (!projectId || !userId) return Response.json({ error: "projectId and userId are required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () =>
      Response.json({ member: await setInspectionParty(db, { projectId, userId, party: party || null }) }));
  } catch (e) { return errorResponse(e); }
}
