export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  cableBoard, cableStatus, importCableSchedule, correctCable, recordCableActivity, recordIrTest,
} from "../../../lib/db/repos/electrical.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const cableId = url.searchParams.get("cableId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      if (cableId) return Response.json({ status: await cableStatus(db, { projectId, cableId }) });
      const { rows: [p] } = await db.query(
        "SELECT lv_system_voltage_v, mv_ir_test_voltage_v, mv_ir_min_mohm FROM project WHERE id = $1",
        [projectId]);
      const { rows: tags } = await db.query(
        `SELECT id, tag_no FROM tag WHERE project_id = $1 AND discipline IN ('equipment', 'electrical')
          ORDER BY tag_no`, [projectId]);
      return Response.json({
        cables: await cableBoard(db, { projectId }),
        spec: { lvSystemVoltageV: p?.lv_system_voltage_v ?? null, mvTestVoltageV: p?.mv_ir_test_voltage_v ?? null,
                mvMinMohm: p?.mv_ir_min_mohm == null ? null : Number(p.mv_ir_min_mohm) },
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

    // Importing and correcting the schedule is engineering; recording work
    // and tests is site QC — the same split as civil and structural.
    assertCan(membership, ["import", "correct"].includes(kind) ? ACTIONS.EDIT_EXTRACTION : ACTIONS.ASSIGN_WELD);

    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "import") return Response.json(await importCableSchedule(db, args));
      if (kind === "correct") return Response.json({ cable: await correctCable(db, args) });
      if (kind === "activity") return Response.json({ activity: await recordCableActivity(db, args) });
      if (kind === "ir") return Response.json({ test: await recordIrTest(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
