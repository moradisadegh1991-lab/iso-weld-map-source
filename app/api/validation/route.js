export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { validationFor } from "../../../lib/db/repos/validation.mjs";

/**
 * The validation of one drawing revision's SAVED state (lib/engineering/validation.mjs run on the stored register, equipment, BOM ledger and warnings):
 *   GET ?projectId&documentId   → { revision, findings[], summary, payloadHash, generatedAt }
 * Read-only: nothing is stored, repaired or released by asking. Fixed queries, no per-finding lookups; not cached (the answer must follow the next save).
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), documentId = url.searchParams.get("documentId");
    if (!projectId || !documentId) return Response.json({ error: "projectId and documentId are required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json(await validationFor(db, { projectId, documentId })));
  } catch (e) { return errorResponse(e); }
}
