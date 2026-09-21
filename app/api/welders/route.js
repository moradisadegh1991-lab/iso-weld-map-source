export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { upsertWelder } from "../../../lib/db/repos/execution.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const { rows } = await db.query(
        `SELECT w.*, COUNT(q.id) FILTER (WHERE q.revoked_at IS NULL) AS live_qualifications
           FROM welder w LEFT JOIN welder_qualification q ON q.welder_id = w.id
          WHERE w.project_id = $1 GROUP BY w.id ORDER BY w.stamp_no`, [projectId]);
      return Response.json({ welders: rows });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const { projectId, stampNo, name, employer = null } = await request.json();
    if (!projectId || !stampNo || !name) {
      return Response.json({ error: "projectId, stampNo and name are required" }, { status: 400 });
    }
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_WELDERS);

    return await withProject(db, projectId, async () => Response.json(
      { welder: await upsertWelder(db, { projectId, stampNo, name, employer }) }, { status: 201 }));
  } catch (e) { return errorResponse(e); }
}
