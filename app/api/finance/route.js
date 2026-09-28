export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { financeBoard } from "../../../lib/db/repos/finance.mjs";
import { recordPayment } from "../../../lib/db/repos/contracts.mjs";

/** Committed, certified, paid — by contract, by WBS element, by month. */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json(await financeBoard(db, { projectId })));
  } catch (e) { return errorResponse(e); }
}

/** kind "payment": an advance, a statement's payment, or retention released. */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_FINANCE);
    if (kind !== "payment") return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    return await withProject(db, projectId, async () =>
      Response.json({ payment: await recordPayment(db, { ...body, kind: body.paymentKind, projectId, userId: user.id }) }));
  } catch (e) { return errorResponse(e); }
}
