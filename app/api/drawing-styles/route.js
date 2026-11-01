export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { listStyles, saveStyle, deleteStyle } from "../../../lib/db/repos/drawing-styles.mjs";

/**
 * A project's drawing-style templates (lib/db/repos/drawing-styles.mjs):
 *   GET    ?projectId           the templates
 *   POST   { projectId, name, fingerprint, fields, sample }   save one by name
 *   DELETE ?projectId&id        remove one
 * Marking a template is part of reading drawings, so it takes the same right.
 */
async function scope(request, projectId, action) {
  const { db, user, membership } = await authenticate(request, { projectId });
  if (!membership) throw Object.assign(new Error("not found"), { status: 404 });
  assertCan(membership, action);
  return { db, user };
}

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db } = await scope(request, projectId, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json({ styles: await listStyles(db, { projectId }) }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user } = await scope(request, body.projectId, ACTIONS.RUN_EXTRACTION);
    return await withProject(db, body.projectId, async () => Response.json({ style: await saveStyle(db, {
      projectId: body.projectId, name: body.name, fingerprint: body.fingerprint, fields: body.fields, sample: body.sample, userId: user.id }) }, { status: 201 }));
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), id = url.searchParams.get("id");
    if (!projectId || !id) return Response.json({ error: "projectId and id are required" }, { status: 400 });
    const { db } = await scope(request, projectId, ACTIONS.RUN_EXTRACTION);
    return await withProject(db, projectId, async () => Response.json({ deleted: await deleteStyle(db, { projectId, id }) }));
  } catch (e) { return errorResponse(e); }
}
