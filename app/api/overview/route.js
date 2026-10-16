export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";

/**
 * The numbers on the launchpad.
 *
 * One round trip rather than six: the home screen is the page people open
 * most, and six parallel requests each opening their own project scope is
 * six times the work for the same answer.
 *
 * Every count is derived from the reporting views, so the launchpad and the
 * detail pages cannot disagree — a dashboard that says 12 and a list that
 * shows 11 destroys trust in both.
 */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });

    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const one = async (sql, params = [projectId]) => (await db.query(sql, params)).rows[0];

      const subsystems = await one(
        `SELECT COUNT(DISTINCT subsystem_key)::int AS total,
                COUNT(DISTINCT subsystem_key) FILTER (WHERE pct_ready = 100)::int AS ready
           FROM reporting.kpi_subsystem_readiness
          WHERE project_key = $1 AND subsystem_key IS NOT NULL`);

      const contractors = await one(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE prequalification_expired AND packages > 0)::int AS lapsed
           FROM reporting.dim_contractor WHERE project_key = $1`);

      const tags = await one(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE kind IS NULL)::int AS unclassified
           FROM tag WHERE project_id = $1`);

      const welds = await one(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_welded)::int   AS welded,
                COUNT(*) FILTER (WHERE is_examined)::int AS tested,
                COUNT(*) FILTER (WHERE awaiting_ndt)::int AS awaiting_ndt
           FROM reporting.fact_weld WHERE project_key = $1`);

      const documents = await one(
        `SELECT COUNT(DISTINCT d.id)::int AS total,
                COUNT(DISTINCT r.document_id) FILTER (WHERE r.status = 'approved')::int AS approved
           FROM document d
           LEFT JOIN extraction_run r ON r.document_id = d.id
          WHERE d.project_id = $1`);

      return Response.json({
        subsystems, contractors, tags,
        welds: { ...welds, awaitingNdt: welds.awaiting_ndt },
        documents,
      });
    });
  } catch (e) { return errorResponse(e); }
}
