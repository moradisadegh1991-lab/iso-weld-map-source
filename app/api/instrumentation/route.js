export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  instrumentBoard, instrumentStatus, importInstrumentIndex, correctInstrument,
  recordInstrumentActivity, recordCalibration, recordLoopCheck,
} from "../../../lib/db/repos/instrumentation.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const instrumentId = url.searchParams.get("instrumentId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      if (instrumentId) return Response.json({ status: await instrumentStatus(db, { projectId, instrumentId }) });
      const { rows: [p] } = await db.query("SELECT calibration_tolerance_pct FROM project WHERE id = $1", [projectId]);
      const { rows: tags } = await db.query(
        "SELECT id, tag_no FROM tag WHERE project_id = $1 AND discipline = 'equipment' ORDER BY tag_no", [projectId]);
      return Response.json({
        ...(await instrumentBoard(db, { projectId })),
        spec: { tolerancePct: p?.calibration_tolerance_pct == null ? null : Number(p.calibration_tolerance_pct) },
        tags,
      });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    // Importing and correcting the index is engineering; calibrations,
    // installation and loop checks are site QC.
    assertCan(membership, ["import", "correct"].includes(kind) ? ACTIONS.EDIT_EXTRACTION : ACTIONS.ASSIGN_WELD);

    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "import") return Response.json(await importInstrumentIndex(db, args));
      if (kind === "correct") return Response.json({ instrument: await correctInstrument(db, args) });
      if (kind === "activity") return Response.json({ activity: await recordInstrumentActivity(db, args) });
      if (kind === "calibration") return Response.json({ calibration: await recordCalibration(db, args) });
      if (kind === "loop") return Response.json({ loop: await recordLoopCheck(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
