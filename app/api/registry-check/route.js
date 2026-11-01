export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { registryCheck } from "../../../lib/db/repos/line-list.mjs";

/**
 * POST { projectId, docNo, sheet, rev, lineNo, lineData } — a sheet read off
 * a drawing against what the project has on file, before it is saved: is
 * this drawing, sheet and revision registered (and its register saved or
 * approved), which revision of the sheet is in force, is the line
 * registered, and where the line list read on the sheet differs from the
 * line's (lib/db/repos/line-list.mjs). It changes nothing.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    if (!body.docNo && !body.lineNo) return Response.json({ error: "شمارهٔ نقشه یا شمارهٔ خط لازم است." }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json(await registryCheck(db, {
      projectId, docNo: body.docNo || null, sheet: body.sheet || "1/1", rev: body.rev || null, lineNo: body.lineNo || null,
      lineData: body.lineData && typeof body.lineData === "object" ? body.lineData : {} })));
  } catch (e) {
    return errorResponse(e);
  }
}
