export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { assetThread } from "../../../lib/db/repos/asset.mjs";

/** GET ?projectId&tag=P-1203A — the digital thread of one asset. Without tag: the tag list to pick from. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const tagNo = url.searchParams.get("tag");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (!tagNo) {
        const { rows } = await db.query(
          "SELECT tag_no, discipline, description FROM tag WHERE project_id = $1 ORDER BY tag_no", [projectId]);
        return Response.json({ tags: rows });
      }
      return Response.json(await assetThread(db, { projectId, tagNo }));
    });
  } catch (e) { return errorResponse(e); }
}
