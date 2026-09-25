/**
 * Punch photos: attach, list, read back.
 *
 * The rules are lib/quality/photo.mjs. Call inside `withProject`.
 */
import { photoProblems, sniffImage } from "../../quality/photo.mjs";

const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

/**
 * Attach a photo. The same bytes on the same item return the photo already
 * kept — a retried upload is not a second photo.
 * @param {{store}} args.store  the content store the bytes go into
 */
export async function attachPhoto(db, { projectId, punchId, bytes, stage, takenOn, userId = null, store }) {
  const { rows: [p] } = await db.query("SELECT id, status FROM punch_item WHERE id = $1 AND project_id = $2", [punchId, projectId]);
  if (!p) throw Object.assign(new Error("آیتم Punch پیدا نشد."), { status: 404 });
  if (!takenOn) throw bad("تاریخ عکس لازم است.");
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM punch_photo WHERE punch_id = $1", [punchId]);
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const problems = photoProblems({ bytes: buf, stage, punchStatus: p.status, count: n });
  if (problems.length) throw bad(problems.join(" · "));
  const type = sniffImage(buf);
  const blob = await store.put(buf, { ext: EXT[type], contentType: type });
  const { rows: [have] } = await db.query("SELECT * FROM punch_photo WHERE punch_id = $1 AND sha256 = $2", [punchId, blob.digest]);
  if (have) return { ...have, duplicate: true };
  const { rows: [row] } = await db.query(
    `INSERT INTO punch_photo (project_id, punch_id, sha256, storage_uri, content_type, byte_size, stage, taken_on, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, punchId, blob.digest, blob.uri, type, buf.length, stage, takenOn, userId]);
  return row;
}

/** Photos of one item, or of every item of the project, oldest first. */
export async function listPhotos(db, { projectId, punchId = null }) {
  const { rows } = await db.query(
    `SELECT f.id, f.punch_id, f.stage, f.taken_on, f.content_type, f.byte_size, f.created_at, u.display_name AS by_name
       FROM punch_photo f LEFT JOIN app_user u ON u.id = f.uploaded_by
      WHERE f.project_id = $1 AND ($2::uuid IS NULL OR f.punch_id = $2) ORDER BY f.created_at`, [projectId, punchId]);
  return rows;
}

/** The bytes of one photo, with its type as sniffed when it was kept. */
export async function readPhoto(db, { projectId, photoId, store }) {
  const { rows: [f] } = await db.query("SELECT * FROM punch_photo WHERE id = $1 AND project_id = $2", [photoId, projectId]);
  if (!f) throw Object.assign(new Error("photo not found"), { status: 404 });
  return { bytes: await store.get(f.storage_uri), contentType: f.content_type, sha256: f.sha256 };
}

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
