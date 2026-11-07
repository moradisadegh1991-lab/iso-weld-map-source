/**
 * SLD extraction orchestration (Phase 12.3). One call turns a file's bytes into a draft ENVELOPE (lib/sld/envelope.mjs, contract lib/sld/extract/contract.mjs):
 *
 *   inspect → per page: native text | OCR · vector primitives | raster shapes → symbols → text blocks → association → envelope
 *
 * Hybrid by design: native PDF text and vector paths are used when the page has them; the raster reader (OCR + OpenCV) only where it does not (a scan), or when the
 * caller asks for it. No model is involved here. The reader's I/O is injectable (`deps`) so the whole path is tested without touching the system tools.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as realInputs from "./inputs.mjs";
import { LIMITS, fail, sniff, withTemp } from "./inputs.mjs";
import { pageModel } from "./geometry.mjs";
import { fromVectorPaths, fromRaster } from "./primitives.mjs";
import { buildPage, ENGINE } from "./pipeline.mjs";
import { CONTRACT } from "./contract.mjs";
import { VOCAB_VERSION } from "./vocab.mjs";
import { sizeOf, LIMITS as ENV } from "../envelope.mjs";

export const MODES = Object.freeze(["auto", "native", "ocr", "both"]);
const DEFAULTS = Object.freeze({ mode: "auto", maxPages: LIMITS.pages, dpi: 200, lang: "eng", maxConnectionLines: 2000, minNativeWords: 1, minVectorPaths: 1, assist: null });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/** the configuration that decides what a reading says; hashed into `source.hash` with the file and the engine, so the same file + settings is the same draft */
export function configOf(options = {}) {
  const c = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([k, v]) => k in DEFAULTS && v !== undefined)) };
  if (!MODES.includes(c.mode)) throw fail(400, "INVALID_OPTIONS", `mode must be one of ${MODES.join(", ")}`);
  c.maxPages = Math.min(Math.max(1, Math.floor(Number(c.maxPages) || DEFAULTS.maxPages)), LIMITS.pages);
  c.dpi = Math.min(Math.max(100, Math.floor(Number(c.dpi) || DEFAULTS.dpi)), 400);
  c.maxConnectionLines = Math.min(Math.max(0, Math.floor(Number(c.maxConnectionLines) ?? DEFAULTS.maxConnectionLines)), 10_000);
  c.assist = c.assist ? String(c.assist).slice(0, 80) : null;
  if (!/^[a-z]{3}(\+[a-z]{3})*$/.test(c.lang)) throw fail(400, "INVALID_OPTIONS", "lang must be tesseract language codes such as eng or eng+fas");
  return c;
}
export const sourceHash = (fileSha, config) => sha(`${fileSha}|${canon(config)}|${ENGINE.name}@${ENGINE.version}|${ENGINE.rules}|${ENGINE.association}|${VOCAB_VERSION}`).slice(0, 64);

/** words from the raster reader, tagged as OCR */
const ocrWords = (r) => (r.words || []).filter((w) => w?.t && Array.isArray(w.b) && w.b.length === 4).map((w) => ({ t: String(w.t), b: w.b.map(Number), c: Number(w.c) || 0, src: "ocr", ...(w.inner ? { inner: true } : {}) }));
const pdfWords = (spans) => spans.map((s) => ({ t: s.t, b: s.b, c: 1, src: "pdf" }));

/**
 * @param bytes   Buffer — the document's file
 * @param options see DEFAULTS
 * @param deps    { inputs, now, deadline } — injectable for tests
 * @returns { draft, stats, warnings }
 * @throws FILE_TOO_LARGE 413 · UNSUPPORTED_FILE 415 · TOO_MANY_PAGES 413 · PDF_ENCRYPTED/PDF_UNREADABLE 422 · PAGE_TOO_COMPLEX 413 · EXTRACTION_TIMEOUT 504 · TOOL_MISSING 501
 */
export async function extractSld(bytes, options = {}, deps = {}) {
  const inputs = deps.inputs ?? realInputs, now = deps.now ?? (() => new Date());
  const config = configOf(options);
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail(400, "EMPTY_FILE", "the document has no file");
  if (bytes.length > LIMITS.bytes) throw fail(413, "FILE_TOO_LARGE", `the file is ${bytes.length} bytes; the limit is ${LIMITS.bytes}`, { bytes: bytes.length, limit: LIMITS.bytes });
  const kind = sniff(bytes);
  if (!kind) throw fail(415, "UNSUPPORTED_FILE", "only PDF, PNG and JPEG files can be read as a single-line diagram");
  const fileSha = sha(bytes);
  const t0 = Date.now(), deadline = deps.deadline ?? t0 + LIMITS.totalMs;
  const tick = (what) => { if (Date.now() > deadline) throw fail(504, "EXTRACTION_TIMEOUT", `the reading did not finish in time (${what})`); };

  return withTemp(async (dir) => {
    const file = path.join(dir, kind === "pdf" ? "in.pdf" : kind === "png" ? "in.png" : "in.jpg");
    await writeFile(file, bytes);
    let pages, producer = null;
    if (kind === "pdf") ({ pages, producer } = await inputs.inspectPdf(file, { maxPages: config.maxPages }));
    else {
      const r = await inputs.rasterRead(file, { page: 1, dpi: config.dpi, kind, lang: config.lang, dir });
      if (r.error) throw fail(r.error.includes("large") ? 413 : 422, r.error.includes("large") ? "IMAGE_TOO_LARGE" : "IMAGE_UNREADABLE", `the image cannot be read: ${r.error}`);
      pages = [pageModel({ number: 1, mediaWidth: r.width, mediaHeight: r.height, rotation: 0, dpi: config.dpi, source: "image" })];
      deps._firstRaster = r;
    }
    const items = [], warnings = [], pageStats = [];
    for (const page of pages) {
      tick(`page ${page.number}`);
      let words = [], prims = [], textFrom = null, shapesFrom = null, raster = page.number === 1 ? deps._firstRaster : null;
      const needRaster = async () => (raster ??= await inputs.rasterRead(file, { page: page.number, dpi: config.dpi, kind, lang: config.lang, dir }));
      if (kind === "pdf") {
        const native = config.mode === "ocr" ? [] : await inputs.nativeText(file, page.number);
        const useNative = config.mode !== "ocr" && native.length >= config.minNativeWords;
        const paths = config.mode === "ocr" ? [] : await inputs.vectorPaths(file, page.number, dir);
        const drawn = paths.filter((p) => { const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]); return !(Math.max(...xs) - Math.min(...xs) >= 0.95 * page.width && Math.max(...ys) - Math.min(...ys) >= 0.95 * page.height); });   // a page-sized clip is not a drawing
        const useVector = config.mode !== "ocr" && drawn.length >= config.minVectorPaths;
        tick(`page ${page.number} inspected`);
        if (useNative) { words = pdfWords(native); textFrom = "pdf-text"; }
        if (useVector) { prims = fromVectorPaths(paths); shapesFrom = "vector"; }
        if (!useNative || !useVector || config.mode === "both" || config.mode === "ocr") {
          const r = await needRaster();
          if (r.error) warnings.push({ code: "RASTER_FAILED", page: page.number, message: String(r.error) });
          else {
            if (!useNative || config.mode === "both" || config.mode === "ocr") {
              const ow = ocrWords(r);
              // `both`: OCR words that duplicate a native word at the same place are dropped
              words = config.mode === "both" ? [...words, ...ow.filter((o) => !words.some((w) => Math.abs(w.b[0] - o.b[0]) < 3 && Math.abs(w.b[1] - o.b[1]) < 3))] : ow;
              textFrom = useNative && config.mode === "both" ? "pdf-text+ocr" : "ocr";
            }
            if (!useVector) { prims = fromRaster(r.primitives || []); shapesFrom = "raster"; }
          }
        }
        if (!useNative && !words.length) warnings.push({ code: "NO_TEXT_FOUND", page: page.number });
        if (page.rotation) warnings.push({ code: "PAGE_ROTATED", page: page.number, rotation: page.rotation, note: "coordinates are in the displayed (rotated) frame" });
      } else {
        const r = await needRaster();
        words = ocrWords(r); prims = fromRaster(r.primitives || []); textFrom = "ocr"; shapesFrom = "raster";
      }
      const built = buildPage({ page, words, prims, fileSha, maxConnectionLines: config.maxConnectionLines });
      items.push(...built.items); warnings.push(...built.warnings);
      pageStats.push({ page: page.number, text: textFrom, shapes: shapesFrom, words: words.length, primitives: prims.length, ...built.stats });
    }
    // the envelope's size ceiling: connection lines are the first thing a dense page gives up, and the draft says so
    let list = items, trimmed = 0;
    const env0 = (its) => ({ items: its });
    while (sizeOf(env0(list)) > ENV.bytes * 0.8 && list.some((i) => i.kind === "line")) {
      const lines = list.filter((i) => i.kind === "line");
      const drop = new Set(lines.slice(Math.floor(lines.length / 2)).map((i) => i.uid));
      trimmed += drop.size; list = list.filter((i) => !drop.has(i.uid));
    }
    if (trimmed) warnings.push({ code: "CONNECTION_LINES_DROPPED_FOR_SIZE", dropped: trimmed });
    if (list.length > ENV.items) throw fail(413, "PAYLOAD_TOO_LARGE", `the reading found ${list.length} items; the limit is ${ENV.items}`, { limit: ENV.items });
    const configHash = sha(canon(config)).slice(0, 16);
    const hash = sourceHash(fileSha, config);
    const draft = {
      kind: "sld", schema: 1,
      meta: { contract: { ...CONTRACT }, engine: { ...ENGINE, vocab: VOCAB_VERSION }, tools: deps.tools ?? (inputs.toolVersions ? await inputs.toolVersions().catch(() => ({})) : {}),
        config, configHash, file: { sha256: fileSha, kind, bytes: bytes.length, producer }, pages, pageStats, stats: sumStats(pageStats), warnings,
        confidence: "heuristic: a rule score, not a probability; not calibrated on real drawings", edges: "none: connectivity is not extracted in this phase" },
      page: { count: pages.length, firstPage: pages[0] },
      items: list, edges: [],
      source: { kind: "sld-extraction", reader: `${ENGINE.name}/${ENGINE.version}`, hash, generatedAt: now().toISOString() },
    };
    return { draft, stats: draft.meta.stats, warnings, ms: Date.now() - t0 };
  });
}
const sumStats = (ps) => ps.reduce((t, p) => ({ symbols: t.symbols + p.symbols, unknown: t.unknown + p.unknown, texts: t.texts + p.texts, lines: t.lines + p.lines, links: t.links + p.links }), { symbols: 0, unknown: 0, texts: 0, lines: 0, links: 0 });
