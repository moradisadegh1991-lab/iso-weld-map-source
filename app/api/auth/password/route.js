export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { changePassword } from "../../../../lib/db/repos/credentials.mjs";
import { issue, cookieHeader, isLocal } from "../../../../lib/auth/cookie.mjs";

/**
 * POST { current, next } — the signed-in user changes their own password.
 * Every other session ends; this one gets a fresh cookie under the new
 * session version, so the person who changed it stays signed in here.
 */
export async function POST(request) {
  try {
    const { db, user } = await authenticate(request);
    const { current, next } = await request.json().catch(() => ({}));
    if (!current || !next) return Response.json({ error: "رمز فعلی و رمز تازه لازم است." }, { status: 400 });
    const r = await changePassword(db, { userId: user.id, current, next });
    const token = issue({ sub: user.id, name: user.display_name || user.email, v: r.session_version });
    return Response.json({ ok: true }, { headers: { "Set-Cookie": cookieHeader(token, { secure: !isLocal(request) }), "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
