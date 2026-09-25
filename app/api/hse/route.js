export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  hseBoard, incidentHistory, recordManhours, reportIncident, updateIncident, requestPermit, recordGasTest,
  activatePermit, closePermit, recordObservation, closeObservation, statistics,
} from "../../../lib/db/repos/hse.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const incidentId = url.searchParams.get("incidentId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (incidentId) return Response.json({ history: await incidentHistory(db, { projectId, incidentId }) });
      const from = url.searchParams.get("from"), to = url.searchParams.get("to");
      if (from || to) {
        return Response.json(await statistics(db, { projectId, from: from || null, to: to || null,
          today: new Date().toISOString().slice(0, 10) }));
      }
      return Response.json(await hseBoard(db, { projectId }));
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
    // Issuing a permit is a signature; everything else is recording.
    assertCan(membership, kind === "activate" ? ACTIONS.ISSUE_PERMIT : ACTIONS.RECORD_HSE);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "manhours") return Response.json({ manhours: await recordManhours(db, args) });
      if (kind === "incident") return Response.json({ incident: await reportIncident(db, args) });
      if (kind === "incident-update") return Response.json({ incident: await updateIncident(db, args) });
      if (kind === "permit") return Response.json({ permit: await requestPermit(db, args) });
      if (kind === "gas") return Response.json(await recordGasTest(db, args));
      if (kind === "activate") {
        const { now: _ignored, ...rest } = args;   // the server's clock signs, not the client's
        return Response.json({ permit: await activatePermit(db, rest) });
      }
      if (kind === "close" || kind === "cancel") {
        const { now: _ignored, ...rest } = args;
        return Response.json({ permit: await closePermit(db, { ...rest, cancel: kind === "cancel" }) });
      }
      if (kind === "observation") {
        return Response.json({ observation: await recordObservation(db, { ...args, kind: body.obsKind }) });
      }
      if (kind === "observation-close") return Response.json({ observation: await closeObservation(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
