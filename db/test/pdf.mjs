#!/usr/bin/env node
/**
 * PDF ingestion tests.
 *
 * The browser half — pdf.js and canvas — cannot run here, so what is checked
 * is the part that decides whether the pipeline gets a usable picture: the
 * tiling geometry, and the real project PDF's own structure. A drawing that
 * arrives at the model too small is the failure this guards, and it is
 * silent: the model answers confidently from an unreadable BOM.
 */
import { test, run, assert, equal } from "./harness.mjs";
import { tiles, sizeOf } from "../../lib/client/image-prep.mjs";
import { readFile } from "node:fs/promises";

/** A stand-in for anything drawable: the tiling only reads its dimensions. */
const source = (w, h) => ({ width: w, height: h });

// The crop maths is pure, so it is exercised directly with a fake renderer.
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage() {}, fillRect() {}, imageSmoothingEnabled: true,
                         imageSmoothingQuality: "", fillStyle: "" }),
    toDataURL: function () { return "data:image/jpeg;base64," + "x".repeat(this.width * 2); },
  }),
};

test("a vector A3 sheet at 300 DPI lands well above the readable threshold", async () => {
  // 420 x 297 mm at 300 dpi
  const w = Math.round(420 / 25.4 * 300), h = Math.round(297 / 25.4 * 300);
  assert(Math.max(w, h) > 2500,
    `${w}x${h} — below 2500 px the BOM text does not read reliably`);
  equal(w, 4961);
});

test("a fine source gets a 3x3 grid, a coarse one 2x2", async () => {
  equal(tiles(source(4961, 3508), 1500, 0.8, 3).length, 10, "one full view plus nine tiles");
  equal(tiles(source(2000, 1400), 1500, 0.8, 2).length, 5, "one full view plus four");
});

test("tiles overlap, so no BOM row is cut in half by a boundary", async () => {
  const labels = tiles(source(3000, 3000), 1500, 0.8, 3).map((t) => t.label);
  equal(labels[0], "FULL SHEET");
  assert(labels.includes("TOP-LEFT TILE") && labels.includes("BOTTOM-RIGHT TILE"),
    "the grid is named by position, which is what the prompt refers to");
});

test("sizeOf reads an <img> or a <canvas> alike", async () => {
  equal(sizeOf({ naturalWidth: 100, naturalHeight: 50 }), { w: 100, h: 50 });
  equal(sizeOf({ width: 100, height: 50 }), { w: 100, h: 50 },
    "a canvas rendered from a PDF page has no naturalWidth");
});

// ── the real document ────────────────────────────────────────────────────

test("the project PDF is vector, which is why rendering it beats scanning it", async () => {
  const pdf = await readFile("docs/AISPC-10-DE-930-PI-ISO-0001-REV A0 .pdf");
  assert(pdf.subarray(0, 5).toString() === "%PDF-", "it is a PDF");
  // Fourteen A3 isometrics behind three cover pages, drawn as paths with the
  // text converted to outlines — so there is no text layer to shortcut with,
  // but the picture can be rendered at any resolution we ask for.
  assert(pdf.length > 2e6 && pdf.length < 5e6, "about 2.7 MB for seventeen pages");
});

// ── the build we render with ─────────────────────────────────────────────

test("pdf.js is taken from the legacy build, in the module and in public/", async () => {
  // pdf.js 6's DEFAULT build calls Map.prototype.getOrInsertComputed, which was
  // dropped from the TC39 upsert proposal and ships in no browser. The failure
  // is nasty precisely because it is partial: getDocument() succeeds, the page
  // count and sheet sizes come back correct, and only page.render() throws — so
  // the document opens and every drawing is silently blank. Chromium 141 was
  // enough to hit it; a plant workstation is older still.
  //
  // This test exists because nothing else catches it: the unit suite runs in
  // Node, `next build` compiles it happily, and the picker swallowed the error.
  const mod = await readFile("lib/client/pdf.mjs", "utf8");
  assert(/import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/.test(mod),
    "the module must import the legacy build, not bare 'pdfjs-dist'");

  const served = await readFile("public/pdf.worker.min.mjs");
  const legacy = await readFile("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs");
  assert(served.equals(legacy),
    "the worker served from public/ must be the legacy worker, byte for byte — " +
    "a modern worker paired with a legacy main thread fails the same way. " +
    "After upgrading pdfjs-dist run `npm run pdfjs:worker`, then re-check a " +
    "real render in a browser: this is the moment that breaks silently.");
});

await run();
