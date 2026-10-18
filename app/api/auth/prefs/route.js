export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { savePrefs } from "../../../../lib/db/repos/users.mjs";

/**
 * POST { lang?, theme?, accent?, density?, scale?, grid? } — the signed-in
 * user's own settings, merged into what is stored. Unknown keys and values
 * are dropped (lib/prefs.mjs).
 */
export async function POST(request) {
  try {
    const { db, user } = await authenticate(request);
    const prefs = await savePrefs(db, { userId: user.id, patch: await request.json().catch(() => ({})) });
    return Response.json({ prefs }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
