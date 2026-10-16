export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { mescBoard, searchMesc, importCatalogue, setItemMesc } from "../../../../lib/db/repos/mesc.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const q = url.searchParams.get("q");
      if (q !== null) return Response.json({ matches: await searchMesc(db, { projectId, q }) });
      return Response.json(await mescBoard(db, { projectId }));
    });
  } catch (e) { return errorResponse(e); }
}

// The stock catalogue is engineering's, as the item catalogue is (see /api/warehouse).
export async function POST(request) {
  try {
    const body = await request.json();
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.EDIT_EXTRACTION);
    return await withProject(db, projectId, async () => {
      if (kind === "catalogue") return Response.json(await importCatalogue(db, { ...body, projectId, userId: user.id }));
      if (kind === "item") return Response.json({ item: await setItemMesc(db, { ...body, projectId }) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
