export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import { valueLists, saveValueList, resetValueList } from "../../../lib/db/repos/value-lists.mjs";

/**
 * A project's picking lists (lib/db/repos/value-lists.mjs):
 *   GET    ?projectId               every list, the project's own or the built-in values
 *   POST   { projectId, key, items } save one list whole
 *   DELETE ?projectId&key           back to the built-in values
 * Anyone on the project reads them; changing them is the piping data admin's
 * (the same right as the piping classes).
 */
async function scope(request, projectId, action) {
  const { db, user, membership } = await authenticate(request, { projectId });
  if (!membership) throw Object.assign(new Error("not found"), { status: 404 });
  assertCan(membership, action);
  return { db, user, membership };
}

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await scope(request, projectId, ACTIONS.VIEW_PROJECT);
    const may = can(membership, ACTIONS.MANAGE_PIPING_CLASS);
    return await withProject(db, projectId, async () => Response.json({ lists: await valueLists(db, { projectId }), may }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.projectId || !body.key) return Response.json({ error: "projectId and key are required" }, { status: 400 });
    const { db, user } = await scope(request, body.projectId, ACTIONS.MANAGE_PIPING_CLASS);
    return await withProject(db, body.projectId, async () => Response.json({
      items: await saveValueList(db, { projectId: body.projectId, key: body.key, items: body.items, userId: user.id }) }));
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), key = url.searchParams.get("key");
    if (!projectId || !key) return Response.json({ error: "projectId and key are required" }, { status: 400 });
    const { db } = await scope(request, projectId, ACTIONS.MANAGE_PIPING_CLASS);
    return await withProject(db, projectId, async () => Response.json({ reset: await resetValueList(db, { projectId, key }) }));
  } catch (e) { return errorResponse(e); }
}
