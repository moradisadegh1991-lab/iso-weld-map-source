export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { blockedTags } from "../../../lib/db/repos/activities.mjs";
import {
  importEquipmentList, unclassifiedTags, classifyTag,
} from "../../../lib/db/repos/equipment.mjs";

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const { rows: tags } = await db.query(
        `SELECT t.id, t.tag_no, t.kind, t.description, s.code AS subsystem
           FROM tag t LEFT JOIN subsystem s ON s.id = t.subsystem_id
          WHERE t.project_id = $1 AND t.discipline = 'equipment'
          ORDER BY t.tag_no`, [projectId]);
      return Response.json({
        tags,
        unclassified: await unclassifiedTags(db, { projectId }),
        blocked: await blockedTags(db, { projectId }),
      });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, tags, dryRun, tagId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.EDIT_EXTRACTION);

    return await withProject(db, projectId, async () => {
      if (tagId) {
        return Response.json({ tag: await classifyTag(db, { projectId, tagId, kind }) });
      }
      return Response.json({
        report: await importEquipmentList(db, {
          projectId, tags: tags || [], userId: user.id, dryRun: !!dryRun }),
      });
    });
  } catch (e) { return errorResponse(e); }
}
