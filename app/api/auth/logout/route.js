export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { clearCookieHeader, isLocal } from "../../../../lib/auth/cookie.mjs";
import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { revokeSessions } from "../../../../lib/db/repos/credentials.mjs";

/**
 * Sign out. `{ everywhere: true }` also revokes every other session of the
 * account — the answer to a lost phone or a shared computer.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.everywhere) {
      const { db, user } = await authenticate(request);
      await revokeSessions(db, { userId: user.id });
    }
    return Response.json({ ok: true },
      { headers: { "Set-Cookie": clearCookieHeader({ secure: !isLocal(request) }) } });
  } catch (e) { return errorResponse(e); }
}
