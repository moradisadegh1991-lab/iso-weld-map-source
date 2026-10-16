#!/usr/bin/env node
/**
 * Scaffold a golden case from a drawing.
 *
 *   npm run golden:add -- path/to/SW-265017A.jpg [extracted.json]
 *
 * The golden dataset is the bottleneck: three capabilities are waiting on 50
 * isometrics with hand-made registers. Fifty times through a text editor is
 * how a dataset stops at four, so the mechanical half is done here — reading
 * the drawing's resolution, copying it into place, wiring the file names
 * together — and the half that needs an engineer is left clearly unfilled.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not fill `expect` from the engine. `expect` is what the piping
 * engineer says the register is; filling it from the engine's own output
 * would make every case pass by construction and measure nothing at all. The
 * engine's answer is written into `_engineSays` instead, to compare against —
 * and where they disagree, that is a finding, not a number to copy across.
 */
import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import path from "node:path";
import { buildModel } from "../lib/engine.js";

const T = process.stdout.isTTY && !process.env.NO_COLOR;

const [drawingPath, payloadPath] = process.argv.slice(2);
if (!drawingPath) {
  console.error("usage: npm run golden:add -- <drawing.jpg|png> [extracted.json]");
  process.exit(2);
}

const GOLDEN = "eval/cases/golden";
const DRAWINGS = path.join(GOLDEN, "drawings");

const bytes = await readFile(drawingPath);
const dim = imageSize(bytes);
const id = path.basename(drawingPath).replace(/\.[^.]+$/, "").replace(/\s+/g, "-");
const casePath = path.join(GOLDEN, `${id}.json`);

console.log(`\ndrawing   ${drawingPath}`);
console.log(`size      ${(bytes.length / 1e6).toFixed(2)} MB`);

if (!dim) {
  console.log(`pixels    ${warn("could not read the header — JPEG and PNG are understood")}`);
} else {
  const long = Math.max(dim.w, dim.h);
  console.log(`pixels    ${dim.w} x ${dim.h}` +
    (long < 2200 ? `  ${bad(`too small — the BOM and small dimensions will not read reliably`)}`
     : long < 2500 ? `  ${warn("under 2500 px on the long edge; 300 DPI from the PDF is better")}`
     : `  ${ok("enough for the BOM to read")}`));
}

if (await exists(casePath)) {
  console.error(`\n${bad(`${casePath} already exists`)} — edit it rather than overwriting.`);
  process.exit(1);
}

await mkdir(DRAWINGS, { recursive: true });
const drawingDest = path.join(DRAWINGS, path.basename(drawingPath));
await copyFile(drawingPath, drawingDest);

let payload = null, engineSays = null;
if (payloadPath) {
  payload = JSON.parse(await readFile(payloadPath, "utf8"));
  const model = buildModel(payload, {});
  engineSays = model.error
    ? { error: model.error }
    : {
        weldCount: model.register.length,
        fieldWelds: model.register.filter((w) => w.loc === "Field").map((w) => w.no),
        spoolCount: model.spoolIds.length,
        girthWelds: model.register.filter((w) => w.role === "Girth").length,
        warnings: model.checks.filter((c) => c.status === "warn").map((c) => c.label),
      };
}

const scaffold = {
  id,
  kind: "golden",
  title: "",
  source: { drawingNo: payload?.meta?.drawingNo || "", revision: payload?.meta?.rev || "",
            sheet: payload?.meta?.sheet || "1/1", project: payload?.meta?.project || "",
            pipingClass: payload?.meta?.pipingClass || "" },
  drawing: path.relative(GOLDEN, drawingDest).split(path.sep).join("/"),
  resolution: dim ? { width: dim.w, height: dim.h } : null,
  provenance: "",
  verifiedBy: "",
  verifiedAt: "",
  options: { spoolMaxLen: 12000, maxPipeLength: 12000, strictBom: true },
  input: payload || { meta: {}, bom: [], nodes: [], edges: [] },
  expect: {},
  _engineSays: engineSays,
  _todo: [
    "expect را از روی رجیستر دستیِ تأییدشده پر کنید، نه از روی _engineSays.",
    "_engineSays فقط برای مقایسه است — هرجا با رجیستر دستی نخواند، یک finding است.",
    "هر کلیدی در expect که شخصاً تأیید نکرده‌اید را حذف کنید.",
    "provenance و verifiedBy را پر کنید: چه کسی رجیستر مرجع را ساخت و از کدام رویژن.",
    "وقتی تمام شد، _engineSays و _todo را حذف کنید.",
  ],
};

await writeFile(casePath, JSON.stringify(scaffold, null, 2) + "\n");

console.log(`\ncase      ${ok(casePath)}`);
console.log(`image     ${drawingDest}`);
if (engineSays) {
  console.log(`\n${dimText("what the engine makes of the extraction you supplied:")}`);
  console.log(`  ${JSON.stringify(engineSays)}`);
  console.log(`\n${warn("that is NOT the answer — it is what you are checking.")}`);
} else {
  console.log(`\n${dimText("no extraction supplied, so `input` is empty.")}`);
  console.log(`${dimText("run the drawing through the app, then paste the JSON tab into `input`.")}`);
}
console.log(`\nnext      ${casePath} را باز کنید و expect را از رجیستر دستی پر کنید.\n`);

// ── minimal image header reading, so this needs no dependency ────────────
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };     // PNG IHDR
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {        // JPEG SOF
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15, skipping the non-frame markers in that range
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function ok(s) { return T ? `\x1b[32m${s}\x1b[0m` : s; }
function warn(s) { return T ? `\x1b[33m${s}\x1b[0m` : s; }
function bad(s) { return T ? `\x1b[31m${s}\x1b[0m` : s; }
function dimText(s) { return T ? `\x1b[2m${s}\x1b[0m` : s; }
async function exists(p) { return access(p).then(() => true).catch(() => false); }
