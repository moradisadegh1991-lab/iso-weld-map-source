export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { validationFor } from "../../../lib/db/repos/validation.mjs";
import { latestRunForDocument } from "../../../lib/db/repos/runs.mjs";
import { spoolDependencies } from "../../../lib/register/spool-guard.mjs";

/**
 * The validation of one drawing revision's SAVED state (lib/engineering/validation.mjs run on the stored register, equipment, BOM ledger and warnings):
 *   GET ?projectId&documentId   → { revision, findings[], summary, payloadHash, generatedAt }
 *   GET ?projectId&documentId&spoolUid → { spool, dependents[], count, locked, payloadHash }: what rests on one spool, recomputed from the PERSISTED
 *   register (welds / typed rows / cut pieces / equipment by spoolUid). Authoritative advice: the save itself refuses a spool that is still named (409 SPOOL_IN_USE).
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
    const spoolUid = url.searchParams.get("spoolUid");
    if (spoolUid) {
      return await withProject(db, projectId, async () => {
        const run = await latestRunForDocument(db, { projectId, documentId });
        if (!run?.payload) return Response.json({ error: "no saved register for this revision", code: "NO_REGISTER" }, { status: 404 });
        return Response.json({ ...spoolDependencies(run.payload, spoolUid), runId: run.id });
      });
    }
    return await withProject(db, projectId, async () => Response.json(await validationFor(db, { projectId, documentId })));
  } catch (e) { return errorResponse(e); }
}
