export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import * as it from "../../../lib/db/repos/import-templates.mjs";

/**
 * Excel templates a person builds (lib/db/repos/import-templates.mjs). Any
 * member reads them; a member who is not a viewer saves one; its maker or
 * the project's admin removes it.
 *
 *   GET ?projectId&kind=KEY            the saved templates of that kind
 *   POST {kind: save | remove}         save: {template, name, columns}; remove: {id}
 */
const forbidden = (m) => Object.assign(new Error(m), { status: 403, code: "FORBIDDEN" });
const isAdmin = (m) => ["admin", "developer"].includes(m.role);

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), kind = url.searchParams.get("kind");
    if (!projectId || !kind) return Response.json({ error: "projectId and kind are required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json({ templates: await it.listTemplates(db, { projectId, kind }),
      may: { save: membership.role !== "viewer", removeAny: isAdmin(membership) }, me: user.id }));
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
    if (membership.role === "viewer") throw forbidden("نقش «مشاهده‌گر» الگو نمی‌سازد.");
    return await withProject(db, projectId, async () => {
      if (kind === "save") return Response.json({ ok: true, row: await it.saveTemplate(db, { projectId, kind: b.template, name: b.name, columns: b.columns, userId: user.id }) });
      if (kind === "remove") { await it.removeTemplate(db, { projectId, id: b.id, userId: user.id, isAdmin: isAdmin(membership) }); return Response.json({ ok: true, row: null }); }
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
