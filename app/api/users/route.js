export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS, ROLES } from "../../../lib/authz.mjs";
import { AREAS } from "../../../lib/platform/areas.mjs";
import * as users from "../../../lib/db/repos/users.mjs";

/**
 * GET  ?projectId=                 the project's members, the developers, and the choices
 * POST { projectId, kind, … }      invite · update · remove · link · revoke   (project admin)
 *                                  active · developer                         (developer only)
 */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => Response.json({
      members: await users.listProjectUsers(db, { projectId }),
      developers: await users.listDevelopers(db),
      roles: ROLES, areas: AREAS, setupHours: users.SETUP_HOURS,
      iAmDeveloper: membership.role === "developer",
    }, { headers: { "Cache-Control": "no-store" } }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind, userId } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    const developer = membership.role === "developer";
    if (["active", "developer"].includes(kind) && !developer) {
      return Response.json({ error: "این کار فقط با توسعه‌دهندهٔ سامانه است." }, { status: 403 });
    }
    return await withProject(db, projectId, async () => {
      // Everything but an invitation acts on someone already in THIS project:
      // an admin here reaches no account through a project they do not run.
      if (kind !== "invite") {
        const { rows: [m] } = await db.query("SELECT 1 FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
        if (!m && !developer) return Response.json({ error: "not found" }, { status: 404 });
      }
      const a = { ...body, projectId, byUser: user.id, byDeveloper: developer };
      if (kind === "invite") return Response.json(await users.inviteUser(db, a));
      if (kind === "update") return Response.json({ member: await users.updateMember(db, a) });
      if (kind === "remove") return Response.json(await users.removeMember(db, a));
      if (kind === "link") return Response.json({ link: await users.issueSetupLink(db, a) });
      if (kind === "revoke") return Response.json(await users.endSessions(db, a));
      if (kind === "active") return Response.json({ user: await users.setActive(db, { userId, active: body.active, byUser: user.id }) });
      if (kind === "developer") return Response.json({ user: await users.setDeveloper(db, { userId, value: body.value }) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
