export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { sectionLog, addComment, peopleOf, SECTION_FA } from "../../../lib/db/repos/log.mjs";
import { LOG_SECTIONS, narrowed, tileAllowed } from "../../../lib/platform/navigation.mjs";

/** A member narrowed to tiles reads the logs of their tiles' sections only. */
const logAllowed = (m, section) => !narrowed(m)
  || Object.entries(LOG_SECTIONS).some(([key, secs]) => secs.includes(section) && tileAllowed(m, `/log/${key}`));

/** A section's log (or one record's trail): steps, signatures and comments, with who and when. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const section = url.searchParams.get("section");
    if (!projectId || !section) return Response.json({ error: "projectId and section are required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    if (!logAllowed(membership, section)) return Response.json({ error: "not found" }, { status: 404 });
    const entityId = url.searchParams.get("entityId");
    if (entityId && !/^[0-9a-f-]{36}$/i.test(entityId)) return Response.json({ error: "not found" }, { status: 404 });
    return await withProject(db, projectId, async () => {
      const log = await sectionLog(db, { projectId, section, entityId, entityType: url.searchParams.get("type") || null });
      return Response.json({ section, title: SECTION_FA[section], log, people: peopleOf(log), sections: SECTION_FA });
    });
  } catch (e) { return errorResponse(e); }
}

/** A comment on a record, in its section's log. */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.COMMENT);
    if (!logAllowed(membership, body.section)) return Response.json({ error: "not found" }, { status: 404 });
    return await withProject(db, projectId, async () => Response.json({ event: await addComment(db, {
      projectId, section: body.section, entityType: body.entityType || "section", entityId: body.entityId || null,
      label: body.label || "کامنت", comment: body.comment, userId: user.id }) }));
  } catch (e) { return errorResponse(e); }
}
