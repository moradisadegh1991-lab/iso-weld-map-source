export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { setSpoolStatus } from "../../../../../lib/db/repos/runs.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

const ALLOWED = ["planned", "released", "fabricated", "tested", "painted", "shipped", "erected"];

/**
 * Record that a spool has moved along the shop floor.
 *
 * This is what turns a revision diff from a list into a bill: a spool still
 * marked `planned` absorbs a drawing change for free, one marked `fabricated`
 * absorbs it as cut-and-reweld. QC records it, because QC is who sees it
 * happen.
 */
export async function POST(request, { params }) {
  try {
    const { projectId, status, note = null } = await request.json();
    if (!projectId || !status) {
      return Response.json({ error: "projectId and status are required" }, { status: 400 });
    }
    if (!ALLOWED.includes(status)) {
      return Response.json(
        { error: `status must be one of: ${ALLOWED.join(", ")}` }, { status: 400 });
    }

    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.RECORD_NDT);

    return await withProject(db, projectId, async () => {
      const spool = await setSpoolStatus(db, {
        projectId, spoolId: params.id, status, note, userId: user.id });
      return Response.json({ spool });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
