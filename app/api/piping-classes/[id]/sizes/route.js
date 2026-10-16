export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../../lib/server/session.mjs";
import { withProject } from "../../../../../lib/db/scope.mjs";
import { setClassSizes, sizeTable } from "../../../../../lib/db/repos/piping-class.mjs";
import { assertCan, ACTIONS } from "../../../../../lib/authz.mjs";

/**
 * The size table off the class spec sheet.
 *
 * This is the authority on wall thickness, which is what the welder
 * qualification check needs and what a schedule label alone never provided.
 */
export async function GET(request, ctx) {
  const params = await ctx.params; // Next 15: route params arrive as a promise
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const table = await sizeTable(db, { projectId, pipingClassId: params.id });
      return Response.json({ sizes: [...table.entries()].map(([nps, v]) => ({ nps, ...v })) });
    });
  } catch (e) { return errorResponse(e); }
}

export async function PUT(request, ctx) {
  const params = await ctx.params; // Next 15: route params arrive as a promise
  try {
    const { projectId, sizes } = await request.json();
    if (!projectId || !Array.isArray(sizes)) {
      return Response.json({ error: "projectId and a sizes array are required" }, { status: 400 });
    }
    const bad = sizes.find((s) => s.nps == null || s.wallThicknessMm == null);
    if (bad) {
      return Response.json(
        { error: "each size needs nps and wallThicknessMm — a thickness is never inferred" },
        { status: 400 });
    }
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_PIPING_CLASS);

    return await withProject(db, projectId, async () => Response.json(
      { count: await setClassSizes(db, { projectId, pipingClassId: params.id, sizes }) }));
  } catch (e) { return errorResponse(e); }
}
