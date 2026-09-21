/**
 * Preparing a drawing for the vision model, in the browser.
 *
 * Two constraints shape all of this. A serverless function body caps at about
 * 4.5 MB, and the model downsamples anything past roughly 1568 px on the long
 * edge — so sending one big sheet loses exactly the BOM text that matters.
 * The answer is a full view for routing plus overlapping crops for the small
 * text, each already scaled to something useful.
 *
 * Anything drawable works as a source: an <img> from a JPEG, or a <canvas>
 * rendered from a vector PDF page. `drawImage` takes both, and a vector
 * source gives a cleaner picture than any scan of the same drawing.
 */

const LIMIT = 3_400_000;              // comfortably under the body cap
const ROW = ["TOP", "MIDDLE", "BOTTOM"];
const COL = ["LEFT", "CENTRE", "RIGHT"];

export function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("تصویر باز نشد. فرمت JPG یا PNG باشد."));
    img.src = URL.createObjectURL(file);
  });
}

export const sizeOf = (src) => ({
  w: src.naturalWidth || src.width,
  h: src.naturalHeight || src.height,
});

function renderCrop(src, sx, sy, sw, sh, max, quality) {
  const scale = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality).split(",")[1];
}

/**
 * A dense sheet loses its BOM text when sent whole, so crop a grid. The finer
 * the source, the finer the grid; the 14% overlap is there so no BOM row is
 * ever cut in half by a tile boundary.
 */
export function tiles(src, max, quality, grid) {
  const { w: W, h: H } = sizeOf(src);
  const n = grid;
  const ox = (W / n) * 0.14, oy = (H / n) * 0.14;
  const defs = [["FULL SHEET", 0, 0, W, H]];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      defs.push([
        `${n === 2 ? ROW[r * 2] : ROW[r]}-${n === 2 ? COL[c * 2] : COL[c]} TILE`,
        Math.max(0, (W / n) * c - ox), Math.max(0, (H / n) * r - oy),
        W / n + ox * 2, H / n + oy * 2,
      ]);
    }
  }
  return defs.map(([label, sx, sy, sw, sh]) => ({
    label, mediaType: "image/jpeg",
    data: renderCrop(src, sx, sy, Math.min(sw, W - sx), Math.min(sh, H - sy), max, quality),
  }));
}

/** Tile and compress until the payload fits, giving up resolution last. */
export function prepareSource(src) {
  const { w, h } = sizeOf(src);
  const long = Math.max(w, h);
  const grid = long >= 3200 ? 3 : 2;          // 10 tiles for a real scan, 5 for a photo
  const sum = (o) => o.reduce((a, i) => a + i.data.length, 0);

  let out = tiles(src, 1500, 0.82, grid);
  if (sum(out) > LIMIT) out = tiles(src, 1350, 0.7, grid);
  if (sum(out) > LIMIT) out = tiles(src, 1150, 0.58, grid);
  if (sum(out) > LIMIT && grid === 3) out = tiles(src, 1400, 0.75, 2);
  if (sum(out) > LIMIT) out = out.slice(0, 3);

  return { images: out, bytes: sum(out), w, h, grid, long };
}

export async function prepare(file) {
  return prepareSource(await loadImage(file));
}
