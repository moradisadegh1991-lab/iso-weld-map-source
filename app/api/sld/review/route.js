export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { editDraft, approveDraft, decideItem } from "../../../../lib/db/repos/sld.mjs";
import { LIMITS } from "../../../../lib/sld/envelope.mjs";

/**
 * A person's decisions on an SLD draft (Phase 12.2). No per-record review exists yet (that is Phase 12.3).
 *   POST { projectId, runId, action: "edit", draft, baseHash, reason? }   replace the envelope; `baseHash` is the draft's payloadHash as read → 409 STALE_RUN if it changed
 *   POST { projectId, runId, action: "decide", uid, decision: confirm|reject|reclassify|set, cls?, attrs?, reason?, baseHash }   (Phase 12.3) one item of an extraction draft, evidence kept
 *   POST { projectId, runId, action: "approve" }                           sign and LOCK the draft (409 RUN_LOCKED afterwards); promotes nothing into any register
 * Editing needs the right to edit; signing needs the register approval right (an engineer).
 */
export async function POST(request) {
  try {
    const raw = await request.text();
    if (raw.length > LIMITS.bytes * 1.5) return Response.json({ error: "the request body is too large", code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    let b; try { b = JSON.parse(raw); } catch { b = null; }
    if (!b || typeof b !== "object") return Response.json({ error: "a JSON body is required" }, { status: 400 });
    if (!b.projectId || !b.runId || !b.action) return Response.json({ error: "projectId, runId and action are required" }, { status: 400 });
    if (!["edit", "approve", "decide"].includes(b.action)) return Response.json({ error: `unknown action «${String(b.action).slice(0, 30)}»` }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId: b.projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, b.action === "approve" ? ACTIONS.APPROVE_REGISTER : ACTIONS.EDIT_EXTRACTION);
    return await withProject(db, b.projectId, async () => {
      if (b.action === "decide") return Response.json(await decideItem(db, { projectId: b.projectId, runId: b.runId, baseHash: b.baseHash, uid: b.uid, decision: b.decision, cls: b.cls ?? null, attrs: b.attrs ?? null, reason: b.reason ?? null, userId: user.id }));
      if (b.action === "approve") return Response.json(await approveDraft(db, { projectId: b.projectId, runId: b.runId, userId: user.id }));
      return Response.json(await editDraft(db, { projectId: b.projectId, runId: b.runId, draft: b.draft, baseHash: b.baseHash, reason: b.reason ?? null, userId: user.id }));
    });
  } catch (e) { return errorResponse(e); }
}
