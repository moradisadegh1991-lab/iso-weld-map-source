import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { copyRedactionImages, hasCompleteTileGrid } from "../client/redaction-bundle.mjs";

const TTL_MS = 5 * 60 * 1000;
const fail = (code) => Object.assign(new Error(code), { code });
function signingKey(env) {
  const secret = env.SECRETS_KEY || env.SESSION_SECRET;
  if (typeof secret !== "string" || secret.length < 32) throw fail("RECEIPT_KEY_UNAVAILABLE");
  return Buffer.from(hkdfSync("sha256", secret, "epc-iso-redaction", "integrity-receipt-v1", 32));
}
function sessionBinding(key, credential) {
  if (typeof credential !== "string" || !credential || credential.length > 8192) throw fail("RECEIPT_SESSION_INVALID");
  return createHmac("sha256", key).update("session\0").update(credential).digest("hex");
}
function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Hash precisely the same ordered label/mime/base64 fields as the browser.
 * This does NOT detect sensitive text or establish that a person reviewed the images.
 */
export function imageBundleDigest(images) {
  if (!Array.isArray(images) || images.some((im) => !im || Object.keys(im).sort().join(",") !== "data,label,mediaType")) throw fail("INVALID_BUNDLE");
  let copy;
  try { copy = copyRedactionImages(images); } catch { throw fail("INVALID_BUNDLE"); }
  if (!hasCompleteTileGrid(copy)) throw fail("INCOMPLETE_BUNDLE");
  for (const im of copy) {
    const bytes = Buffer.from(im.data, "base64");
    if (bytes.toString("base64") !== im.data || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9)
      throw fail("INVALID_BUNDLE");
  }
  return createHash("sha256").update(JSON.stringify(copy.map(({ label, mediaType, data }) => [label, mediaType, data])), "utf8").digest("hex");
}

/** A short-lived integrity receipt; never use it as approval or as an external-send authorization. */
export function issueImageReceipt({ images, claimedDigest, projectId, userId, credential, env = process.env, now = Date.now() }) {
  if (!projectId || !userId || !Number.isSafeInteger(now) || !/^[0-9a-f]{64}$/.test(String(claimedDigest || ""))) throw fail("INVALID_RECEIPT_INPUT");
  const key = signingKey(env), digest = imageBundleDigest(images);
  if (!same(digest, claimedDigest)) throw fail("BUNDLE_MISMATCH");
  const claims = { v: 1, purpose: "iso-image-integrity", projectId, userId, session: sessionBinding(key, credential), digest, iat: now, exp: now + TTL_MS, nonce: randomBytes(16).toString("hex") };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = createHmac("sha256", key).update("receipt\0").update(body).digest("base64url");
  return { receipt: `${body}.${mac}`, digest, expiresAt: claims.exp };
}

/** Verify integrity against live context and exact images; receipt is replayable until expiry. */
export function verifyImageReceipt({ receipt, images, projectId, userId, credential, env = process.env, now = Date.now() }) {
  try {
    if (typeof receipt !== "string" || receipt.length > 2048 || !Number.isSafeInteger(now)) return false;
    const parts = receipt.split("."); if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return false;
    const key = signingKey(env), expected = createHmac("sha256", key).update("receipt\0").update(parts[0]).digest("base64url");
    if (!same(parts[1], expected)) return false;
    const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (claims.v !== 1 || claims.purpose !== "iso-image-integrity" || claims.projectId !== projectId || claims.userId !== userId ||
        !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > now || claims.exp <= now || claims.exp - claims.iat !== TTL_MS ||
        !same(claims.session, sessionBinding(key, credential))) return false;
    return same(claims.digest, imageBundleDigest(images));
  } catch { return false; }
}
