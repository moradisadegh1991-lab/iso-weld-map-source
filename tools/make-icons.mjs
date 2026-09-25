/**
 * The app icons, drawn as SVG and rendered to PNG by the bundled Chromium,
 * so they can be regenerated rather than kept as opaque binaries.
 *   node tools/make-icons.mjs
 * The maskable one keeps the mark inside the central 80 % safe zone.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const svg = (size, pad) => {
  const s = size, m = s * pad, w = s - 2 * m, cell = w / 7;
  const dark = [[0,0],[1,0],[2,0],[0,1],[2,1],[0,2],[1,2],[2,2],[4,0],[6,0],[4,2],[5,1],[6,2],[0,4],[2,4],[1,5],[0,6],[2,6],[4,4],[5,5],[6,6],[4,6],[6,4]];
  const rects = dark.map(([x, y]) => `<rect x="${m + x * cell}" y="${m + y * cell}" width="${cell * 0.92}" height="${cell * 0.92}" rx="${cell * 0.15}" fill="#3FC1C9"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><rect width="${s}" height="${s}" fill="#0A1116"/>${rects}</svg>`;
};
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage();
for (const [name, size, pad] of [["icon-192", 192, 0.14], ["icon-512", 512, 0.14], ["icon-512-maskable", 512, 0.24], ["apple-touch-icon", 180, 0.14]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(size, pad)}</body></html>`);
  writeFileSync(`public/icons/${name}.png`, await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
  console.log("wrote", name);
}
await b.close();
