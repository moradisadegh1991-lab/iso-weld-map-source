export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { listProjectsForUser, createProject, createUnit } from "../../../lib/db/repos/projects.mjs";

/** The projects this caller belongs to. Never takes a project id from the request. */
export async function GET(request) {
  try {
    const { db, user } = await authenticate(request);
    return Response.json({ projects: await listProjectsForUser(db, user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Create a project. The creator becomes its admin. */
export async function POST(request) {
  try {
    const { db, user } = await authenticate(request);
    const { code, name, units = [] } = await request.json();
    if (!code || !name) return Response.json({ error: "code and name are required" }, { status: 400 });

    const project = await createProject(db, { code, name, ownerUserId: user.id });
    for (const u of units) {
      await createUnit(db, { projectId: project.id, code: u.code || u, name: u.name || null });
    }
    return Response.json({ project }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
