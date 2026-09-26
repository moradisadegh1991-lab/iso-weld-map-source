export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { jointHistory } from "../../../../lib/db/repos/joint.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";

/** GET ?projectId=   one weld's whole history (lib/db/repos/joint.mjs). */
export async function GET(request, { params }) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () =>
      Response.json(await jointHistory(db, { projectId, weldUid: decodeURIComponent(params.uid) }),
        { headers: { "Cache-Control": "no-store" } }));
  } catch (e) { return errorResponse(e); }
}
