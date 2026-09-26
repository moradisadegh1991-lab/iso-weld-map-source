export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  controlsBoard, baselineHistory, costLedger, upsertAccount, setBaseline, reportProgress, postCost, upsertRisk, closeRisk,
  takeSnapshot, snapshotHistory,
} from "../../../lib/db/repos/controls.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const accountId = url.searchParams.get("accountId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (accountId) {
        return Response.json({ baselines: await baselineHistory(db, { projectId, accountId }),
          costs: await costLedger(db, { projectId, accountId }) });
      }
      const board = await controlsBoard(db, { projectId, asOf: url.searchParams.get("asOf") || null });
      const { rows: subsystems } = await db.query("SELECT id, code FROM subsystem WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: contractors } = await db.query("SELECT id, code, name FROM contractor WHERE project_id = $1 ORDER BY code", [projectId]);
      return Response.json({ ...board, subsystems, contractors, snapshots: await snapshotHistory(db, { projectId }) });
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
    assertCan(membership, ACTIONS.MANAGE_CONTROLS);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "account") return Response.json({ account: await upsertAccount(db, args) });
      if (kind === "baseline") return Response.json({ account: await setBaseline(db, args) });
      if (kind === "progress") return Response.json({ progress: await reportProgress(db, args) });
      if (kind === "cost") return Response.json({ cost: await postCost(db, args) });
      if (kind === "risk") return Response.json({ risk: await upsertRisk(db, args) });
      if (kind === "risk-close") return Response.json({ risk: await closeRisk(db, args) });
      if (kind === "snapshot") return Response.json({ snapshot: await takeSnapshot(db, { projectId, userId: user.id }) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
