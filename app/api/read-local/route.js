export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { readerMissing, readerMissingText } from "../../../lib/server/reader-deps.mjs";

const run = promisify(execFile);

/**
 * POST { projectId, pdfBase64, page } — the weld markers printed on one
 * sheet of an isometric PDF, read on this server with no model and no
 * token: OpenCV finds the frames, a local tesseract reads their numbers
 * (tools/iso-read.py; measured on the golden sheets by eval/reader-report.mjs).
 *
 * Only what is printed comes back: at each marker its number, frame shape
 * and outline, the label beside it and where on the page it is; from the title block the isometric
 * number, sheet and revision, each null when it was not read for certain. Shop or field, the joint type and the
 * register are decided in the page by lib/register/weld-marks.mjs, exactly
 * as for a model's reading, and a person completes what was not printed.
 *
 * A server without python3, OpenCV, NumPy, tesseract or poppler says which
 * of them is missing and the package to install (lib/server/reader-deps.mjs);
 * it does not fall back to anything.
 */
export async function POST(request) {
  let dir = null;
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, pdfBase64 } = body;
    const page = Math.max(1, Math.floor(Number(body.page) || 1));
    if (!projectId || !pdfBase64) return Response.json({ error: "projectId and pdfBase64 are required" }, { status: 400 });
    const { membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.RUN_EXTRACTION);
    const bytes = Buffer.from(String(pdfBase64), "base64");
    if (bytes.subarray(0, 5).toString() !== "%PDF-") return Response.json({ error: "خواندن بدون مدل فقط برای فایل PDF است." }, { status: 400 });
    if (bytes.length > 40 * 1024 * 1024) return Response.json({ error: "فایل PDF بزرگ‌تر از ۴۰ مگابایت است." }, { status: 413 });
    dir = await mkdtemp(path.join(tmpdir(), "isoread-"));
    const file = path.join(dir, "sheet.pdf");
    await writeFile(file, bytes);
    const t0 = Date.now();
    let out;
    try {
      ({ stdout: out } = await run("python3", ["-I", path.join(process.cwd(), "tools/iso-read.py"), file, "--page", String(page)],
        { timeout: 110_000, maxBuffer: 1 << 24, env: { ...process.env, OMP_THREAD_LIMIT: "1" } }));
    } catch (e) {
      // name what is missing, with the package that brings it, rather than guess from the error text
      const missing = await readerMissing().catch(() => []);
      if (missing.length) return Response.json({ error: readerMissingText(missing), missing: missing.map((m) => m.pkg) }, { status: 501 });
      return Response.json({ error: `خواندن بدون مدل ناموفق بود: ${String(e.stderr || e.message).trim().split("\n").pop()}` }, { status: 500 });
    }
    const r = JSON.parse(out);
    // in weld-number order (1, 2, … 4, 4-1, 5), not the order they were found on the page
    const key = (no) => String(no).split("-").map(Number);
    // `at`: the marker's centre as fractions of the page as rendered, for the review beside the drawing
    const marks = r.marks.map(({ no, shape, outline, label, at }) => ({ no, shape, outline, label, ...(Array.isArray(at) ? { at } : {}) }))
      .sort((a, b) => { const [x, y] = [key(a.no), key(b.no)]; return x[0] - y[0] || (x[1] || 0) - (y[1] || 0); });
    // the title block: a field not read for certain is null, and stays for the person
    const meta = { drawingNo: r.meta?.drawingNo ?? null, sheet: r.meta?.sheet ?? null, rev: r.meta?.rev ?? null };
    return Response.json({ marks, meta,
      orientation: r.orientation, ms: Date.now() - t0, reader: "tools/iso-read.py (OpenCV + tesseract, no model)" });
  } catch (e) { return errorResponse(e); }
  finally { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
