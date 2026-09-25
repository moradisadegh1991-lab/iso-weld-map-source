export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  registerBoard, upsertMdr, issueRevision, createTransmittal, recordReturn,
} from "../../../lib/db/repos/doc-control.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const board = await registerBoard(db, { projectId, onDate: url.searchParams.get("onDate") || null });
      const { rows: subsystems } = await db.query("SELECT id, code FROM subsystem WHERE project_id = $1 ORDER BY code", [projectId]);
      return Response.json({ ...board, subsystems });
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
    assertCan(membership, ACTIONS.CONTROL_DOCUMENTS);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      const run = { document: upsertMdr, revision: issueRevision, transmittal: createTransmittal, return: recordReturn }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ result: await run(db, args) });
    });
  } catch (e) { return errorResponse(e); }
}
