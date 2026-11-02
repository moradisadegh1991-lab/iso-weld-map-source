export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { availability, history, transition } from "../../../lib/db/repos/bom-allocation.mjs";
import { approvedRunFor } from "../../../lib/db/repos/review.mjs";

/**
 * Who uses what of a drawing revision's BOM (lib/db/repos/bom-allocation.mjs):
 *   GET   ?projectId&documentId[&history=1]   per BOM row: ceilings, reserved, installed, left;
 *                                             the active lines; with history=1 the events too
 *   POST  { projectId, documentId, allocationId, action: install|return|release, reason }
 * Reservations are made by saving the register (app/api/runs) from the sheet's marks; this
 * is where a line is installed, returned or released on purpose. Releasing changes the
 * register's own numbers, so it is closed on an approved revision; installing and returning
 * are site progress and stay open.
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
    return await withProject(db, projectId, async () => Response.json({
      ...(await availability(db, { projectId, documentId })),
      ...(url.searchParams.get("history") ? { history: await history(db, { projectId, documentId }) } : {}) }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.projectId || !body.documentId || !body.allocationId) return Response.json({ error: "projectId, documentId and allocationId are required" }, { status: 400 });
    const { db, user } = await scope(request, body.projectId, ACTIONS.EDIT_EXTRACTION);
    return await withProject(db, body.projectId, async () => db.transaction(async (tx) => {
      if (body.action === "release" && await approvedRunFor(tx, { projectId: body.projectId, documentId: body.documentId })) {
        return Response.json({ error: "رجیستر این رویژن تأیید شده؛ رزرو آن آزاد نمی‌شود. رویژن جدید ثبت کنید." }, { status: 409 });
      }
      await transition(tx, { projectId: body.projectId, documentId: body.documentId, allocationId: body.allocationId, action: body.action, reason: body.reason, userId: user.id });
      return Response.json({ ...(await availability(tx, { projectId: body.projectId, documentId: body.documentId })) });
    }));
  } catch (e) { return errorResponse(e); }
}
