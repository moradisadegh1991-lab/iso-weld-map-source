/**
 * Reading isometrics out of a PDF, in the browser.
 *
 * WHY THE BROWSER
 *
 * The extraction pipeline already prepares images client-side — the sheet is
 * tiled and compressed there so that what crosses the network is a few
 * hundred kilobytes of JPEG rather than a multi-megabyte original. Rendering
 * the PDF anywhere else would mean uploading the whole document first and
 * losing that, so the PDF joins the pipeline at the same point an image does.
 *
 * WHY THIS MATTERS MORE THAN IT SOUNDS
 *
 * A CAD-exported isometric is VECTOR. Rendering it at 300 DPI produces a
 * cleaner image than any scan of the same drawing, and the resolution is a
 * choice rather than something inherited from whoever operated the scanner.
 * A 420 x 297 mm sheet at 300 DPI is 4959 x 3505 px — twice the 2500 px the
 * BOM text needs to read reliably.
 *
 * The text in such a PDF is usually converted to outlines, so there is no
 * text layer to shortcut with. The vision model still has to read it; it just
 * gets a much better picture to read.
 */

let pdfjs = null;

async function lib() {
  if (pdfjs) return pdfjs;
  // Loaded on demand: a session that never opens a PDF never pays for it.
  //
  // The LEGACY build, deliberately. pdf.js 6's default build calls
  // Map.prototype.getOrInsertComputed, which was dropped from the TC39 upsert
  // proposal and ships in no browser: on Chromium 141 every page.render()
  // throws "getOrInsertComputed is not a function" while getDocument() still
  // succeeds, so the document opens and only the drawing comes back blank.
  // Plant workstations run older, locked-down browsers than that, so the
  // transpiled build is the floor, not a concession.
  pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";  // legacy worker
  return pdfjs;
}

export const isPdf = (file) =>
  file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");

/**
 * Open a PDF and describe its pages.
 *
 * @returns {Promise<{doc, pages: Array<{index, widthMm, heightMm, label}>}>}
 */
export async function openPdf(file) {
  const { getDocument } = await lib();
  const buf = await file.arrayBuffer();
  const doc = await getDocument({ data: buf }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const [, , w, h] = page.view;                    // PDF points, 72 per inch
    pages.push({
      index: i,
      widthMm: Math.round((w / 72) * 25.4),
      heightMm: Math.round((h / 72) * 25.4),
      label: sheetLabel(w, h),
    });
  }
  return { doc, pages };
}

/**
 * Render one page to a canvas at a target DPI.
 *
 * Capped rather than trusted: a very large sheet at 300 DPI can exceed what a
 * browser will allocate for a canvas, and failing with a blank image halfway
 * through an upload is worse than rendering slightly smaller.
 */
export async function renderPage(doc, index, { dpi = 300, maxPixels = 40e6 } = {}) {
  const page = await doc.getPage(index);
  let scale = dpi / 72;
  let viewport = page.getViewport({ scale });

  if (viewport.width * viewport.height > maxPixels) {
    scale *= Math.sqrt(maxPixels / (viewport.width * viewport.height));
    viewport = page.getViewport({ scale });
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  // Line art on transparent background renders as black-on-black without this.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
  return { canvas, effectiveDpi: Math.round(scale * 72) };
}

/** Small preview, for choosing which sheet to work on. */
export async function renderThumbnail(doc, index, { width = 220 } = {}) {
  const page = await doc.getPage(index);
  const base = page.getViewport({ scale: 1 });
  const { canvas } = await renderPage(doc, index, { dpi: (width / base.width) * 72 });
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** ISO sheet size, when the page is one — it is how drawing offices talk. */
function sheetLabel(wPt, hPt) {
  const mm = [wPt, hPt].map((v) => (v / 72) * 25.4).sort((a, b) => a - b);
  const sizes = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
  for (const [name, [s, l]] of Object.entries(sizes)) {
    if (Math.abs(mm[0] - s) < 6 && Math.abs(mm[1] - l) < 6) return name;
  }
  return `${Math.round(mm[1])}×${Math.round(mm[0])} mm`;
}
