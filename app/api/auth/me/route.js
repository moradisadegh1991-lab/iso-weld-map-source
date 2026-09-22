export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { listProjectsForUser } from "../../../../lib/db/repos/projects.mjs";

/** Who is signed in, and what they may open. The shell's first call. */
export async function GET(request) {
  try {
    const { db, user, authMode } = await authenticate(request);
    return Response.json({
      user: { id: user.id, email: user.email, displayName: user.display_name },
      projects: await listProjectsForUser(db, user.id),
      authMode,
    });
  } catch (e) { return errorResponse(e); }
}
