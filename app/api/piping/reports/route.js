export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { pipingReport, REPORT_KINDS } from "../../../../lib/db/repos/piping-reports.mjs";
import { toXlsx, WELD_LOG_TEMPLATE } from "../../../../lib/piping/reports.mjs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NAMES = { "weld-log": "Weld_Log", bom: "BOM", ndt: "NDT_Metrics", progress: "Progress" };

/**
 * GET ?projectId&kind=weld-log|bom|ndt|progress[&drawing=<no>] — the report
 * as an .xlsx, built from the governing registers with no model in the path
 * (lib/piping/reports.mjs). kind=template is the blank weld-log template.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const kind = url.searchParams.get("kind");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    if (kind !== "template" && !REPORT_KINDS.includes(kind)) return Response.json({ error: `unknown report: ${kind}` }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const { rows: [p] } = await db.query("SELECT code FROM project WHERE id = $1", [projectId]);
      const drawing = url.searchParams.get("drawing") || null;
      const spec = kind === "template"
        ? { sheets: [{ name: "Weld Log", rows: [WELD_LOG_TEMPLATE], cols: WELD_LOG_TEMPLATE.map(() => 12) }] }
        : await pipingReport(db, { projectId, kind, drawingNo: drawing });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1_");
      const name = kind === "template" ? "weld-log-template.xlsx"
        : `${p.code}_${drawing ? `${drawing}_` : ""}${NAMES[kind]}_${stamp}.xlsx`.replace(/[^\w.-]+/g, "_");
      return new Response(toXlsx(spec), { headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${name}"` } });
    });
  } catch (e) { return errorResponse(e); }
}
