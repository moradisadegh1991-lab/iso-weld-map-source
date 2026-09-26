export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import * as prc from "../../../lib/db/repos/precom.mjs";
import * as pf from "../../../lib/db/repos/performance.mjs";
import { APPLIES, PHASES, RESULTS, RFSU_BLOCKER_FA } from "../../../lib/completions/precom.mjs";

/**
 * GET ?projectId=                      checklists, every subsystem's RFC/RFSU readiness, and the performance tests
 * GET ?projectId=&subsystemId=         one subsystem's checks, each with its attempts
 * POST { projectId, kind, … }          template · attempt · accept · rfc-sign · rfc-accept · rfsu-sign · rfsu-accept
 *                                      guarantee · perf-test · perf-result · perf-sign · perf-accept
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
        performance: await pf.performanceBoard(db, { projectId }),
        applies: APPLIES, phases: PHASES, results: RESULTS, blockerNames: RFSU_BLOCKER_FA }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (e) { return errorResponse(e); }
}

const NEED = {
  template: ACTIONS.SIGN_MC, "rfc-sign": ACTIONS.SIGN_MC, "rfc-accept": ACTIONS.SIGN_MC,
  "rfsu-sign": ACTIONS.SIGN_MC, "rfsu-accept": ACTIONS.SIGN_MC,
  guarantee: ACTIONS.SIGN_MC, "perf-sign": ACTIONS.SIGN_MC, "perf-accept": ACTIONS.SIGN_MC,
  attempt: ACTIONS.RECORD_COMPLETIONS, accept: ACTIONS.RECORD_COMPLETIONS,
  "perf-test": ACTIONS.RECORD_COMPLETIONS, "perf-result": ACTIONS.RECORD_COMPLETIONS,
};

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    // Declaring checklists and guarantees and signing certificates are
    // engineering's (as MC is); recording attempts and measurements is
    // completions work.
    const need = Object.hasOwn(NEED, kind) ? NEED[kind] : null;
    if (!need) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    assertCan(membership, need);
    return await withProject(db, projectId, async () => {
      const a = { ...body, projectId, userId: user.id };
      if (kind === "template") return Response.json({ template: await prc.upsertTemplate(db, a) });
      if (kind === "attempt") return Response.json({ attempt: await prc.recordAttempt(db, a) });
      if (kind === "accept") return Response.json({ attempt: await prc.acceptAttempt(db, a) });
      if (kind === "rfc-sign") return Response.json({ rfc: await prc.signRfc(db, a) });
      if (kind === "rfc-accept") return Response.json({ rfc: await prc.acceptRfc(db, a) });
      if (kind === "rfsu-sign") return Response.json({ rfsu: await prc.signRfsu(db, a) });
      if (kind === "rfsu-accept") return Response.json({ rfsu: await prc.acceptRfsu(db, a) });
      if (kind === "guarantee") return Response.json({ guarantee: await pf.upsertGuarantee(db, a) });
      if (kind === "perf-test") {
        const { now: _ignored, ...rest } = a;   // the server's clock, not the client's
        return Response.json({ test: await pf.recordTest(db, rest) });
      }
      if (kind === "perf-result") return Response.json({ result: await pf.recordResult(db, a) });
      if (kind === "perf-sign") return Response.json({ test: await pf.signTest(db, a) });
      return Response.json({ test: await pf.acceptTest(db, a) });
    });
  } catch (e) { return errorResponse(e); }
}
