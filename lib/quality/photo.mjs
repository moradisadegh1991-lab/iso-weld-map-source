/**
 * Site photos on punch items: what is accepted, with no database in sight.
 *
 * A photo is evidence — of the defect when the item is raised, of the fix
 * when it is cleared — so it is kept as sent, under the hash of its bytes,
 * and never edited or removed.
 *
 * The type is read from the bytes, never from the name or the declared
 * type: a file called photo.jpg that begins "<html" is not a photo, and
 * serving it back as one is how an upload becomes a script on someone
 * else's screen.
 *
 * Stages:
 *   raised   the defect as found
 *   cleared  the fix — only once the item has been cleared; a photo of a
 *            fix nobody has claimed is a photo of nothing in particular
 *   other    anything else worth keeping with the item
 */

export const PHOTO_STAGES = { raised: "نقص (هنگام ثبت)", cleared: "رفع", other: "سایر" };
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_PUNCH = 20;

/** The image type the bytes themselves say, or null. */
export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/**
 * Problems with a photo about to be attached, or [].
 * @param {{bytes, stage, punchStatus, count}} p  count = photos the item already has
 */
export function photoProblems({ bytes, stage, punchStatus, count = 0 }) {
  const out = [];
  const size = bytes?.length ?? 0;
  if (!size) out.push("فایل عکس خالی است");
  else if (size > MAX_PHOTO_BYTES) out.push(`عکس ${(size / 1048576).toFixed(1)} MB است؛ حداکثر ${MAX_PHOTO_BYTES / 1048576} MB`);
  else if (!sniffImage(bytes)) out.push("این فایل عکس (JPEG، PNG یا WebP) نیست");
  if (!PHOTO_STAGES[stage]) out.push("مرحلهٔ عکس را مشخص کنید");
  if (stage === "cleared" && punchStatus === "open") out.push("عکس رفع برای آیتمی که هنوز رفع نشده ثبت نمی‌شود");
  if (count >= MAX_PHOTOS_PER_PUNCH) out.push(`این آیتم ${count} عکس دارد؛ حداکثر ${MAX_PHOTOS_PER_PUNCH}`);
  return out;
}
