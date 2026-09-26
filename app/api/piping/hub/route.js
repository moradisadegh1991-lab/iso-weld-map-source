export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { pipingHub, weldLogCsv } from "../../../../lib/db/repos/piping-hub.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (url.searchParams.get("export") === "weldlog") {
        return new Response(await weldLogCsv(db, { projectId }), { headers: {
          "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="weld-log.csv"' } });
      }
      return Response.json(await pipingHub(db, { projectId }));
    });
  } catch (e) { return errorResponse(e); }
}
