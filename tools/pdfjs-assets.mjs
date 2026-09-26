#!/usr/bin/env node
/**
 * Copy the pdf.js runtime assets this app serves into public/.
 *
 *   npm run pdfjs:assets
 *
 * pdf.js does not bundle these: it fetches them at run time from URLs the
 * caller supplies, and quietly degrades when they are missing.
 *
 *   wasm/            JBIG2 and JPEG2000 decoders. A SCANNED isometric is
 *                    normally bitonal JBIG2, so without these the sheet that
 *                    most needs reading is the one that will not decode.
 *   standard_fonts/  the base-14 fonts, for a PDF that names Helvetica or
 *                    Courier without embedding it — common in CAD exports.
 *
 * cmaps/ is deliberately not copied: it is CJK text encodings, 1.7 MB that
 * no drawing in this workflow will ever ask for.
 *
 * The files are committed rather than fetched on install, so a checkout
 * builds and runs without a postinstall step having to have succeeded.
 * db/test/pdf.mjs checks them against node_modules byte for byte, so an
 * upgrade of pdfjs-dist cannot leave a stale copy behind unnoticed.
 */
import { cp, mkdir, rm } from "node:fs/promises";

const FROM = "node_modules/pdfjs-dist";
const TO = "public/pdfjs";

await mkdir(TO, { recursive: true });

// The main-thread module and the worker must come from the same build.
await cp(`${FROM}/legacy/build/pdf.worker.min.mjs`, "public/pdf.worker.min.mjs");

for (const dir of ["wasm", "standard_fonts"]) {
  await rm(`${TO}/${dir}`, { recursive: true, force: true });
  await cp(`${FROM}/${dir}`, `${TO}/${dir}`, { recursive: true });
  console.log(`  ${TO}/${dir}`);
}
console.log("  public/pdf.worker.min.mjs");
