export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { reviewItem, approveDraft, confirmDraftMapping } from "../../../../lib/db/repos/pid.mjs";

/**
 * A person's decisions on a P&ID draft (lib/db/repos/pid.mjs). The model never reaches this route: it is the human review.
 *   POST { projectId, runId, uid, action: correct|approve|reject|flag|unresolved|ambiguous|reopen, value?, reason?, baseHash }   one record
 *   POST { projectId, runId, action: "approve_draft" }                                  sign off the whole draft (every record decided, no error open)
 *   POST { projectId, runId, action: "confirm_mapping", sourceRunId, fromUid, toUid, baseHash }   one explicit revision mapping, on the target draft
 * Errors are structured: 409 STALE_RUN / RUN_LOCKED / APPROVED_LOCKED / UNDECIDED / ENGINEERING_ERRORS / INVALID_MAPPING …
 * Approving records needs the right to edit; signing off the whole draft needs the register approval right (an engineer).
 */
export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    if (!b.projectId || !b.runId || !b.action) return Response.json({ error: "projectId, runId and action are required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId: b.projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, b.action === "approve_draft" ? ACTIONS.APPROVE_REGISTER : ACTIONS.EDIT_EXTRACTION);
    return await withProject(db, b.projectId, async () => {
      if (b.action === "approve_draft") return Response.json(await approveDraft(db, { projectId: b.projectId, runId: b.runId, userId: user.id }));
      if (b.action === "confirm_mapping") return Response.json(await confirmDraftMapping(db, { projectId: b.projectId, targetRunId: b.runId, sourceRunId: b.sourceRunId, fromUid: b.fromUid, toUid: b.toUid, userId: user.id, baseHash: b.baseHash || null }));
      if (!b.uid) return Response.json({ error: "uid is required" }, { status: 400 });
      return Response.json(await reviewItem(db, { projectId: b.projectId, runId: b.runId, uid: b.uid, action: b.action, value: b.value || null, reason: b.reason || null, userId: user.id, baseHash: b.baseHash || null }));
    });
  } catch (e) { return errorResponse(e); }
}
