export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { listProjectsForUser } from "../../../../lib/db/repos/projects.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { visibleContracts } from "../../../../lib/db/repos/users.mjs";

/**
 * Who is signed in, and what they may open: their projects, and in each the
 * contracts they see (the top bar picks a contract). The shell's first call.
 */
export async function GET(request) {
  try {
    const { db, user, authMode } = await authenticate(request);
    const projects = await listProjectsForUser(db, user.id);
    for (const p of projects) {
      p.contracts = await withProject(db, p.id, () => visibleContracts(db, { projectId: p.id, userId: user.id, role: p.role }));
    }
    return Response.json({
      user: { id: user.id, email: user.email, displayName: user.display_name, isDeveloper: !!user.is_developer },
      projects,
      authMode,
    });
  } catch (e) { return errorResponse(e); }
}
