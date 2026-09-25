export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { fieldPack, applyOps, recentOps } from "../../../lib/db/repos/field.mjs";
import { getStore } from "../../../lib/storage/index.mjs";

// A photo is at most 5 MB, sent one per request (base64 adds a third); a
// batch without photos is far smaller.
const MAX_BODY = 8 * 1024 * 1024;

/**
 * GET  ?projectId=&subsystemId=   the field pack
 * GET  ?projectId=&recent=1       the latest operations received from site
 * POST { projectId, ops }         apply a batch captured on site (a punch
 *                                 photo carries its bytes as payload.data)
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (url.searchParams.get("recent")) return Response.json({ ops: await recentOps(db, { projectId }) });
      return Response.json(await fieldPack(db, { projectId, subsystemId: url.searchParams.get("subsystemId") || null }),
        { headers: { "Cache-Control": "no-store" } });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY) {
      return Response.json({ error: "request too large — send photos one at a time" }, { status: 413 });
    }
    const { projectId, ops } = await request.json().catch(() => ({}));
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    if (!Array.isArray(ops) || ops.length > 500) return Response.json({ error: "ops must be a list of at most 500" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    // Permission is checked per operation inside applyOps: one operation the
    // role may not make is refused on its own, the rest still apply.
    return Response.json({ results: await applyOps(db, { projectId, userId: user.id, membership, ops,
      store: await getStore() }) });
  } catch (e) { return errorResponse(e); }
}
