export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getDb } from "../../../../lib/server/db.mjs";
import { errorResponse } from "../../../../lib/server/session.mjs";
import { requestPasswordReset, loginSource } from "../../../../lib/db/repos/credentials.mjs";

/**
 * POST { login } — "forgot my password", from the sign-in page (no session).
 * Files a request for the account's administrators; the answer never says
 * whether the account exists (lib/db/repos/credentials.mjs).
 */
export async function POST(request) {
  try {
    const { login } = await request.json().catch(() => ({}));
    return Response.json(await requestPasswordReset(await getDb(), { login, source: loginSource(request) }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
