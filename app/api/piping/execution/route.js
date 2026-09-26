export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { spoolMaterial, reserveSpoolMaterial } from "../../../../lib/db/repos/spool-material.mjs";
import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import {
  spoolBoard, spoolStatus, recordSpoolActivity, upsertSupport, markSupport,
  listSupports, buriedExposure,
} from "../../../../lib/db/repos/piping-execution.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const spoolId = url.searchParams.get("spoolId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      if (spoolId) return Response.json({ ...(await spoolStatus(db, { projectId, spoolId })), material: await spoolMaterial(db, { projectId, spoolId }) });
      const { rows: [p] } = await db.query(
        "SELECT grade_elevation_mm, elevation_datum FROM project WHERE id = $1", [projectId]);
      return Response.json({
        board: await spoolBoard(db, { projectId }),
        supports: await listSupports(db, { projectId }),
        buried: await buriedExposure(db, { projectId }),
        grade: p?.grade_elevation_mm == null ? null : Number(p.grade_elevation_mm),
        datum: p?.elevation_datum || null,
      });
    });
  } catch (e) { return errorResponse(e); }
}

/**
 * Recording site progress.
 *
 * ASSIGN_WELD is the grant that already means "records what happened on
 * site" — engineers and QC hold it, viewers do not. Inventing a new action
 * for the same people would put the permission model in two places.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.ASSIGN_WELD);

    return await withProject(db, projectId, async () => {
      if (kind === "reserve_material") {
        return Response.json({ result: await reserveSpoolMaterial(db, { projectId, spoolId: body.spoolId, needBy: body.needBy || null, userId: user.id }) });
      }
      if (kind === "activity") {
        return Response.json({ activity: await recordSpoolActivity(db,
          { ...body, projectId, userId: user.id }) });
      }
      if (kind === "support") {
        // `kind` routes this request; the support's own type is `supportKind`.
        return Response.json({ support: await upsertSupport(db,
          { ...body, kind: body.supportKind, projectId }) });
      }
      if (kind === "support_mark") {
        return Response.json({ support: await markSupport(db,
          { ...body, projectId, userId: user.id }) });
      }
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
