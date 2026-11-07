export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { warningsFor, resolveWarning } from "../../../lib/db/repos/validation.mjs";

/**
 * Stored identity / link warnings of a drawing revision (sheet_mark_warning):
 *   GET   ?projectId&documentId                       open and resolved ones (the history stays)
 *   POST  { projectId, documentId, warningId, resolution, baseHash? }   resolve ONE — only after the relationship exists in the saved register
 * Resolving writes the resolution note, who and when; it never links, unlinks, renumbers or releases anything. 409 RUN_LOCKED on an approved
 * revision, 409 STALE_RUN when the register changed since `baseHash`, 409 WARNING_NOT_RESOLVABLE when the relationship is not there yet.
 */
async function scope(request, projectId, action) {
  const { db, user, membership } = await authenticate(request, { projectId });
  if (!membership) throw Object.assign(new Error("not found"), { status: 404 });
  assertCan(membership, action);
  return { db, user };
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), documentId = url.searchParams.get("documentId");
    if (!projectId || !documentId) return Response.json({ error: "projectId and documentId are required" }, { status: 400 });
    const { db } = await scope(request, projectId, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json({ warnings: await warningsFor(db, { projectId, documentId }) }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.projectId || !body.documentId || !body.warningId) return Response.json({ error: "projectId, documentId and warningId are required" }, { status: 400 });
    const { db, user } = await scope(request, body.projectId, ACTIONS.EDIT_EXTRACTION);
    return await withProject(db, body.projectId, async () => db.transaction(async (tx) =>
      Response.json(await resolveWarning(tx, { projectId: body.projectId, documentId: body.documentId, warningId: body.warningId, resolution: body.resolution, userId: user.id, baseHash: body.baseHash || null }))));
  } catch (e) { return errorResponse(e); }
}
