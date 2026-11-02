export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { tieInTargets, resolveTieIns } from "../../../lib/db/repos/joint.mjs";
import { groupTargets, parseRef, formatRef } from "../../../lib/sheet/tie-in.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";

/** GET ?projectId=   the project's isometrics → sheets → weld numbers, to pick a Tie-in target from. */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () =>
      Response.json({ isometrics: groupTargets(await tieInTargets(db, { projectId })) }));
  } catch (e) { return errorResponse(e); }
}

/**
 * POST { projectId, refs: [ "ISO | 2/3 | W5", … ] }   where each reference stands now: ok / renamed (with the
 * reference to put in its place) / gone / missing. A reference to this same sheet, or a free note, is not asked about.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, refs } = body;
    if (!projectId || !Array.isArray(refs)) return Response.json({ error: "projectId and refs are required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const parsed = refs.map((r) => ({ ref: String(r), p: parseRef(r) })).filter((x) => x.p.doc && x.p.weld);
    return await withProject(db, projectId, async () => {
      const res = await resolveTieIns(db, { projectId, refs: parsed.map((x) => x.p) });
      return Response.json({ results: parsed.map((x, i) => ({ ref: x.ref, status: res[i].status, ...(res[i].current ? { current: formatRef({ ...res[i].current, uid: x.p.uid }) } : {}) })) });
    });
  } catch (e) { return errorResponse(e); }
}
