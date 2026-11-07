/**
 * The I/O half of the SLD reader (Phase 12.3): PDF inspection, native text, vector primitives, and the raster reader (OCR + shapes) — each a poppler / tesseract /
 * OpenCV call with a timeout and an output cap. Everything returned is in the page's DISPLAY frame (lib/sld/extract/geometry.mjs). No interpretation here.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pageModel } from "./geometry.mjs";

const run = promisify(execFile);
export const LIMITS = Object.freeze({ bytes: 40 * 1024 * 1024, pages: 20, primitivesPerPage: 60_000, textSpansPerPage: 20_000, imagePixels: 80_000_000,
  timeoutMs: { info: 15_000, text: 45_000, svg: 90_000, raster: 150_000 }, totalMs: 280_000 });

export const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });
const missing = (e) => e?.code === "ENOENT";
async function tool(cmd, args, { timeout, maxBuffer = 1 << 26 } = {}) {
  try { return (await run(cmd, args, { timeout, maxBuffer, killSignal: "SIGKILL" })).stdout; }
  catch (e) {
    if (missing(e)) throw fail(501, "TOOL_MISSING", `${cmd} is not installed on this server`, { tool: cmd });
    if (e.killed || e.signal === "SIGKILL") throw fail(504, "EXTRACTION_TIMEOUT", `${cmd} did not finish within ${Math.round(timeout / 1000)} s`, { tool: cmd });
    throw fail(422, "PDF_UNREADABLE", `${cmd} could not read the file: ${String(e.stderr || e.message).trim().split("\n").pop().slice(0, 200)}`, { tool: cmd });
  }
}

/** sniff the file kind from its bytes (never from the name or the client's content type) */
export function sniff(bytes) {
  const h = bytes.subarray(0, 8);
  if (h.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (h[0] === 0x89 && h.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (h[0] === 0xff && h[1] === 0xd8) return "jpeg";
  return null;
}

export async function withTemp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "sldx-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** PDF inspection: page count, per-page size and rotation, encryption, metadata. Uses `pdfinfo` (page boxes are UNROTATED; geometry.pageModel swaps for rotation). */
export async function inspectPdf(file, { maxPages = LIMITS.pages } = {}) {
  const head = await tool("pdfinfo", [file], { timeout: LIMITS.timeoutMs.info });
  const get = (k) => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(head)?.[1]?.trim() ?? null;
  const pages = Number(get("Pages"));
  if (!Number.isInteger(pages) || pages < 1) throw fail(422, "PDF_UNREADABLE", "the file has no pages");
  if (get("Encrypted")?.startsWith("yes")) throw fail(422, "PDF_ENCRYPTED", "the PDF is encrypted; remove the protection and upload it again");
  if (pages > maxPages) throw fail(413, "TOO_MANY_PAGES", `the PDF has ${pages} pages; the limit is ${maxPages}`, { pages, limit: maxPages });
  const detail = await tool("pdfinfo", ["-f", "1", "-l", String(pages), file], { timeout: LIMITS.timeoutMs.info });
  const out = [];
  for (let n = 1; n <= pages; n++) {
    const size = new RegExp(`^Page\\s+${n}\\s+size:\\s+([\\d.]+)\\s+x\\s+([\\d.]+)`, "m").exec(detail), rot = new RegExp(`^Page\\s+${n}\\s+rot:\\s+(-?\\d+)`, "m").exec(detail);
    if (!size) throw fail(422, "PDF_UNREADABLE", `page ${n} has no readable size`);
    out.push(pageModel({ number: n, mediaWidth: Number(size[1]), mediaHeight: Number(size[2]), rotation: rot ? Number(rot[1]) : 0 }));
  }
  return { pages: out, producer: get("Producer"), creator: get("Creator"), title: get("Title") };
}

/** native text of one page: words with display-frame boxes (pdftotext -bbox-layout also gives lines; words are what is kept, grouped later by the line). */
export async function nativeText(file, pageNo) {
  const xml = await tool("pdftotext", ["-bbox-layout", "-f", String(pageNo), "-l", String(pageNo), file, "-"], { timeout: LIMITS.timeoutMs.text });
  const spans = [];
  const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  let lineNo = -1;
  for (const m of xml.matchAll(/<line\b[^>]*>|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)) {
    if (m[0].startsWith("<line")) { lineNo++; continue; }
    const t = dec(m[5]).trim();
    if (!t) continue;
    spans.push({ t, b: [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])], line: lineNo });
    if (spans.length > LIMITS.textSpansPerPage) throw fail(413, "PAGE_TOO_COMPLEX", `page ${pageNo} has more than ${LIMITS.textSpansPerPage} text spans`);
  }
  return spans;
}

// ── vector primitives from pdftocairo's SVG ──────────────────────────────────────────────────────────────
const num = (s) => s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
function parseD(d) {
  const subs = []; let cur = null;
  for (const [, cmd, args] of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const v = num(args);
    if (cmd === "M") { cur = { pts: [[v[0], v[1]]], curves: 0, closed: false }; subs.push(cur); }
    else if (!cur) continue;
    else if (cmd === "L") for (let i = 0; i + 1 < v.length; i += 2) cur.pts.push([v[i], v[i + 1]]);
    else if (cmd === "C") for (let i = 0; i + 5 < v.length; i += 6) { cur.curves++; cur.pts.push([v[i + 4], v[i + 5]]); cur.ctrl = [...(cur.ctrl || []), [v[i], v[i + 1]], [v[i + 2], v[i + 3]]]; }
    else if (cmd === "Z") cur.closed = true;
  }
  return subs;
}
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** the vector strokes / fills of one page as raw sub-paths: [{ pts, curves, closed, lw, filled }] (display frame). Glyph outlines (<defs>) are not included. */
export async function vectorPaths(file, pageNo, dir) {
  const out = path.join(dir, `v${pageNo}.svg`);
  await tool("pdftocairo", ["-svg", "-f", String(pageNo), "-l", String(pageNo), file, out], { timeout: LIMITS.timeoutMs.svg });
  const svg = await readFile(out, "utf8");
  const body = svg.slice(svg.indexOf("</defs>") + 7);
  const paths = [];
  for (const m of body.matchAll(/<path\b([^>]*?)\sd="([^"]+)"([^>]*)\/>/g)) {
    const attrs = `${m[1]} ${m[3]}`;
    const tm = /transform="matrix\(([^)]*)\)"/.exec(attrs);
    const mat = tm ? num(tm[1]) : [1, 0, 0, 1, 0, 0];
    const lw = Number(/stroke-width="([\d.]+)"/.exec(attrs)?.[1] ?? 0) * Math.sqrt(Math.abs(mat[0] * mat[3] - mat[1] * mat[2]) || 1);
    const filled = !/fill="none"/.test(attrs) && /fill="/.test(attrs);
    for (const s of parseD(m[2])) {
      paths.push({ pts: s.pts.map((p) => apply(mat, p)), curves: s.curves, closed: s.closed, lw: Math.round(lw * 100) / 100, filled });
      if (paths.length > LIMITS.primitivesPerPage) throw fail(413, "PAGE_TOO_COMPLEX", `page ${pageNo} has more than ${LIMITS.primitivesPerPage} vector paths`);
    }
  }
  return paths;
}

/** the raster reader (tools/sld-raster.py): OCR words + shape primitives of one page or image, in display points. */
export async function rasterRead(file, { page = 1, dpi = 200, kind = "pdf", lang = "eng", dir }) {
  const out = await tool("python3", ["-I", path.join(process.cwd(), "tools/sld-raster.py"), file, "--page", String(page), "--dpi", String(dpi), "--kind", kind, "--lang", lang, "--max-pixels", String(LIMITS.imagePixels)],
    { timeout: LIMITS.timeoutMs.raster, maxBuffer: 1 << 27 });
  void dir;
  try { return JSON.parse(out); } catch { throw fail(500, "RASTER_READER_FAILED", "the raster reader returned no JSON"); }
}

/** tool versions recorded in the draft (so a reading can be reproduced) */
export async function toolVersions() {
  const v = {};
  const first = async (cmd, args) => { try { const r = await run(cmd, args, { timeout: 15_000 }); return String(r.stdout || r.stderr).trim().split("\n")[0].slice(0, 80); } catch (e) { return String(e.stderr || e.stdout || "").trim().split("\n")[0].slice(0, 80) || null; } };
  v.pdftotext = await first("pdftotext", ["-v"]); v.pdftocairo = await first("pdftocairo", ["-v"]); v.tesseract = await first("tesseract", ["--version"]);
  v.opencv = await first("python3", ["-I", "-c", "import cv2;print('opencv '+cv2.__version__)"]);
  return v;
}
void writeFile;
