export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { blockedTags, tagStatus, recordActivity } from "../../../lib/db/repos/activities.mjs";
import { holdsFor } from "../../../lib/db/repos/inspection.mjs";
import {
  importEquipmentList, unclassifiedTags, classifyTag,
} from "../../../lib/db/repos/equipment.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const tagId = url.searchParams.get("tagId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      // One machine's chain: what is done, what is next, and which step an
      // ITP hold point is still holding — so the page shows «waiting on the
      // inspection» instead of a button the server will refuse.
      if (tagId) {
        const status = await tagStatus(db, { projectId, tagId });
        const hold = await holdsFor(db, { projectId });
        const holds = Object.fromEntries((status.steps || []).map((s) => [s.code, hold(status.tag.kind, "tag", tagId, s.code)])
          .filter(([, h]) => h));
        return Response.json({ status, holds });
      }
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
    // Recording what happened on site (set, grout, alignment…) is the
    // grant that already means that; importing and classifying the list is
    // an engineering act.
    assertCan(membership, kind === "activity" ? ACTIONS.ASSIGN_WELD : ACTIONS.EDIT_EXTRACTION);

    return await withProject(db, projectId, async () => {
      if (kind === "activity") {
        const { code, doneAt, refNo = null } = body;
        return Response.json({ activity: await recordActivity(db, { projectId, tagId, code, doneAt, refNo, userId: user.id }) });
      }
      if (kind === "classify") {
        return Response.json({ tag: await classifyTag(db, { projectId, tagId, kind: body.tagKind }) });
      }
      return Response.json({
        report: await importEquipmentList(db, {
          projectId, tags: tags || [], userId: user.id, dryRun: !!dryRun }),
      });
    });
  } catch (e) { return errorResponse(e); }
}
