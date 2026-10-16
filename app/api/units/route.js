export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { listUnits, createUnit } from "../../../lib/db/repos/projects.mjs";

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () =>
      Response.json({ units: await listUnits(db, { projectId }) }));
  } catch (e) { return errorResponse(e); }
}

/** Declaring a unit and its grade is a project-definition act: admin only. */
export async function POST(request) {
  try {
    const { projectId, code, name = null, gradeElevationMm } = await request.json().catch(() => ({}));
    if (!projectId || !code) {
      return Response.json({ error: "projectId and code are required" }, { status: 400 });
    }
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () =>
      Response.json({ unit: await createUnit(db, { projectId, code, name, gradeElevationMm }) }));
  } catch (e) { return errorResponse(e); }
}
