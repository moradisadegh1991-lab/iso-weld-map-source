export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getDb } from "../../../../lib/server/db.mjs";
import { errorResponse } from "../../../../lib/server/session.mjs";
import { authenticatePassword, loginSource } from "../../../../lib/db/repos/credentials.mjs";
import { issue, cookieHeader, isLocal } from "../../../../lib/auth/cookie.mjs";
import { listProjectsForUser } from "../../../../lib/db/repos/projects.mjs";

/**
 * Exchange an email and password for a session cookie.
 *
 * The cookie is HttpOnly, so the token never reaches script — which is the
 * whole reason this replaced a subject string kept in localStorage.
 */
export async function POST(request) {
  try {
    const { email, password } = await request.json().catch(() => ({}));
    if (!email || !password) {
      return Response.json({ error: "ایمیل و رمز عبور لازم است." }, { status: 400 });
    }
    const db = await getDb();
    const user = await authenticatePassword(db, { email, password, source: loginSource(request) });
    const token = issue({ sub: user.id, name: user.displayName || user.email, v: user.sessionVersion });

    return Response.json(
      {
        user: { id: user.id, email: user.email, displayName: user.displayName },
        mustChange: user.mustChange,
        projects: await listProjectsForUser(db, user.id),
      },
      { headers: { "Set-Cookie": cookieHeader(token, { secure: !isLocal(request) }) } });
  } catch (e) { return errorResponse(e); }
}
