export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { assertContractAccess } from "../../../lib/db/repos/users.mjs";
import * as res from "../../../lib/db/repos/resources.mjs";
import * as org from "../../../lib/db/repos/org.mjs";
import { KIND } from "../../../lib/reports/catalog.mjs";

/**
 * A contract's resources in its resource tree (lib/db/repos/resources.mjs).
 *   GET  ?projectId&contractId          the tree with resources, the contracts
 *   POST {kind: resource | resource-move | resource-remove | category-move} — contract managers
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const contractId = url.searchParams.get("contractId");
    return await withProject(db, projectId, async () => {
      const access = contractId ? await assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role }) : null;
      return Response.json({ kinds: KIND, statuses: res.STATUS,
        tree: contractId ? await res.resourceTree(db, { projectId, contractId }) : null,
        may: { edit: access === "manage" } });
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
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      // The contract a change touches is read from the row itself where there is one, never only from the body.
      const table = kind === "category-move" ? "contract_category" : "contract_resource";
      const { rows: [row] } = body.id ? await db.query(`SELECT contract_id FROM ${table} WHERE id = $1 AND project_id = $2`, [body.id, projectId]) : { rows: [] };
      const contractId = row?.contract_id || body.contractId;
      if (!contractId || (body.id && !row)) return Response.json({ error: "not found" }, { status: 404 });
      await assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role, need: "manage" });
      body.contractId = contractId;
      if (kind === "resource") return Response.json({ ok: true, row: await res.upsertResource(db, { ...body, kind: body.resourceKind, projectId, userId: user.id }) });
      if (kind === "resource-move") return Response.json({ ok: true, row: await res.moveResource(db, { projectId, id: body.id, categoryId: body.categoryId || null }) });
      if (kind === "resource-remove") { await res.removeResource(db, { projectId, id: body.id }); return Response.json({ ok: true }); }
      if (kind === "category-move") return Response.json({ ok: true, row: await org.moveCategory(db, { projectId, id: body.id, parentId: body.parentId || null }) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
