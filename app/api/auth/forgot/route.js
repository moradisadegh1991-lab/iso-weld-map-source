export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getDb } from "../../../../lib/server/db.mjs";
import { errorResponse } from "../../../../lib/server/session.mjs";
import { requestPasswordReset, loginSource } from "../../../../lib/db/repos/credentials.mjs";
import { mailResetLink } from "../../../../lib/db/repos/users.mjs";
import { resetMailer } from "../../../../lib/server/mail.mjs";

/**
 * POST { login } — "forgot my password", from the sign-in page (no session).
 * Mails a one-time link to the account's address when the server can send
 * mail (lib/server/mail.mjs), else files a request for the account's
 * administrators; the answer never says whether the account exists
 * (lib/db/repos/credentials.mjs).
 * GET — which of the two this server does, so the form can say so.
 */
export async function GET() {
  return Response.json({ via: resetMailer() ? "email" : "admin" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  try {
    const { login } = await request.json().catch(() => ({}));
    const db = await getDb(), mailer = resetMailer();
    const mailLink = mailer ? (user) => mailResetLink(db, { user, mailer }) : null;
    return Response.json(await requestPasswordReset(db, { login, source: loginSource(request), mailLink }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
