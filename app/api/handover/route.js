export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  handoverBoard, setAssetMaster, assetMasterHistory, exportHandover, exportLog,
} from "../../../lib/db/repos/handover.mjs";

/**
 * GET              the board
 * GET ?tagId=      one tag's asset-master history
 * GET ?format=csv  the export, as a file (logged with its hash)
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    const csv = url.searchParams.get("format") === "csv";
    assertCan(membership, csv ? ACTIONS.MANAGE_HANDOVER : ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (csv) {
        const e = await exportHandover(db, { projectId, readyOnly: url.searchParams.get("readyOnly") === "1", userId: user.id });
        return new Response(e.csv, { headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="asset-master-${e.sha256.slice(0, 8)}.csv"`,
          "X-Content-Sha256": e.sha256,
        } });
      }
      const tagId = url.searchParams.get("tagId");
      if (tagId) return Response.json({ history: await assetMasterHistory(db, { projectId, tagId }) });
      return Response.json({ ...(await handoverBoard(db, { projectId })), exports: await exportLog(db, { projectId }) });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_HANDOVER);
    return await withProject(db, projectId, async () =>
      Response.json({ master: await setAssetMaster(db, { ...body, projectId, userId: user.id }) }));
  } catch (e) { return errorResponse(e); }
}
