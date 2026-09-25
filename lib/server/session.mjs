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
import { currentSessionVersion } from "../db/repos/credentials.mjs";
import { randomBytes } from "node:crypto";

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
    // Revoked: a new password or "sign out everywhere" since this cookie was
    // issued, or the password removed altogether. A cookie from before
    // versions existed carries none and counts as version 0.
    const version = await currentSessionVersion(db, { userId: user.id });
    if (version === null || (claims.v ?? 0) !== version) {
      throw Object.assign(new Error("نشست باطل شده است. دوباره وارد شوید."),
        { status: 401, code: "SESSION_EXPIRED" });
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
  const known = e?.status ? null : fromDatabase(e);
  const status = e?.status || known?.status || 500;
  // An unexpected failure says only that it failed, with a reference to find
  // it in the server log: its own text can name tables, columns and query
  // fragments, which help nobody but an attacker mapping the schema.
  if (status >= 500) {
    const ref = randomBytes(4).toString("hex");
    console.error(`[${ref}]`, e);
    return Response.json({ error: `خطای داخلی سرور (کد پیگیری ${ref})`, code: "INTERNAL", ref }, { status });
  }
  const body = { error: known?.message || e?.message || "error" };
  const code = known?.code || e?.code;
  if (code) body.code = code;
  return Response.json(body, { status });
}

/**
 * The database's own refusals that are the caller's doing, not a fault:
 * a duplicate, a rule the table holds (a CHECK), a reference to nothing.
 * Named by the constraint, which is a rule's name, not the schema.
 */
function fromDatabase(e) {
  const c = e?.constraint ? ` (${e.constraint})` : "";
  if (e?.code === "23505") return { status: 409, code: "DUPLICATE", message: `این رکورد پیش‌تر ثبت شده است${c}.` };
  if (e?.code === "23514") return { status: 400, code: "RULE", message: `با قاعدهٔ ثبت داده نمی‌خواند${c}.` };
  if (e?.code === "23503") return { status: 400, code: "REFERENCE", message: `به رکوردی اشاره می‌کند که وجود ندارد یا هنوز استفاده می‌شود${c}.` };
  if (e?.code === "23502") return { status: 400, code: "REQUIRED", message: `مقدار لازم خالی است${e?.column ? ` (${e.column})` : ""}.` };
  if (e?.code === "22P02" || e?.code === "22007" || e?.code === "22008") return { status: 400, code: "FORMAT", message: "قالب یکی از مقادیر درست نیست." };
  return null;
}
