export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { hrBoard, upsertPersonnel, recordTimesheet } from "../../../lib/db/repos/hr.mjs";

/** Personnel, headcount and hours. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const board = await hrBoard(db, { projectId, onDate: url.searchParams.get("on") });
      const { rows: contractors } = await db.query("SELECT id, code, name FROM contractor WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: accounts } = await db.query("SELECT id, code, title FROM control_account WHERE project_id = $1 ORDER BY code", [projectId]);
      return Response.json({ ...board, contractors, accounts });
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
    assertCan(membership, ACTIONS.MANAGE_HR);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "person") return Response.json({ person: await upsertPersonnel(db, args) });
      if (kind === "timesheet") return Response.json({ timesheet: await recordTimesheet(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
