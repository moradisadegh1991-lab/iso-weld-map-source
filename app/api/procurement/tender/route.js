export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import {
  mrBoard, vdtBoard, createMr, addMrLine, removeMrLine, issueMr, reviseMr, recordBid, evaluateBid, awardMr,
  setTemplate, submitVdt, reviewVdt,
} from "../../../../lib/db/repos/tender.mjs";
import { TECH_STATUS, ATTR_TYPES } from "../../../../lib/procurement/tender.mjs";
import { ISO14224_CLASSES } from "../../../../lib/cmms/handover.mjs";

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const { rows: vendors } = await db.query("SELECT id, code, name FROM vendor WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: items } = await db.query("SELECT id, code, description, uom FROM material_item WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: tags } = await db.query("SELECT id, tag_no FROM tag WHERE project_id = $1 AND discipline = 'equipment' ORDER BY tag_no", [projectId]);
      return Response.json({
        mrs: await mrBoard(db, { projectId }), vdt: await vdtBoard(db, { projectId }),
        vendors, items, tags, techStatus: TECH_STATUS, attrTypes: ATTR_TYPES, isoClasses: ISO14224_CLASSES,
      });
    });
  } catch (e) { return errorResponse(e); }
}

// The asset data a vendor sends is maintenance's to define and accept; the tender is procurement's.
const HANDOVER_KINDS = new Set(["vdt-template", "vdt-review"]);

export async function POST(request) {
  try {
    const body = await request.json();
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, HANDOVER_KINDS.has(kind) ? ACTIONS.MANAGE_HANDOVER : ACTIONS.MANAGE_PROCUREMENT);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      const run = {
        mr: createMr, "mr-line": addMrLine, "mr-line-remove": removeMrLine, "mr-issue": issueMr, "mr-revise": reviseMr,
        bid: recordBid, "bid-eval": evaluateBid, award: awardMr,
        "vdt-template": setTemplate, "vdt-submit": submitVdt, "vdt-review": reviewVdt,
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ result: await run(db, args) });
    });
  } catch (e) { return errorResponse(e); }
}
