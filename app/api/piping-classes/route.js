export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { upsertPipingClass } from "../../../lib/db/repos/piping-class.mjs";
import { codeRequirement } from "../../../lib/ndt/b31-3.mjs";
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
        `SELECT c.*, COUNT(s.id) AS size_rows
           FROM piping_class c LEFT JOIN piping_class_size s ON s.piping_class_id = c.id
          WHERE c.project_id = $1 GROUP BY c.id ORDER BY c.code`, [projectId]);
      // Each class is returned with the code floor it sits on top of, so the
      // relationship between the two is visible rather than implied.
      return Response.json({
        classes: rows.map((c) => ({ ...c, codeFloor: codeRequirement(c.service_category) })),
      });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.projectId || !body.code || !body.serviceCategory) {
      return Response.json(
        { error: "projectId, code and serviceCategory are required" }, { status: 400 });
    }
    const { db, membership } = await authenticate(request, { projectId: body.projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_PIPING_CLASS);

    return await withProject(db, body.projectId, async () => Response.json(
      { pipingClass: await upsertPipingClass(db, body) }, { status: 201 }));
  } catch (e) { return errorResponse(e); }
}
