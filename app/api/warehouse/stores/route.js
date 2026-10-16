export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { stock } from "../../../../lib/db/repos/warehouse.mjs";
import {
  reservationBoard, countBoard, reserve, releaseReservation, openCount, enterCount, decideCountLine, closeCount,
} from "../../../../lib/db/repos/reserve.mjs";

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const { rows: items } = await db.query("SELECT id, code, uom FROM material_item WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: tags } = await db.query("SELECT id, tag_no FROM tag WHERE project_id = $1 ORDER BY tag_no", [projectId]);
      const { rows: spools } = await db.query("SELECT id, spool_no FROM spool WHERE project_id = $1 ORDER BY spool_no", [projectId]);
      const lots = (await stock(db, { projectId })).map((l) => ({ id: l.id, itemId: l.itemId, code: l.code, uom: l.uom,
        receiptNo: l.receiptNo, heatNo: l.heatNo, location: l.location, onHand: l.onHand, inspection: l.inspection }));
      return Response.json({
        reservations: await reservationBoard(db, { projectId }), counts: await countBoard(db, { projectId }),
        items, lots, tags, spools,
      });
    });
  } catch (e) { return errorResponse(e); }
}

// Reserving and counting are store work; changing the book after a count is an approval.
const APPROVAL = new Set(["count-decide", "count-close"]);

export async function POST(request) {
  try {
    const body = await request.json();
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, APPROVAL.has(kind) ? ACTIONS.MANAGE_CONTROLS : ACTIONS.ASSIGN_WELD);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      const run = {
        reserve, release: releaseReservation, "count-open": openCount, "count-enter": enterCount,
        "count-decide": decideCountLine, "count-close": closeCount,
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ result: await run(db, args) });
    });
  } catch (e) { return errorResponse(e); }
}
