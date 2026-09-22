export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  listContractors, upsertContractor, packageProgress, lapsedWithWork, upsertPackage,
} from "../../../lib/db/repos/contractors.mjs";

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => Response.json({
      contractors: await listContractors(db, { projectId }),
      packages: await packageProgress(db, { projectId }),
      lapsed: await lapsedWithWork(db, { projectId }),
    }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);

    return await withProject(db, projectId, async () => {
      if (kind === "package") {
        return Response.json({ package: await upsertPackage(db, { ...body, projectId }) });
      }
      return Response.json({ contractor: await upsertContractor(db, { ...body, projectId }) });
    });
  } catch (e) { return errorResponse(e); }
}
