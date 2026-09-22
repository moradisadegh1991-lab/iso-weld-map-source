/**
 * Who is making this request.
 *
 * The reference architecture puts Keycloak here. Until it exists, this
 * module refuses to guess: there is a development mode that trusts a header,
 * and it must be switched on explicitly with AUTH_MODE=dev. Anything else
 * without a configured verifier throws rather than falling back to "allow",
 * because an authentication layer that fails open is worse than none — it
 * looks like it is working.
 */
import { createIdentityResolver } from "../authz.mjs";
import { getDb } from "./db.mjs";
import { ensureUser, membershipOf } from "../db/repos/projects.mjs";
import { readCookie, verify as verifySession } from "../auth/cookie.mjs";

function buildVerifier() {
  if (process.env.AUTH_MODE === "dev") {
    // The token IS the subject. Useful on a laptop, catastrophic anywhere else,
    // which is why it is behind an explicit switch and says so out loud.
    return {
      verify: async (token) => ({ sub: String(token), email: null, name: null }),
      mode: "dev",
    };
  }
  if (process.env.OIDC_ISSUER) {
    throw new Error(
      "OIDC_ISSUER is set but no verifier is wired yet. Implement the Keycloak " +
      "JWT verification in lib/server/session.mjs before deploying with it.");
  }
  throw new Error(
    "No authentication configured. Set AUTH_MODE=dev for local work, or wire an " +
    "OIDC verifier. Refusing to serve requests unauthenticated.");
}

/**
 * Resolve the caller and their standing in a project.
 *
 * Returns `{ user, membership }`. A caller with no membership gets
 * `membership: null`, and callers must treat that as "no such project"
 * rather than "forbidden" — the difference tells an outsider whether a
 * project code is in use.
 */
export async function authenticate(request, { projectId } = {}) {
  const db = await getDb();

  // The session cookie is tried FIRST and on its own. It is the real login
  // path now: a signed cookie this server issued after checking a password,
  // which is what makes the platform safe to put behind a public URL.
  // Falling through to the dev header when a cookie is present but invalid
  // would turn an expired session into an identity anyone can type.
  const cookie = readCookie(request);
  if (cookie) {
    const claims = verifySession(cookie);
    if (!claims) {
      throw Object.assign(new Error("نشست منقضی شده است. دوباره وارد شوید."),
        { status: 401, code: "SESSION_EXPIRED" });
    }
    const { rows: [user] } = await db.query(
      "SELECT id, subject, email, display_name FROM app_user WHERE id = $1", [claims.sub]);
    if (!user) {
      throw Object.assign(new Error("حساب کاربری یافت نشد."),
        { status: 401, code: "UNAUTHENTICATED" });
    }
    const membership = projectId ? await membershipOf(db, { projectId, userId: user.id }) : null;
    return { db, user, membership, authMode: "session" };
  }

  // No cookie: the header path, which only AUTH_MODE=dev or a wired OIDC
  // verifier will accept. buildVerifier throws otherwise rather than
  // falling back to "allow".
  const verifier = buildVerifier();
  const resolve = createIdentityResolver(verifier);
  const header = request.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "") || null;

  const identity = await resolve(token);
  const user = await ensureUser(db, identity);
  const membership = projectId ? await membershipOf(db, { projectId, userId: user.id }) : null;
  return { db, user, membership, authMode: verifier.mode || "oidc" };
}

/** Turn a thrown error into the response shape the client already parses. */
export function errorResponse(e) {
  const status = e?.status || 500;
  const body = { error: e?.message || "internal error" };
  if (e?.code) body.code = e.code;
  return Response.json(body, { status });
}
