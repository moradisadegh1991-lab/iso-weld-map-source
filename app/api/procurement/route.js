export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  procurementBoard, forecastHistory, upsertVendor, createPo, addPoLine, setForecast, recordFat, createShipment,
  arriveShipment, receiveAgainstPo, addVendorDoc, submitDoc, returnDoc,
} from "../../../lib/db/repos/procurement.mjs";
import { STAGE_FA } from "../../../lib/procurement/procurement.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const lineId = url.searchParams.get("lineId");
      if (lineId) return Response.json({ history: await forecastHistory(db, { projectId, poLineId: lineId }) });
      const { rows: items } = await db.query("SELECT id, code, description, uom FROM material_item WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: tags } = await db.query("SELECT id, tag_no FROM tag WHERE project_id = $1 AND discipline = 'equipment' ORDER BY tag_no", [projectId]);
      return Response.json({ ...(await procurementBoard(db, { projectId })), items, tags, stages: STAGE_FA });
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
    assertCan(membership, kind === "receive" ? ACTIONS.ASSIGN_WELD : kind === "fat" ? ACTIONS.RECORD_NDT : ACTIONS.MANAGE_PROCUREMENT);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      const run = {
        vendor: upsertVendor, po: createPo, line: addPoLine, forecast: setForecast, fat: recordFat, shipment: createShipment,
        arrive: arriveShipment, receive: receiveAgainstPo, doc: addVendorDoc, submit: submitDoc, review: returnDoc,
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ result: await run(db, args) });
    });
  } catch (e) { return errorResponse(e); }
}
