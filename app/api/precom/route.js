export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import * as prc from "../../../lib/db/repos/precom.mjs";
import { APPLIES, RESULTS, RFSU_BLOCKER_FA } from "../../../lib/completions/precom.mjs";

/**
 * GET ?projectId=                      checklists and every subsystem's RFSU readiness
 * GET ?projectId=&subsystemId=         one subsystem's checks, each with its attempts
 * POST { projectId, kind, … }          template · attempt · accept · rfsu-sign · rfsu-accept
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
      const subsystemId = url.searchParams.get("subsystemId");
      if (subsystemId) return Response.json(await prc.subsystemPrecom(db, { projectId, subsystemId }));
      return Response.json({ templates: await prc.listTemplates(db, { projectId }), board: await prc.precomBoard(db, { projectId }),
        applies: APPLIES, results: RESULTS, blockerNames: RFSU_BLOCKER_FA }, { headers: { "Cache-Control": "no-store" } });
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
    // Declaring checklists and signing RFSU are engineering's (as MC is);
    // recording and accepting attempts is completions work.
    const need = { template: ACTIONS.SIGN_MC, "rfsu-sign": ACTIONS.SIGN_MC, "rfsu-accept": ACTIONS.SIGN_MC,
      attempt: ACTIONS.RECORD_COMPLETIONS, accept: ACTIONS.RECORD_COMPLETIONS }[kind];
    if (!need) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    assertCan(membership, need);
    return await withProject(db, projectId, async () => {
      const a = { ...body, projectId, userId: user.id };
      if (kind === "template") return Response.json({ template: await prc.upsertTemplate(db, a) });
      if (kind === "attempt") return Response.json({ attempt: await prc.recordAttempt(db, a) });
      if (kind === "accept") return Response.json({ attempt: await prc.acceptAttempt(db, a) });
      if (kind === "rfsu-sign") return Response.json({ rfsu: await prc.signRfsu(db, a) });
      return Response.json({ rfsu: await prc.acceptRfsu(db, a) });
    });
  } catch (e) { return errorResponse(e); }
}
