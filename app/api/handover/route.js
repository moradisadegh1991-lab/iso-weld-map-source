export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  handoverBoard, setAssetMaster, assetMasterHistory, exportHandover, exportLog,
} from "../../../lib/db/repos/handover.mjs";
import * as mt from "../../../lib/db/repos/maintenance.mjs";
import { listItems } from "../../../lib/db/repos/warehouse.mjs";

/**
 * GET                            the board (asset master and checklist)
 * GET ?tagId=                    one tag's asset-master history
 * GET ?format=csv                the asset master export, as a file (logged with its hash)
 * GET ?view=maintenance          the PM plan, spare parts and periodic calibration
 * GET ?format=csv&kind=pm_plan|spares   those exports (approved tasks only)
 * POST { kind: master | pm | pm-approve | pm-discard | spare | spare-remove | calplan, … }
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
        const kind = url.searchParams.get("kind") || "asset_master";
        const e = kind === "asset_master"
          ? await exportHandover(db, { projectId, readyOnly: url.searchParams.get("readyOnly") === "1", userId: user.id })
          : await mt.exportMaintenance(db, { projectId, kind, userId: user.id });
        const name = { asset_master: "asset-master", pm_plan: "pm-plan", spares: "spare-parts" }[kind] || kind;
        return new Response(e.csv, { headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}-${e.sha256.slice(0, 8)}.csv"`,
          "X-Content-Sha256": e.sha256,
        } });
      }
      if (url.searchParams.get("view") === "maintenance") {
        return Response.json({
          plan: await mt.pmPlan(db, { projectId }),
          spares: await mt.sparesBoard(db, { projectId }),
          calibration: await mt.calibrationBoard(db, { projectId }),
          tags: (await db.query("SELECT id, tag_no, description FROM tag WHERE project_id = $1 AND discipline = 'equipment' ORDER BY tag_no", [projectId])).rows,
          items: await listItems(db, { projectId }),
          labels: mt.LABELS,
          me: user.id,
        }, { headers: { "Cache-Control": "no-store" } });
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
    const { projectId, kind = "master" } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_HANDOVER);
    return await withProject(db, projectId, async () => {
      const a = { ...body, projectId, userId: user.id };
      if (kind === "master") return Response.json({ master: await setAssetMaster(db, a) });
      if (kind === "pm") return Response.json({ task: await mt.savePmTask(db, a) });
      if (kind === "pm-approve") return Response.json({ task: await mt.approvePmTask(db, a) });
      if (kind === "pm-discard") return Response.json(await mt.discardPmDraft(db, a));
      if (kind === "spare") return Response.json({ spare: await mt.saveSpare(db, a) });
      if (kind === "spare-remove") return Response.json(await mt.removeSpare(db, a));
      if (kind === "calplan") return Response.json({ plan: await mt.setCalibrationPlan(db, a) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
