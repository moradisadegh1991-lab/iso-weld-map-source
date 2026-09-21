export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { createRun, saveRegister, getRegister, latestRunForDocument } from "../../../lib/db/repos/runs.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { buildModel } from "../../../lib/engine.js";

/**
 * Persist an extraction and the register it produces.
 *
 * The register is recomputed here from the payload rather than accepted from
 * the client. The engine is the only thing allowed to decide where a weld
 * goes, and a browser is not a place to enforce that: a client could post any
 * register it liked. Recomputing costs microseconds and closes the hole.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { projectId, documentId, lineId = null, lineNo, payload, options = {},
            model: modelName = null, modelVersion = null, passName = null,
            inputTokens = null, outputTokens = null, rawOutputUri = null } = body;

    if (!projectId || !documentId || !payload) {
      return Response.json({ error: "projectId, documentId and payload are required" }, { status: 400 });
    }
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.RUN_EXTRACTION);

    const model = buildModel(payload, options);

    return await withProject(db, projectId, async () => {
      const run = await createRun(db, {
        projectId, documentId, lineId,
        modelName, modelVersion, passName, inputTokens, outputTokens, rawOutputUri,
        payload,
        validationChecks: model.error ? [] : model.checks,
        engineError: model.error || null,
        createdBy: user.id,
      });

      // A failed model still gets a run row — the failure is evidence too —
      // but there is no register to save.
      if (model.error) {
        return Response.json({ run, register: [], engineError: model.error }, { status: 201 });
      }

      await saveRegister(db, {
        projectId, runId: run.id, documentId, lineId,
        lineNo: lineNo || payload?.meta?.drawingNo || "unknown",
        model,
      });
      const register = await getRegister(db, { projectId, runId: run.id });
      return Response.json({
        run,
        register,
        totals: model.totals,
        spools: model.spoolIds,
        checks: model.checks,
      }, { status: 201 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** The latest run for a document, with its register. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const documentId = url.searchParams.get("documentId");
    if (!projectId || !documentId) {
      return Response.json({ error: "projectId and documentId are required" }, { status: 400 });
    }
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const run = await latestRunForDocument(db, { projectId, documentId });
      if (!run) return Response.json({ run: null, register: [] });
      return Response.json({ run, register: await getRegister(db, { projectId, runId: run.id }) });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
