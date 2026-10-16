export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  coatingBoard, coatingStatus, upsertSystem, assignCoating, setItemArea, recordCoating, recordCoatingActivity,
} from "../../../lib/db/repos/coating.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const itemId = url.searchParams.get("itemId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      if (itemId) return Response.json({ status: await coatingStatus(db, { projectId, itemId }) });
      const { rows: [p] } = await db.query(
        "SELECT coating_dewpoint_margin_c, coating_max_rh_pct FROM project WHERE id = $1", [projectId]);
      return Response.json({
        ...(await coatingBoard(db, { projectId })),
        spec: { marginC: p?.coating_dewpoint_margin_c == null ? 3 : Number(p.coating_dewpoint_margin_c),
                marginStated: p?.coating_dewpoint_margin_c != null,
                maxRh: p?.coating_max_rh_pct == null ? null : Number(p.coating_max_rh_pct) },
      });
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
    // Systems, assignments and areas are engineering; the inspector's
    // measurements and sign-offs are site QC.
    assertCan(membership, ["system", "assign", "area"].includes(kind) ? ACTIONS.EDIT_EXTRACTION : ACTIONS.ASSIGN_WELD);

    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "system") return Response.json({ system: await upsertSystem(db, args) });
      if (kind === "assign") return Response.json(await assignCoating(db, args));
      if (kind === "area") return Response.json({ item: await setItemArea(db, args) });
      if (kind === "record") return Response.json({ record: await recordCoating(db, { ...args, kind: body.recordKind }) });
      if (kind === "activity") return Response.json({ activity: await recordCoatingActivity(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
