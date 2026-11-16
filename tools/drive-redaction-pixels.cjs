/** Real-browser pixel test for the masked canvas and all overlapping tiles. */
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const files = new Set(["/lib/client/image-redaction.mjs", "/lib/client/image-prep.mjs"]);
  const server = createServer(async (req, res) => {
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>Mask test</title>"); return; }
    if (!files.has(req.url)) { res.writeHead(404).end(); return; }
    res.setHeader("content-type", "text/javascript"); res.end(await readFile(`.${req.url}`));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const { prepareMaskedSource } = await import("/lib/client/image-redaction.mjs");
      const source = document.createElement("canvas"); source.width = source.height = 1000;
      const ctx = source.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1000, 1000);
      ctx.fillStyle = "red"; ctx.fillRect(420, 420, 160, 160);
      const out = prepareMaskedSource(source, [{ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }]);
      const positions = [[500, 500], [500, 500], [70, 500], [500, 70], [70, 70]];
      const pixels = [];
      for (let i = 0; i < out.images.length; i++) {
        const image = new Image(); image.src = `data:image/jpeg;base64,${out.images[i].data}`;
        await image.decode(); const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
        const x = c.getContext("2d"); x.drawImage(image, 0, 0);
        pixels.push([...x.getImageData(...positions[i], 1, 1).data]);
      }
      // A larger image triggers 3×3 tiling. Put the sensitive point exactly at a four-tile intersection.
      const big = document.createElement("canvas"); big.width = big.height = 3200;
      const bigCtx = big.getContext("2d"); bigCtx.fillStyle = "white"; bigCtx.fillRect(0, 0, 3200, 3200);
      const secret = 3200 / 3; bigCtx.fillStyle = "red"; bigCtx.fillRect(secret - 40, secret - 40, 80, 80);
      const bigOut = prepareMaskedSource(big, [{ x: (secret - 60) / 3200, y: (secret - 60) / 3200, width: 120 / 3200, height: 120 / 3200 }]);
      const bigPixels = [];
      for (let i = 0; i < bigOut.images.length; i++) {
        const image = new Image(); image.src = `data:image/jpeg;base64,${bigOut.images[i].data}`; await image.decode();
        let sx = 0, sy = 0, sw = 3200, sh = 3200;
        if (i > 0) {
          const row = Math.floor((i - 1) / 3), col = (i - 1) % 3, overlap = 3200 / 3 * 0.14;
          sx = Math.max(0, col * 3200 / 3 - overlap); sy = Math.max(0, row * 3200 / 3 - overlap);
          sw = Math.min(3200 / 3 + overlap * 2, 3200 - sx); sh = Math.min(3200 / 3 + overlap * 2, 3200 - sy);
        }
        if (secret < sx || secret >= sx + sw || secret < sy || secret >= sy + sh) continue;
        const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
        const x = c.getContext("2d"); x.drawImage(image, 0, 0);
        bigPixels.push([...x.getImageData(Math.floor((secret - sx) * image.width / sw), Math.floor((secret - sy) * image.height / sh), 1, 1).data]);
      }
      return { count: out.images.length, pixels, bigCount: bigOut.images.length, bigPixels, original: [...ctx.getImageData(500, 500, 1, 1).data], masked: [...out.masked.getContext("2d").getImageData(500, 500, 1, 1).data] };
    });
    assert.equal(result.count, 5); assert.equal(result.bigCount, 10); assert(result.bigPixels.length >= 5, "intersection must occur in four tiles and full view");
    assert(result.original[0] > 240 && result.original[1] < 10, "source stays unchanged");
    for (const p of [result.masked, ...result.pixels, ...result.bigPixels]) assert(p[0] < 12 && p[1] < 12 && p[2] < 12, `secret pixel was not painted: ${p}`);
    console.log("masked source and 2×2 / 3×3 overlapping JPEG tiles passed");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
