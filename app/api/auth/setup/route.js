export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getDb } from "../../../../lib/server/db.mjs";
import { errorResponse } from "../../../../lib/server/session.mjs";
import { peekSetupToken, consumeSetupToken } from "../../../../lib/db/repos/users.mjs";

/**
 * The one-time link that sets a password (a new account's first, or a
 * reset). No session: the token is the credential, and it is spent here.
 *   GET  ?token=     whose account this link sets (so the page can say so)
 *   POST { token, password }
 */
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    return Response.json(await peekSetupToken(await getDb(), { token }), { headers: noStore });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const { token, password } = await request.json().catch(() => ({}));
    return Response.json(await consumeSetupToken(await getDb(), { token, password }), { headers: noStore });
  } catch (e) { return errorResponse(e); }
}
