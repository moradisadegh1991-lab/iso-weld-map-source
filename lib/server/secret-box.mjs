/**
 * A secret kept in the database as the server alone can read it (AES-256-GCM).
 *
 * The key is derived (HKDF-SHA256) from SECRETS_KEY, or from SESSION_SECRET
 * when SECRETS_KEY is not set — at least 32 characters either way. There is
 * no development fallback: SESSION_SECRET is random per process in
 * development (lib/auth/cookie.mjs), and a secret sealed with it could not
 * be opened after a restart, so a server without a stable key refuses to
 * seal at all rather than lose what it was given.
 *
 * `aad` (additional authenticated data) ties the box to the row it belongs
 * to: a sealed value copied into another row, project or provider does not
 * open. A changed key, a changed row or a changed byte all fail the same
 * way, with `code: "SECRET_UNREADABLE"` — never a wrong plaintext.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const fail = (message, code, status = 500) => Object.assign(new Error(message), { status, code });

function keyOf(env) {
  const base = env.SECRETS_KEY || env.SESSION_SECRET;
  if (!base || base.length < 32) {
    throw fail("برای نگه‌داشتن کلید در پایگاه داده، SECRETS_KEY (یا SESSION_SECRET) باید روی سرور تنظیم و دست‌کم ۳۲ نویسه باشد.", "NO_SECRETS_KEY");
  }
  return Buffer.from(hkdfSync("sha256", base, "epc-secret-box", "secret-box-v1", 32));
}

export function seal(plain, { aad = "", env = process.env } = {}) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(env), iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), ct].map((x) => (typeof x === "string" ? x : x.toString("base64url"))).join(".");
}

export function open(box, { aad = "", env = process.env } = {}) {
  const key = keyOf(env);
  const [v, iv, tag, ct] = String(box || "").split(".");
  try {
    if (v !== "v1" || !iv || !tag || !ct) throw new Error("format");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAAD(Buffer.from(String(aad)));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    throw fail("کلید ذخیره‌شده خوانده نمی‌شود (کلید رمزنگاری سرور عوض شده یا رکورد دست‌کاری شده)؛ دوباره ثبتش کنید.", "SECRET_UNREADABLE", 409);
  }
}
