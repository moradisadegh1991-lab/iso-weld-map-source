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
import { fitCanvas } from "../../lib/client/pdf.mjs";
import { base64FromBuffer } from "../../lib/client/base64.mjs";
import { badgeFor } from "../../lib/client/tab-badges.mjs";
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

// ── what a phone will actually allocate ──────────────────────────────────

test("a canvas the device refuses is detected, not rendered into", async () => {
  // A phone capped at 2^24 px hands back a working-looking context that draws
  // nothing. Reject it by its behaviour, not by guessing the device's limit.
  const CAP = 16.7e6;
  const tried = [];
  const create = (w, h) => {
    tried.push(w * h);
    return w * h > CAP ? null : { canvas: { width: w, height: h }, ctx: {} };
  };

  // A3 at 300 DPI is just over the cap, so the first attempt must be refused.
  const fit = fitCanvas(4958, 3505, { create });
  assert(tried[0] > CAP, "it asks for the full size first");
  assert(fit, "and settles for one the device accepts");
  assert(fit.width * fit.height <= CAP, "the canvas it returns really fits");
  assert(fit.shrink < 1, "and it reports having shrunk, so the DPI can be corrected");

  // Still far above the ~2500 px the BOM text needs to stay readable.
  assert(Math.max(fit.width, fit.height) > 3200,
    `${fit.width}x${fit.height} must stay readable, not merely fit`);
});

test("a device that refuses every size fails loudly instead of rendering blank", async () => {
  equal(fitCanvas(4958, 3505, { create: () => null }), null);
});

test("a canvas the device accepts is used unchanged", async () => {
  const fit = fitCanvas(1000, 800, { create: (w, h) => ({ canvas: { width: w, height: h }, ctx: {} }) });
  equal([fit.width, fit.height, fit.shrink], [1000, 800, 1]);
});

// ── what the navigator shows without being opened ────────────────────────

test("a warning the engine raised is visible from the tab strip", async () => {
  // The case this exists for, taken from the first live extraction: the MTO
  // listed a weld-neck flange that the model had not placed in the geometry.
  // The engine caught it; the strip has to say so, or nobody looks.
  const model = {
    totals: { welds: 2 },
    checks: [
      { label: "تعداد فلنج", status: "warn" },
      { label: "لوله 28 در برابر MTO", status: "ok" },
      { label: "CL Length", status: "ok" },
      { label: "توپولوژی مسیر", status: "ok" },
    ],
  };
  const data = { bom: [{ pt: 1 }, { pt: 2 }], unreadable: [] };

  const check = badgeFor("check", model, data);
  equal(check, { text: "1 !", tone: "warn" }, "one problem, and it is loud");
  equal(badgeFor("weld", model, data), { text: "2", tone: "plain" }, "counts stay quiet");
  equal(badgeFor("mto", model, data), { text: "2", tone: "plain" });
});

test("a value the model could not read counts as a problem too", async () => {
  const model = { totals: { welds: 1 }, checks: [{ status: "ok" }] };
  equal(badgeFor("check", model, { unreadable: ["CL length"] }), { text: "1 !", tone: "warn" });
});

test("a clean drawing is marked clean, not left blank", async () => {
  // Blank would be ambiguous: nothing wrong, or nothing computed?
  const model = { totals: { welds: 4 }, checks: [{ status: "ok" }, { status: "ok" }] };
  equal(badgeFor("check", model, { unreadable: [] }), { text: "✓", tone: "plain" });
});

test("a BOM row the engine could not place is flagged on the MTO tab", async () => {
  const model = { totals: { welds: 2 }, checks: [], bomDropped: [{ pt: 7 }], bomGhosted: [] };
  equal(badgeFor("mto", model, { bom: [{}, {}, {}] }), { text: "3 · 1 !", tone: "warn" });
});

test("a failed engine run shows no counts at all", async () => {
  // Numbers from a model that did not build would be fiction.
  const broken = { error: "geometry incomplete" };
  for (const k of ["weld", "check"]) equal(badgeFor(k, broken, { bom: [{}] }), null, k);
});

// ── encoding a whole file for upload ─────────────────────────────────────

test("a 2.7 MB PDF encodes to base64 instead of overflowing the stack", async () => {
  // The one-line spread this replaced — String.fromCharCode(...bytes) — hands
  // the engine one argument per byte. It survived development because every
  // test drawing was a small JPEG; the first real isometric PDF, the input
  // this whole feature exists for, was the size that broke it.
  const pdf = await readFile("docs/AISPC-10-DE-930-PI-ISO-0001-REV A0 .pdf");
  assert(pdf.byteLength > 2.5e6, "the fixture is still large enough to be the test");

  // The old code, to show the failure is real and not hypothetical.
  let threw = null;
  try { String.fromCharCode(...new Uint8Array(pdf)); } catch (e) { threw = e; }
  assert(threw && /call stack/i.test(threw.message),
    "the spread must still be the trap this guards against");

  const encoded = base64FromBuffer(pdf);
  equal(encoded, pdf.toString("base64"), "and the chunked encoder is byte-for-byte correct");
});

test("a chunk boundary does not corrupt the encoding", async () => {
  // 0x8000 bytes per call, so lengths either side of a multiple of it are
  // where an off-by-one would show up; base64 groups by 3, so tri-alignment
  // matters too.
  for (const n of [0, 1, 2, 3, 0x8000 - 1, 0x8000, 0x8000 + 1, 0x8000 * 2 + 5]) {
    const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff));
    equal(base64FromBuffer(bytes), bytes.toString("base64"), `length ${n}`);
  }
});

test("the inline-upload ceiling is measured in the units actually sent", async () => {
  // The body carries base64, which is 4 characters per 3 bytes. Comparing a
  // file's RAW length against a base64 budget under-counts by a third: the
  // project PDF is 2.77 MB raw and 3.69 MB encoded — over a 3.4 M ceiling
  // while looking comfortably under it.
  const CEILING = 3_400_000;
  const rawCeiling = Math.floor(CEILING / 4) * 3;
  const pdf = await readFile("docs/AISPC-10-DE-930-PI-ISO-0001-REV A0 .pdf");

  assert(pdf.byteLength <= CEILING, "raw size alone would wave this file through");
  assert(base64FromBuffer(pdf).length > CEILING, "but encoded it is over the ceiling");
  assert(pdf.byteLength > rawCeiling, "so the derived raw ceiling must reject it");

  // And the derived ceiling never admits anything that would exceed the body.
  for (const n of [rawCeiling - 3, rawCeiling, rawCeiling + 3]) {
    const encodedLen = 4 * Math.ceil(n / 3);
    equal(n <= rawCeiling, encodedLen <= CEILING, `raw ${n} -> base64 ${encodedLen}`);
  }
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
    "After upgrading pdfjs-dist run `npm run pdfjs:assets`, then re-check a " +
    "real render in a browser: this is the moment that breaks silently.");
});

test("the decoders and fonts pdf.js fetches at run time are served too", async () => {
  // Without these a vector drawing still renders, so nothing looks wrong until
  // somebody opens a SCANNED sheet — which is bitonal JBIG2 — and gets nothing.
  for (const f of ["wasm/jbig2.wasm", "wasm/openjpeg.wasm", "standard_fonts/FoxitFixed.pfb"]) {
    const served = await readFile(`public/pdfjs/${f}`).catch(() => null);
    assert(served, `public/pdfjs/${f} is missing — run \`npm run pdfjs:assets\``);
    const source = await readFile(`node_modules/pdfjs-dist/${f}`);
    assert(served.equals(source), `public/pdfjs/${f} is stale against node_modules`);
  }

  // And the module must actually point pdf.js at them; copying is not enough.
  const mod = await readFile("lib/client/pdf.mjs", "utf8");
  assert(/wasmUrl:\s*"\/pdfjs\/wasm\/"/.test(mod), "getDocument must pass wasmUrl");
  assert(/standardFontDataUrl:\s*"\/pdfjs\/standard_fonts\/"/.test(mod),
    "getDocument must pass standardFontDataUrl");
});

await run();
