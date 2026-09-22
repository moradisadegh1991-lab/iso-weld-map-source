export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { clearCookieHeader, isLocal } from "../../../../lib/auth/cookie.mjs";

export async function POST(request) {
  return Response.json({ ok: true },
    { headers: { "Set-Cookie": clearCookieHeader({ secure: !isLocal(request) }) } });
}
