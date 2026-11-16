import { prepareSource, sizeOf } from "./image-prep.mjs";

/** Validate user-selected masks in normalized source-image coordinates.
 * This does not find sensitive information; missing masks must never imply approval.
 */
export function redactionPixels(width, height, masks) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 80_000_000)
    throw new Error("Invalid image dimensions");
  if (!Array.isArray(masks) || masks.length < 1 || masks.length > 100) throw new Error("At least one valid mask is required");
  return masks.map((m) => {
    const { x, y, width: w, height: h } = m || {};
    if (![x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v)) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1)
      throw new Error("Invalid mask coordinates");
    // Round outwards and add 2 source pixels to avoid edge leakage at resampling boundaries.
    const left = Math.max(0, Math.floor(x * width) - 2), top = Math.max(0, Math.floor(y * height) - 2);
    const right = Math.min(width, Math.ceil((x + w) * width) + 2), bottom = Math.min(height, Math.ceil((y + h) * height) + 2);
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
}

/** Return a flattened, irreversibly painted browser canvas. Never mutates the source. */
export function maskImageSource(source, masks) {
  const { w, h } = sizeOf(source);
  const regions = redactionPixels(w, h, masks);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx || canvas.width !== w || canvas.height !== h) throw new Error("Cannot allocate masking canvas");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  ctx.fillStyle = "#000";
  for (const r of regions) ctx.fillRect(r.x, r.y, r.width, r.height);
  return canvas;
}

/** Preview and tiles derive solely from the painted image; this function does not authorize sending. */
export function prepareMaskedSource(source, masks) {
  const masked = maskImageSource(source, masks);
  return { masked, ...prepareSource(masked) };
}
