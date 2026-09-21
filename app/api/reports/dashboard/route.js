export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";

/**
 * The same numbers Power BI reads, over HTTP.
 *
 * Power BI Report Server talking straight to PostgreSQL is the primary
 * channel and always will be — it is faster, it refreshes on a schedule and
 * it does not go through this application. This endpoint exists for the
 * people who cannot open a database connection from where they are sitting:
 * a site supervisor on a phone, a weekly progress meeting, a script.
 *
 * It reads the reporting views rather than the operational tables, so the
 * definition of "percent welded" cannot drift between the dashboard and the
 * report.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const [lines, welders, spools, gap, accuracy] = await Promise.all([
        db.query("SELECT * FROM reporting.kpi_line_progress ORDER BY line_no"),
        db.query("SELECT * FROM reporting.kpi_welder_performance ORDER BY stamp_no"),
        db.query("SELECT * FROM reporting.kpi_spool_status ORDER BY fab_status"),
        db.query("SELECT * FROM reporting.kpi_handover_gap ORDER BY line_no, weld_no LIMIT 500"),
        db.query("SELECT * FROM reporting.kpi_extraction_accuracy ORDER BY corrections DESC LIMIT 20"),
      ]);

      const totals = lines.rows.reduce((a, r) => ({
        welds: a.welds + Number(r.welds_total),
        welded: a.welded + Number(r.welds_done),
        examined: a.examined + Number(r.welds_examined),
        awaitingNdt: a.awaitingNdt + Number(r.awaiting_ndt),
      }), { welds: 0, welded: 0, examined: 0, awaitingNdt: 0 });

      return Response.json({
        totals: {
          ...totals,
          pctWelded: pct(totals.welded, totals.welds),
          pctExamined: pct(totals.examined, totals.welds),
        },
        lines: lines.rows,
        welders: welders.rows,
        spools: spools.rows,
        // Capped, because this is a list somebody works through, not a metric.
        handoverGap: gap.rows,
        handoverGapTruncated: gap.rows.length === 500,
        extractionAccuracy: accuracy.rows,
      });
    });
  } catch (e) { return errorResponse(e); }
}

const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : null);
