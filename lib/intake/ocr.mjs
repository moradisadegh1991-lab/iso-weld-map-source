/**
 * OCR of the scanned pages of a received PDF — what the page shows, word by
 * word, with how sure the engine was of each word. Nothing is interpreted
 * here; lib/intake/extract.mjs reads the words like any other text, and a
 * word the engine was unsure of makes its number "to be checked".
 *
 * Engine: Tesseract (apt: tesseract-ocr, poppler-utils). The page is
 * rendered by pdftoppm and read with page segmentation 11 (sparse text:
 * a drawing is scattered labels, not paragraphs). RapidOCR, used for the
 * K110 set (tools/pid-ocr.py), was measured against the same scan and
 * dropped the spaces between labels ("30-E-1101AQUENCH…"), which loses the
 * boundaries a number is recognised by; it is not used here.
 *
 *   OCR_ENGINE=off          never run OCR (scans stay "needs OCR")
 *   OCR_DPI=300             render resolution
 *   OCR_MAX_PAGES=40        pages read per document, at most
 *   OCR_LANG=eng            tesseract language(s)
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const env = (k, d) => process.env[k] || d;

function sh(cmd, args, { timeoutMs = 300000, input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`${cmd}: بیش از ${Math.round(timeoutMs / 1000)} ثانیه طول کشید`)); }, timeoutMs);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { clearTimeout(t); reject(e); });
    p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(`${cmd} (${code}): ${err.slice(0, 200)}`)); });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

let probed = null;
/** The engine this server can run, or null with the reason. Probed once. */
export async function ocrEngine() {
  if (env("OCR_ENGINE", "tesseract") === "off") return { engine: null, why: "OCR روی این سرور خاموش است (OCR_ENGINE=off)." };
  if (!probed) {
    probed = (async () => {
      try {
        const v = (await sh("tesseract", ["--version"], { timeoutMs: 10000 })).split("\n")[0].trim();
        await sh("pdftoppm", ["-v"], { timeoutMs: 10000 }).catch((e) => { if (/ENOENT/.test(e.code || e.message)) throw e; });
        return { engine: "tesseract", version: v };
      } catch {
        return { engine: null, why: "Tesseract روی سرور نصب نیست (apt install tesseract-ocr poppler-utils)." };
      }
    })();
  }
  return probed;
}

/**
 * Tesseract TSV → words. Box in PDF points (top-left origin), confidence
 * 0..1, and the reading line each word sits on.
 */
export function parseTsv(tsv, { dpi }) {
  const s = 72 / dpi;
  const words = [];
  for (const row of String(tsv).split("\n").slice(1)) {
    const f = row.split("\t");
    if (f.length < 12 || f[0] !== "5") continue;
    const text = f.slice(11).join("\t").trim();
    const conf = Number(f[10]);
    if (!text || !(conf >= 0)) continue;
    const [left, top, width, height] = f.slice(6, 10).map(Number);
    words.push({ t: text, c: Math.round(conf) / 100, line: `${f[2]}.${f[3]}.${f[4]}`,
      b: [left * s, top * s, (left + width) * s, (top + height) * s].map((v) => Math.round(v * 10) / 10) });
  }
  return words;
}

/** Words → reading lines (the engine's own line grouping), each with its weakest word. */
export function linesOf(words) {
  const by = new Map();
  for (const w of words) {
    if (!by.has(w.line)) by.set(w.line, []);
    by.get(w.line).push(w);
  }
  return [...by.values()].map((ws) => {
    ws.sort((a, b) => a.b[0] - b.b[0]);
    return { text: ws.map((w) => w.t).join(" "), c: Math.min(...ws.map((w) => w.c)), words: ws,
      y: Math.min(...ws.map((w) => w.b[1])), x: Math.min(...ws.map((w) => w.b[0])) };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * OCR the given pages (1-based) of a PDF. Returns
 * [{ n, words, lines, text, conf }] — conf is the mean word confidence.
 */
export async function ocrPdf(bytes, pages, { dpi = Number(env("OCR_DPI", 300)), lang = env("OCR_LANG", "eng") } = {}) {
  const { engine, why } = await ocrEngine();
  if (!engine) throw new Error(why);
  const dir = await mkdtemp(path.join(tmpdir(), "epc-ocr-"));
  try {
    const pdf = path.join(dir, "in.pdf");
    await writeFile(pdf, bytes);
    const out = [];
    for (const n of pages.slice(0, Number(env("OCR_MAX_PAGES", 40)))) {
      await sh("pdftoppm", ["-r", String(dpi), "-gray", "-png", "-f", String(n), "-l", String(n), pdf, path.join(dir, `p${n}`)]);
      const png = (await readdir(dir)).find((f) => f.startsWith(`p${n}-`) && f.endsWith(".png"));
      if (!png) { out.push({ n, words: [], lines: [], text: "", conf: null }); continue; }
      const tsv = await sh("tesseract", [path.join(dir, png), "-", "-l", lang, "--psm", "11", "tsv"]);
      await rm(path.join(dir, png), { force: true });
      const words = parseTsv(tsv, { dpi });
      const lines = linesOf(words);
      const conf = words.length ? Math.round((words.reduce((s, w) => s + w.c, 0) / words.length) * 100) / 100 : null;
      out.push({ n, words, lines, text: lines.map((l) => l.text).join("\n"), conf });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
