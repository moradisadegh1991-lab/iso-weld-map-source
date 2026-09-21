export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { recordNdt, ndtHistory } from "../../../../../lib/db/repos/execution.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

export async function GET(request, { params }) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () =>
      Response.json({ records: await ndtHistory(db, { projectId, weldUid: params.uid }) }));
  } catch (e) { return errorResponse(e); }
}

/** The repair cycle is derived server-side; a caller cannot number its own re-shots. */
export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const { projectId, method, result } = body;
    if (!projectId || !method || !result) {
      return Response.json({ error: "projectId, method and result are required" }, { status: 400 });
    }
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.RECORD_NDT);

    return await withProject(db, projectId, async () => Response.json(
      { record: await recordNdt(db, { ...body, projectId, weldUid: params.uid, userId: user.id }) },
      { status: 201 }));
  } catch (e) { return errorResponse(e); }
}
