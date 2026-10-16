/**
 * A person's signature image (migration 059): drawn on screen or scanned.
 *
 * Kept as sent, under the hash of its bytes, and never changed: a new image
 * is a new row and the latest is the one in use. The type is read from the
 * bytes (lib/quality/photo.mjs), never from the name — an upload is served
 * back to other people's screens, so it must be an image and nothing else.
 */
import { sniffImage } from "../../quality/photo.mjs";

export const SIGNATURE_KIND = { drawn: "امضای رسم‌شده", scanned: "امضای اسکن‌شده" };
export const MAX_SIGNATURE_BYTES = 1024 * 1024;
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });

/** Problems with an image about to be kept as a signature, or []. */
export function signatureProblems({ bytes, kind }) {
  const out = [];
  if (!SIGNATURE_KIND[kind]) out.push("نوع امضا را انتخاب کنید: رسم‌شده یا اسکن‌شده");
  const size = bytes?.length ?? 0;
  if (!size) out.push("فایل امضا خالی است");
  else if (size > MAX_SIGNATURE_BYTES) out.push(`حجم امضا بیش از ${MAX_SIGNATURE_BYTES / 1024 / 1024} مگابایت است`);
  else if (!sniffImage(bytes)) out.push("فایل امضا تصویر PNG، JPEG یا WebP نیست");
  return out;
}

/** Keep a new signature image for `userId`. The same image again returns the one in use. */
export async function saveSignature(db, { userId, bytes, kind, store }) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const problems = signatureProblems({ bytes: buf, kind });
  if (problems.length) throw bad(problems.join(" · "));
  const type = sniffImage(buf);
  const blob = await store.put(buf, { ext: EXT[type], contentType: type });
  const cur = await currentSignature(db, { userId });
  if (cur && cur.sha256 === blob.digest && cur.kind === kind) return { ...cur, duplicate: true };
  const { rows: [row] } = await db.query(
    `INSERT INTO user_signature (user_id, kind, sha256, storage_uri, content_type, byte_size)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, user_id, kind, sha256, content_type, byte_size, uploaded_at`,
    [userId, kind, blob.digest, blob.uri, type, buf.length]);
  return row;
}

/** The image in use: the latest one kept. Null when the person has none. */
export async function currentSignature(db, { userId }) {
  const { rows: [s] } = await db.query(
    `SELECT id, user_id, kind, sha256, content_type, byte_size, uploaded_at FROM user_signature
      WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT 1`, [userId]);
  return s || null;
}

export async function signatureHistory(db, { userId }) {
  const { rows } = await db.query(
    "SELECT id, kind, content_type, byte_size, uploaded_at FROM user_signature WHERE user_id = $1 ORDER BY uploaded_at DESC", [userId]);
  return rows;
}

/**
 * The bytes of one signature image — only to someone looking from a project
 * its owner is a member of. Call inside `withProject(projectId)`.
 */
export async function readSignature(db, { projectId, signatureId, store }) {
  const { rows: [s] } = await db.query(
    `SELECT s.* FROM user_signature s
      WHERE s.id = $1 AND EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = $2 AND m.user_id = s.user_id)`,
    [signatureId, projectId]);
  if (!s) throw Object.assign(new Error("signature not found"), { status: 404 });
  return { bytes: await store.get(s.storage_uri), contentType: s.content_type, sha256: s.sha256 };
}
