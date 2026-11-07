export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { listEquipment, setAccessoryStatus } from "../../../lib/db/repos/iso-equipment.mjs";
import { assertIsometricDocument, assertIsometricAccessory } from "../../../lib/db/run-scope.mjs";

/**
 * Installation equipment's register of a drawing revision (lib/db/repos/iso-equipment.mjs):
 *   GET   ?projectId&documentId                  each item with its welds and accessories
 *   POST  { projectId, accessoryId, status }     an accessory's installation status, apart from its equipment's
 * The items themselves are made by saving the register (app/api/runs) from the sheet's marks.
 */
async function scope(request, projectId, action) {
  const { db, membership } = await authenticate(request, { projectId });
  if (!membership) throw Object.assign(new Error("not found"), { status: 404 });
  assertCan(membership, action);
  return { db };
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), documentId = url.searchParams.get("documentId");
    if (!projectId || !documentId) return Response.json({ error: "projectId and documentId are required" }, { status: 400 });
    const { db } = await scope(request, projectId, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      await assertIsometricDocument(db, { projectId, documentId, allowMissing: true });
      return Response.json({ equipment: await listEquipment(db, { projectId, documentId }) });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.projectId || !body.accessoryId) return Response.json({ error: "projectId and accessoryId are required" }, { status: 400 });
    const { db } = await scope(request, body.projectId, ACTIONS.EDIT_EXTRACTION);
    return await withProject(db, body.projectId, async () => {
      await assertIsometricAccessory(db, { projectId: body.projectId, accessoryId: body.accessoryId });     // the accessory's own drawing, from the database, before any write
      await setAccessoryStatus(db, { projectId: body.projectId, accessoryId: body.accessoryId, status: body.status });
      return Response.json({ ok: true });
    });
  } catch (e) { return errorResponse(e); }
}
