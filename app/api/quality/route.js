export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import {
  qualityBoard, punchHistory, ncrHistory, raisePunch, punchAction, raiseNcr, ncrAction,
} from "../../../lib/db/repos/quality.mjs";
import { listPhotos } from "../../../lib/db/repos/punch-photos.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const punchId = url.searchParams.get("punchId");
      const ncrId = url.searchParams.get("ncrId");
      if (punchId) return Response.json({ history: await punchHistory(db, { projectId, punchId }),
        photos: await listPhotos(db, { projectId, punchId }) });
      if (ncrId) return Response.json({ history: await ncrHistory(db, { projectId, ncrId }) });
      const board = await qualityBoard(db, { projectId });
      const { rows: tags } = await db.query(
        "SELECT id, tag_no, subsystem_id FROM tag WHERE project_id = $1 ORDER BY tag_no", [projectId]);
      const { rows: contractors } = await db.query(
        "SELECT id, code, name FROM contractor WHERE project_id = $1 ORDER BY code", [projectId]);
      return Response.json({ ...board, tags, contractors });
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
    assertCan(membership, ACTIONS.RECORD_QUALITY);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "punch") return Response.json({ punch: await raisePunch(db, args) });
      if (kind === "punch-action") return Response.json({ punch: await punchAction(db, args) });
      if (kind === "ncr") return Response.json({ ncr: await raiseNcr(db, args) });
      if (kind === "ncr-action") {
        return Response.json({ ncr: await ncrAction(db, {
          ...args, actorIsEngineer: can(membership, ACTIONS.APPROVE_CONCESSION) }) });
      }
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
