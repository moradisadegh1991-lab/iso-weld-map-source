export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { carryForward } from "../../../../lib/db/repos/revisions.mjs";

/**
 * Controlled carry-forward from a source revision into the target revision made from it (lib/db/repos/revisions.mjs):
 *   POST { projectId, fromDocumentId, toDocumentId, fromHash, toHash, requestKey, decisions: [{ key, pair?, fields? }] }
 * `fromHash` / `toHash` are the hashes the comparison was made against (409 STALE_SOURCE / STALE_RUN when either changed). The server plans again
 * from the stored state; `decisions` only choose among what that plan allows. One transaction: all of it or none. The same `requestKey` again returns
 * the recorded result and creates nothing. 409 RUN_LOCKED on an approved target. The source revision is never written to.
 */
export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    if (!b.projectId || !b.fromDocumentId || !b.toDocumentId) return Response.json({ error: "projectId, fromDocumentId and toDocumentId are required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId: b.projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.EDIT_EXTRACTION);
    return await withProject(db, b.projectId, async () => Response.json(await carryForward(db, { projectId: b.projectId, fromDocumentId: b.fromDocumentId, toDocumentId: b.toDocumentId,
      fromHash: b.fromHash, toHash: b.toHash, requestKey: b.requestKey, decisions: b.decisions || [], userId: user.id })));
  } catch (e) { return errorResponse(e); }
}
