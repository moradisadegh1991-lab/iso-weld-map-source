/**
 * The session cookie.
 *
 * A signed, self-contained cookie rather than a session table: it keeps the
 * login path to one database read, and there is no server-side state to
 * share between Vercel instances. The trade is that a session cannot be
 * revoked before it expires, which is why the lifetime is short and why the
 * secret can be rotated to invalidate every session at once.
 *
 * HMAC-SHA256 over the payload, compared in constant time. The payload is
 * NOT encrypted — it holds a user id and an expiry, nothing secret — but it
 * cannot be edited without the secret.
 */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export const COOKIE_NAME = "epc_session";
/** Eight hours: a shift. Long enough not to interrupt work, short enough to matter. */
export const MAX_AGE_SECONDS = 8 * 60 * 60;

const b64u = (buf) => Buffer.from(buf).toString("base64url");

/**
 * The signing secret.
 *
 * Refuses to fall back to a constant in production. A hard-coded default
 * would mean every deployment on the internet shares a secret that is in a
 * public repository, and anyone could mint a session for any user.
 */
export function sessionSecret(env = process.env) {
  const s = env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (env.NODE_ENV === "production") {
    throw Object.assign(
      new Error("SESSION_SECRET تنظیم نشده یا کوتاه‌تر از ۳۲ نویسه است. "
        + "بدون آن نشست‌ها قابل جعل‌اند و سرویس بالا نمی‌آید."),
      { status: 500, code: "NO_SESSION_SECRET" });
  }
  if (s) {
    throw Object.assign(
      new Error("SESSION_SECRET باید دست‌کم ۳۲ نویسه باشد."),
      { status: 500, code: "WEAK_SESSION_SECRET" });
  }
  // Development only, and regenerated per process: restarting the dev server
  // logs everyone out, which is the correct nuisance. A fixed dev default
  // would eventually be deployed by someone.
  if (!globalThis.__epcDevSecret) globalThis.__epcDevSecret = randomBytes(32).toString("hex");
  return globalThis.__epcDevSecret;
}

export function sign(payload, secret = sessionSecret()) {
  const body = b64u(JSON.stringify(payload));
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/**
 * Verify and decode. Returns null for anything that is not a valid,
 * unexpired session — a tampered cookie and an absent one are the same
 * answer, because telling them apart helps only an attacker.
 */
export function verify(token, secret = sessionSecret(), now = Date.now()) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const i = token.lastIndexOf(".");
  const body = token.slice(0, i);
  const mac = token.slice(i + 1);

  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.sub || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * `v` is the credential's session_version when the cookie was issued; a
 * cookie whose `v` is behind the account's current one has been revoked.
 */
export function issue({ sub, name = null, v = 0 }, secret = sessionSecret(), now = Date.now()) {
  return sign({ sub, name, v, iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + MAX_AGE_SECONDS }, secret);
}

/**
 * The Set-Cookie header.
 *
 * HttpOnly so script cannot read it, SameSite=Lax so it does not ride along
 * on a cross-site POST, Secure whenever the request is not plain localhost —
 * a session cookie sent over http on a public host is a session anyone on
 * the path can take.
 */
export function cookieHeader(token, { secure = true, maxAge = MAX_AGE_SECONDS } = {}) {
  const bits = [
    `${COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export const clearCookieHeader = ({ secure = true } = {}) =>
  cookieHeader("", { secure, maxAge: 0 });

/** Pull our cookie out of a request's Cookie header. */
export function readCookie(request) {
  const raw = request.headers?.get?.("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE_NAME) return v.join("=");
  }
  return null;
}

/** Is this request on a plain-http localhost, where Secure would break login? */
export function isLocal(request) {
  try {
    const u = new URL(request.url);
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch { return false; }
}
