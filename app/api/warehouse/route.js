export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  listItems, stock, shortages, heatTrace, destinations, upsertItem, receiveLot, inspectLot, reviewMtc,
  recordMovement, setRequirement,
} from "../../../lib/db/repos/warehouse.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const heat = url.searchParams.get("heat");
    const lotId = url.searchParams.get("lotId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (heat) return Response.json(await heatTrace(db, { projectId, heatNo: heat }));
      if (lotId) return Response.json({ destinations: await destinations(db, { projectId, lotIds: [lotId] }) });
      const { rows: spools } = await db.query(
        `SELECT sp.id, sp.spool_no, l.line_no FROM spool sp
           JOIN reporting.current_run cr ON cr.run_id = sp.extraction_run_id
           LEFT JOIN line l ON l.id = sp.line_id WHERE sp.project_id = $1 ORDER BY l.line_no, sp.spool_no`, [projectId]);
      const { rows: contractors } = await db.query(
        "SELECT id, code, name FROM contractor WHERE project_id = $1 ORDER BY code", [projectId]);
      return Response.json({
        items: await listItems(db, { projectId }),
        lots: await stock(db, { projectId }),
        shortages: await shortages(db, { projectId }),
        spools, contractors,
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
    // Catalogue and MTO are engineering; inspection and MTC review are QC's
    // sign-off; receiving and issuing are site work.
    const need = ["item", "requirement"].includes(kind) ? ACTIONS.EDIT_EXTRACTION
      : ["inspect", "mtc"].includes(kind) ? ACTIONS.RECORD_NDT : ACTIONS.ASSIGN_WELD;
    assertCan(membership, need);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "item") return Response.json({ item: await upsertItem(db, args) });
      if (kind === "receive") return Response.json({ lot: await receiveLot(db, args) });
      if (kind === "inspect") return Response.json({ lot: await inspectLot(db, args) });
      if (kind === "mtc") return Response.json(await reviewMtc(db, args));
      if (kind === "issue" || kind === "return") return Response.json({ movement: await recordMovement(db, args) });
      if (kind === "requirement") return Response.json({ requirement: await setRequirement(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
