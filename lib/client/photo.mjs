/**
 * A site photo as the phone sends it.
 *
 * A camera photo is 3–12 MB; over a site's mobile signal that is minutes,
 * and a punch item does not need 48 megapixels. It is redrawn at most
 * 1600 px on its long side as JPEG — which also leaves behind the file's
 * EXIF block, the phone's GPS position and serial number with it. The
 * orientation the camera recorded is applied first, so the photo stands
 * the way it was taken.
 */
import { MAX_PHOTO_BYTES } from "../quality/photo.mjs";

const LONG_SIDE = 1600;

export async function compressPhoto(file) {
  let img;
  try {
    img = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("این فایل به‌عنوان عکس باز نشد (JPEG، PNG یا WebP بفرستید).");
  }
  const k = Math.min(1, LONG_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  img.close?.();
  for (const q of [0.8, 0.6, 0.4]) {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
    if (blob && blob.size <= MAX_PHOTO_BYTES) return blob;
  }
  throw new Error("عکس حتی پس از فشرده‌سازی بزرگ‌تر از حد مجاز است.");
}

/** A blob as base64, for the JSON the sync sends. */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
