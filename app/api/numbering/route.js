export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { FORMS } from "../../../lib/numbering.mjs";
import { peekNumber, formCodes, setFormCode } from "../../../lib/db/repos/numbering.mjs";

/**
 * ?forms=permit,pour → the number each form would take next (not issued);
 * no `forms` → every form with its code and how many numbers it has issued.
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
      const forms = (url.searchParams.get("forms") || "").split(",").map((f) => f.trim()).filter((f) => FORMS[f]);
      if (!forms.length) return Response.json({ forms: await formCodes(db, { projectId }) });
      const scope = url.searchParams.get("scope");
      const next = {};
      for (const form of forms) next[form] = await peekNumber(db, { projectId, form, scope });
      return Response.json({ next });
    });
  } catch (e) { return errorResponse(e); }
}

/** A project's own code for a form. */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () =>
      Response.json({ forms: await setFormCode(db, { projectId, form: body.form, code: body.code, userId: user.id }) }));
  } catch (e) { return errorResponse(e); }
}
