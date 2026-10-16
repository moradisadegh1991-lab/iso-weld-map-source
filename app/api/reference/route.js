export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import * as ref from "../../../lib/db/repos/reference.mjs";
import { PHASES, DELIVERABLES, CHECKLISTS, CERTIFICATES, STANDARDS } from "../../../lib/reference/epc.mjs";
import { APPLIES, PHASES as PRECOM_PHASES } from "../../../lib/completions/precom.mjs";

/**
 * The EPC reference and the project's adoption of it.
 *   GET                          phases, deliverables, certificates, checklists (with which are adopted), standards (+ the project's register)
 *   POST {kind:"standard"}       add/amend a project standard · {kind:"standard-remove"}
 *   POST {kind:"adopt"}          adopt a reference checklist into pre-commissioning
 */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json({
      phases: PHASES, deliverables: DELIVERABLES, certificates: CERTIFICATES, checklists: CHECKLISTS, standards: STANDARDS,
      applies: APPLIES, precomPhases: PRECOM_PHASES,
      adopted: await ref.adoptedCodes(db, { projectId }), projectStandards: await ref.listStandards(db, { projectId }),
      may: { edit: can(membership, ACTIONS.MANAGE_MEMBERS) },
    }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => {
      if (kind === "standard") return Response.json({ ok: true, row: await ref.upsertStandard(db, { ...body, projectId, userId: user.id }) });
      if (kind === "standard-remove") { await ref.removeStandard(db, { projectId, id: body.id }); return Response.json({ ok: true }); }
      if (kind === "adopt") return Response.json({ ok: true, row: await ref.adoptChecklist(db, { projectId, code: body.code }) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
