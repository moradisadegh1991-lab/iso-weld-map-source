/**
 * Synthetic SLD sheets (a tiny PDF writer): vector shapes + native text, any page rotation, or an image-only (scanned) page with noise / low resolution.
 * Everything is drawn in the DISPLAY frame (points, origin top-left, y down); the writer maps it to the PDF's user space for /Rotate 0|90|180|270.
 * These sheets are SYNTHETIC: they exercise the extraction engine; they say nothing about real drawings.
 */
import { deflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const f = (n) => (Math.round(n * 1000) / 1000).toString();
/** display (x, y) → user space of an unrotated page Wu×Hu shown with /Rotate = rot */
export function toUser(x, y, rot, Wu, Hu) {
  switch (rot) { case 90: return [y, x]; case 180: return [Wu - x, y]; case 270: return [Wu - y, Hu - x]; default: return [x, Hu - y]; }
}
const BASIS = { 0: [1, 0, 0, 1], 90: [0, 1, -1, 0], 180: [-1, 0, 0, -1], 270: [0, -1, 1, 0] };     // [right.x, right.y, up.x, up.y] in user space

/** page: { width, height (DISPLAY points), rotate, shapes: [...] }; shape kinds: line, rect, circle, poly, text */
function pageStream(pg) {
  const rot = pg.rotate || 0, dw = pg.width, dh = pg.height;
  const Wu = rot % 180 ? dh : dw, Hu = rot % 180 ? dw : dh;
  const U = (x, y) => toUser(x, y, rot, Wu, Hu);
  const out = [];
  const stroke = (lw, fill) => `${f(lw ?? 1)} w ${fill ? "f*" : "S"}`;
  for (const s of pg.shapes) {
    if (s.k === "line") { const [a, b] = [U(s.x0, s.y0), U(s.x1, s.y1)]; out.push(`${f(s.lw ?? 1)} w ${f(a[0])} ${f(a[1])} m ${f(b[0])} ${f(b[1])} l S`); }
    else if (s.k === "rect") {
      const pts = [[s.x0, s.y0], [s.x1, s.y0], [s.x1, s.y1], [s.x0, s.y1]].map(([x, y]) => U(x, y));
      out.push(`${f(s.lw ?? 1)} w ${pts.map((p, i) => `${f(p[0])} ${f(p[1])} ${i ? "l" : "m"}`).join(" ")} h ${s.fill ? "f" : "S"}`);
    } else if (s.k === "poly") {
      const pts = s.pts.map(([x, y]) => U(x, y));
      out.push(`${f(s.lw ?? 1)} w ${pts.map((p, i) => `${f(p[0])} ${f(p[1])} ${i ? "l" : "m"}`).join(" ")} ${s.closed ? "h" : ""} ${s.fill ? "f" : "S"}`);
    } else if (s.k === "circle") {
      const K = 0.5522847498 * s.r, { cx, cy, r } = s;
      const P = (dx, dy) => U(cx + dx, cy + dy);
      const seg = [[[r, 0], [r, K], [K, r], [0, r]], [[0, r], [-K, r], [-r, K], [-r, 0]], [[-r, 0], [-r, -K], [-K, -r], [0, -r]], [[0, -r], [K, -r], [r, -K], [r, 0]]];
      const st = P(r, 0);
      let d = `${f(st[0])} ${f(st[1])} m`;
      for (const [, c1, c2, e] of seg) { const [a, b, c] = [P(...c1), P(...c2), P(...e)]; d += ` ${f(a[0])} ${f(a[1])} ${f(b[0])} ${f(b[1])} ${f(c[0])} ${f(c[1])} c`; }
      out.push(`${f(s.lw ?? 1)} w ${d} h ${s.fill ? "f" : "S"}`);
    } else if (s.k === "text") {
      const sz = s.size ?? 8, [a, b, c, d] = BASIS[rot], [tx, ty] = U(s.x, s.y);
      const esc = String(s.t).replace(/[\\()]/g, "\\$&");
      out.push(`BT /F1 ${f(sz)} Tf ${a} ${b} ${c} ${d} ${f(tx)} ${f(ty)} Tm (${esc}) Tj ET`);
    }
  }
  return { content: out.join("\n"), Wu, Hu, rot };
}

/** A vector PDF of the given pages. */
export function pdfOf(pages) {
  const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  add(null); add(null);                                              // 1 catalog, 2 pages (filled below)
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const pg of pages) {
    const { content, Wu, Hu, rot } = pg.image ? { content: pg.image.content, Wu: pg.image.Wu, Hu: pg.image.Hu, rot: pg.rotate || 0 } : pageStream(pg);
    const cobj = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    const img = pg.image ? add(pg.image.obj) : null;
    const pobj = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(Wu)} ${f(Hu)}] ${rot ? `/Rotate ${rot}` : ""} /Contents ${cobj} 0 R /Resources << /Font << /F1 ${font} 0 R >>${img ? ` /XObject << /Im0 ${img} 0 R >>` : ""} >> >>`);
    kids.push(pobj);
  }
  objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")]; const off = []; let len = parts[0].length;
  objs.forEach((o, i) => { off.push(len); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), Buffer.isBuffer(o) ? o : Buffer.from(o, "latin1"), Buffer.from("\nendobj\n", "latin1")]); parts.push(b); len += b.length; });
  parts.push(Buffer.from(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}

/** deterministic PRNG */
export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/**
 * An IMAGE-ONLY (scanned) PDF of a vector PDF's first page: rendered at `dpi`, optional salt-and-pepper `noise` fraction, optional `blur` by box-averaging,
 * then wrapped as a grayscale image page (no text layer, no vector paths).
 */
export function scannedPdf(vectorPdf, { dpi = 150, noise = 0, seed = 7, page = 1 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "sldsyn-"));
  try {
    writeFileSync(path.join(dir, "v.pdf"), vectorPdf);
    execFileSync("pdftoppm", ["-gray", "-r", String(dpi), "-f", String(page), "-l", String(page), path.join(dir, "v.pdf"), path.join(dir, "r")]);
    const name = execFileSync("ls", [dir]).toString().split("\n").find((n) => /^r.*\.pgm$/.test(n));
    const pgm = readFileSync(path.join(dir, name));
    const m = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(pgm.subarray(0, 40).toString("latin1"));
    const w = +m[1], h = +m[2], px = Buffer.from(pgm.subarray(pgm.length - w * h));
    if (noise > 0) { const r = rng(seed); for (let i = 0; i < px.length; i++) if (r() < noise) px[i] = r() < 0.5 ? 0 : 255; }
    const z = deflateSync(px);
    const Wu = w * 72 / dpi, Hu = h * 72 / dpi;
    const obj = Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, "latin1"), z, Buffer.from("\nendstream", "latin1")]);
    return { Wu, Hu, content: `q ${f(Wu)} 0 0 ${f(Hu)} 0 0 cm /Im0 Do Q`, obj, binary: true };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
