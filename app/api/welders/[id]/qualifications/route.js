export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { addQualification, qualificationsOf } from "../../../../../lib/db/repos/execution.mjs";
import { resolveQualification } from "../../../../../lib/qualification/asme-ix.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

/** A welder's tickets, each resolved into the range it actually permits. */
export async function GET(request, { params }) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const rows = await qualificationsOf(db, { projectId, welderId: params.id });
      return Response.json({
        qualifications: rows.map((q) => ({ ...q, range: resolveQualification(q) })),
      });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request, { params }) {
  try {
    const body = await request.json();
    const { projectId, process, positions = [] } = body;
    if (!projectId || !process) {
      return Response.json({ error: "projectId and process are required" }, { status: 400 });
    }
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_WELDERS);

    return await withProject(db, projectId, async () => {
      const q = await addQualification(db, { ...body, projectId, welderId: params.id, positions });
      return Response.json({ qualification: q, range: resolveQualification(q) }, { status: 201 });
    });
  } catch (e) { return errorResponse(e); }
}
