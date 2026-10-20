export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { listLoads, loadDetail, createLoad, setLoadStatus, addLoadSpools, removeLoadSpool, addLoadItem,
  packingListOf, drawingLabels } from "../../../../lib/db/repos/piping-reports.mjs";
import { toXlsx } from "../../../../lib/piping/reports.mjs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * GET ?projectId                       the loads, and the spools on none
 *     ?projectId&loadId                one load: its spools and ship-loose items
 *     ?projectId&loadId&export=packing its packing list (.xlsx)
 *     ?projectId&labels=1[&loadId|&transmittal]  what the drawing labels print
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const loadId = url.searchParams.get("loadId");
    return await withProject(db, projectId, async () => {
      if (url.searchParams.get("labels")) {
        return Response.json({ labels: await drawingLabels(db, { projectId, loadId, transmittal: url.searchParams.get("transmittal") }) });
      }
      if (loadId && url.searchParams.get("export") === "packing") {
        const spec = await packingListOf(db, { projectId, loadId });
        const no = spec.sheets[0].rows.find((r) => r[0] === "Load")?.[1] || "load";
        return new Response(toXlsx(spec), { headers: { "Content-Type": XLSX_TYPE,
          "Content-Disposition": `attachment; filename="${`${no}-Packing-List`.replace(/[^\w.-]+/g, "_")}.xlsx"` } });
      }
      if (loadId) return Response.json(await loadDetail(db, { projectId, loadId }));
      return Response.json(await listLoads(db, { projectId }));
    });
  } catch (e) { return errorResponse(e); }
}

/**
 * POST { projectId, kind, … }
 *   create        { loadNo, destination?, notes? }
 *   status        { loadId, status: pending|shipped|delivered, on }
 *   add_spools    { loadId, spoolIds }
 *   remove_spool  { loadId, spoolId }
 *   add_item      { loadId, item: { description, qty, uom, drawingRef?, itemNo?, notes? } }
 * ASSIGN_WELD is the grant that records site and shop work (see
 * app/api/piping/execution/route.js); shipping a spool is that work.
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
      const a = { projectId, loadId: body.loadId };
      if (kind === "create") return Response.json({ load: await createLoad(db, { projectId, userId: user.id, loadNo: body.loadNo, destination: body.destination, notes: body.notes }) });
      if (kind === "status") return Response.json({ load: await setLoadStatus(db, { ...a, status: body.status, on: body.on }) });
      if (kind === "add_spools") return Response.json(await addLoadSpools(db, { ...a, spoolIds: body.spoolIds, userId: user.id }));
      if (kind === "remove_spool") return Response.json(await removeLoadSpool(db, { ...a, spoolId: body.spoolId }));
      if (kind === "add_item") return Response.json(await addLoadItem(db, { ...a, item: body.item }));
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
