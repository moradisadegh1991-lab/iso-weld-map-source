/**
 * Print layouts and header logos (migration 060). The layout's rules are
 * lib/reports/print.mjs; this keeps what passed them. Call inside `withProject`.
 */
import { sniffImage } from "../../quality/photo.mjs";
import { checkLayout, DEFAULT_LAYOUT } from "../../reports/print.mjs";

export const MAX_LOGO_BYTES = 1024 * 1024;
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (w) => Object.assign(new Error(`${w} not found`), { status: 404 });

export async function listLogos(db, { projectId }) {
  const { rows } = await db.query(
    "SELECT id, name, content_type, byte_size, uploaded_at FROM project_logo WHERE project_id = $1 ORDER BY uploaded_at", [projectId]);
  return rows;
}

/** Keep a logo. The same image again is the logo already kept. */
export async function saveLogo(db, { projectId, name, bytes, store, userId = null }) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!String(name ?? "").trim()) throw bad("نام لوگو لازم است.");
  if (!buf.length) throw bad("فایل لوگو خالی است.");
  if (buf.length > MAX_LOGO_BYTES) throw bad("حجم لوگو بیش از ۱ مگابایت است.");
  const type = sniffImage(buf);
  if (!type) throw bad("فایل لوگو تصویر PNG، JPEG یا WebP نیست.");
  const blob = await store.put(buf, { ext: EXT[type], contentType: type });
  const { rows: [have] } = await db.query("SELECT id, name FROM project_logo WHERE project_id = $1 AND sha256 = $2", [projectId, blob.digest]);
  if (have) return { ...have, duplicate: true };
  const { rows: [row] } = await db.query(
    `INSERT INTO project_logo (project_id, name, sha256, storage_uri, content_type, byte_size, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, content_type, byte_size, uploaded_at`,
    [projectId, String(name).trim(), blob.digest, blob.uri, type, buf.length, userId]);
  return row;
}

export async function readLogo(db, { projectId, logoId, store }) {
  const { rows: [l] } = await db.query("SELECT * FROM project_logo WHERE id = $1 AND project_id = $2", [logoId, projectId]);
  if (!l) throw notFound("logo");
  return { bytes: await store.get(l.storage_uri), contentType: l.content_type, sha256: l.sha256 };
}

/** The layout in use for a type: the latest saved, or the default until one is. */
export async function currentLayout(db, { projectId, reportTypeId }) {
  const { rows: [r] } = await db.query(
    `SELECT version, layout, saved_at FROM report_print_layout WHERE project_id = $1 AND report_type_id = $2
      ORDER BY version DESC LIMIT 1`, [projectId, reportTypeId]);
  return r ? { version: r.version, layout: r.layout, savedAt: r.saved_at } : { version: 0, layout: DEFAULT_LAYOUT, savedAt: null };
}

/** Save a layout as the next version — after it passes the rules. */
export async function saveLayout(db, { projectId, reportTypeId, layout, userId = null }) {
  const { rows: [t] } = await db.query("SELECT id FROM report_type WHERE id = $1 AND project_id = $2", [reportTypeId, projectId]);
  if (!t) throw notFound("report type");
  const logoIds = (await listLogos(db, { projectId })).map((l) => l.id);
  const { layout: clean, problems } = checkLayout(layout, { logoIds });
  if (problems.length) throw bad(problems.join(" · "));
  const cur = await currentLayout(db, { projectId, reportTypeId });
  const { rows: [r] } = await db.query(
    `INSERT INTO report_print_layout (project_id, report_type_id, version, layout, saved_by) VALUES ($1,$2,$3,$4,$5)
     RETURNING version, saved_at`, [projectId, reportTypeId, cur.version + 1, JSON.stringify(clean), userId]);
  return { version: r.version, layout: clean };
}
