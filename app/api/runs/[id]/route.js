export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { getRegister } from "../../../../lib/db/repos/runs.mjs";
import { editsOf } from "../../../../lib/db/repos/review.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";

/**
 * One run, with everything needed to open it for review.
 *
 * The payload comes back so the reviewer edits what the model actually
 * produced, the register so they can see what it built, and the edit log so
 * they can see what has already been corrected — reviewing a drawing without
 * knowing somebody else already fixed half of it wastes the scarcest resource
 * on the project.
 */
export async function GET(request, ctx) {
  const params = await ctx.params; // Next 15: route params arrive as a promise
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const { rows: [run] } = await db.query(
        `SELECT r.*, d.doc_no, d.revision, d.sheet_no, d.file_sha256,
                u.display_name AS approved_by_name
           FROM extraction_run r
           JOIN document d ON d.id = r.document_id
           LEFT JOIN app_user u ON u.id = r.approved_by
          WHERE r.id = $1 AND r.project_id = $2`,
        [params.id, projectId]);
      if (!run) return Response.json({ error: "not found" }, { status: 404 });

      return Response.json({
        run: {
          id: run.id, status: run.status, lockedAt: run.locked_at,
          engineError: run.engine_error, createdAt: run.created_at,
          model: run.model_name,
          approvedAt: run.approved_at, approvedBy: run.approved_by_name,
          approvedSha256: run.approved_sha256,
          docNo: run.doc_no, revision: run.revision, sheetNo: run.sheet_no,
          checks: run.validation_checks,
        },
        payload: run.payload,
        register: await getRegister(db, { projectId, runId: params.id }),
        edits: await editsOf(db, { projectId, runId: params.id }),
      });
    });
  } catch (e) { return errorResponse(e); }
}
