export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS, ROLES } from "../../../lib/authz.mjs";
import { AREAS } from "../../../lib/platform/areas.mjs";
import * as users from "../../../lib/db/repos/users.mjs";
import { formTypes } from "../../../lib/db/repos/forms.mjs";
import { tileCatalog, cleanTiles } from "../../../lib/platform/tiles.mjs";
import { SECTIONS } from "../../../lib/platform/navigation.mjs";

/**
 * GET  ?projectId=                 the project's members, the developers, and the choices
 * POST { projectId, kind, … }      invite · update · remove · link · revoke · profile ·
 *                                  contract-member(-remove) · reset-dismiss · tiles   (project admin)
 *                                  active · developer                         (developer only)
 */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => Response.json({
      members: await users.listProjectUsers(db, { projectId }),
      developers: await users.listDevelopers(db),
      roles: ROLES, areas: AREAS, setupHours: users.SETUP_HOURS,
      contractMembers: await users.contractMembers(db, { projectId }), contractAccess: users.CONTRACT_ACCESS,
      contracts: (await db.query(`SELECT c.id, c.contract_no, c.title,
          ARRAY(SELECT DISTINCT s.company_id FROM contract_stakeholder s WHERE s.contract_id = c.id) AS companies
          FROM contract c WHERE c.project_id = $1 ORDER BY c.contract_no`, [projectId])).rows,
      companies: (await db.query("SELECT id, code, name FROM company ORDER BY code")).rows,
      resetRequests: await users.resetRequests(db, { projectId, byUser: user.id, byDeveloper: membership.role === "developer" }),
      tileCatalog: tileCatalog(SECTIONS, await formTypes(db, { projectId })),
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
      if (kind === "contract-member-remove") { await users.removeContractMember(db, { projectId, id: body.id }); return Response.json({ ok: true }); }
      if (kind === "reset-dismiss") {
        // Only a request this admin can see: one from a member of this project.
        const mine = (await users.resetRequests(db, { projectId, byUser: user.id, byDeveloper: developer })).some((r) => r.id === body.id);
        if (!mine) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json({ request: await users.dismissResetRequest(db, { id: body.id, byUser: user.id }) });
      }
      if (kind !== "invite") {
        const { rows: [m] } = await db.query("SELECT 1 FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
        if (!m && !developer) return Response.json({ error: "not found" }, { status: 404 });
      }
      const a = { ...body, projectId, byUser: user.id, byDeveloper: developer };
      if (kind === "invite") return Response.json(await users.inviteUser(db, a));
      if (kind === "update") return Response.json({ member: await users.updateMember(db, a) });
      if (kind === "remove") return Response.json(await users.removeMember(db, a));
      if (kind === "link") return Response.json({ link: await users.issueSetupLink(db, a) });
      if (kind === "profile") return Response.json({ user: await users.updateProfile(db, { userId, username: body.username, displayName: body.displayName,
        jobTitle: body.jobTitle, specialty: body.specialty, phone: body.phone, companyId: body.companyId }) });
      if (kind === "contract-member") return Response.json({ member: await users.setContractMember(db, { projectId, contractId: body.contractId, userId,
        position: body.position, access: body.access }) });
      if (kind === "revoke") return Response.json(await users.endSessions(db, a));
      if (kind === "tiles") return Response.json({ member: await users.setMemberTiles(db, { projectId, userId, tiles: body.tiles || [], cleanTiles,
        forms: await formTypes(db, { projectId }) }) });
      if (kind === "active") return Response.json({ user: await users.setActive(db, { userId, active: body.active, byUser: user.id }) });
      if (kind === "developer") return Response.json({ user: await users.setDeveloper(db, { userId, value: body.value }) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
