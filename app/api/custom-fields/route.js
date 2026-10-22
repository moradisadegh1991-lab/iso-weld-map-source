export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import * as cf from "../../../lib/db/repos/custom-fields.mjs";

/**
 * Columns a project adds to the platform's tables (lib/db/repos/custom-fields.mjs).
 * Any member reads them; a member who is not a viewer fills them in; the
 * project's admin (or a developer) adds, renames and removes them.
 *
 *   GET ?projectId&form=NAME                 the table's columns and their values
 *   POST {kind: field | field-remove | value}
 */
const forbidden = (m) => Object.assign(new Error(m), { status: 403, code: "FORBIDDEN" });

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), formKey = url.searchParams.get("form");
    if (!projectId || !formKey) return Response.json({ error: "projectId and form are required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json({ ...(await cf.tableColumns(db, { projectId, formKey })),
      may: { define: ["admin", "developer"].includes(membership.role), fill: membership.role !== "viewer" } }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    const { projectId, kind } = b;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    if (kind === "value" ? membership.role === "viewer" : !["admin", "developer"].includes(membership.role)) {
      throw forbidden(kind === "value" ? "نقش «مشاهده‌گر» ستون‌ها را پر نمی‌کند." : "ستون تازه را مدیر پروژه تعریف می‌کند.");
    }
    return await withProject(db, projectId, async () => {
      const a = { ...b, projectId, userId: user.id };
      const run = { field: () => cf.saveField(db, a), "field-remove": () => cf.removeField(db, a), value: () => cf.saveValue(db, a) }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ ok: true, row: (await run()) ?? null });
    });
  } catch (e) { return errorResponse(e); }
}
