export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { subsystemReadiness, unfiled, unfiledLines, fileLine } from "../../../lib/db/repos/spine.mjs";

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json({
      readiness: await subsystemReadiness(db, { projectId }),
      unfiled: await unfiled(db, { projectId }),
      unfiledLines: await unfiledLines(db, { projectId }),
      subsystems: (await db.query("SELECT id, code, name FROM subsystem WHERE project_id = $1 ORDER BY code", [projectId])).rows,
    }));
  } catch (e) { return errorResponse(e); }
}

/** File a line under a subsystem — the engineer's call, where the drawing's MDR row did not already say. */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind, lineId, subsystemId } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.EDIT_EXTRACTION);
    if (kind !== "file-line") return Response.json({ error: "unknown kind" }, { status: 400 });
    if (!lineId || !subsystemId) return Response.json({ error: "خط و ساب‌سیستم را انتخاب کنید.", code: "INVALID_INPUT" }, { status: 400 });
    return await withProject(db, projectId, async () => Response.json({ line: await fileLine(db, { projectId, lineId, subsystemId }) }));
  } catch (e) { return errorResponse(e); }
}
