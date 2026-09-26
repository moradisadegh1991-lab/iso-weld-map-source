/**
 * QR labels for the field: what a label says, and the drawing of it.
 *
 * A label encodes a plain URL to the field page of one item:
 *
 *     https://<host>/field?p=<project code>&k=<kind>&n=<item number>
 *
 * A URL, not an opaque code, so that ANY phone camera opens it — the in-app
 * scanner is a convenience, not a requirement — and so that a label printed
 * today still means something when read by software written later. The
 * project code is in it because one person may work on two projects, and a
 * tag number is unique only within one.
 *
 * Kinds: t tag (equipment, foundation, structure) · s spool · c cable ·
 * i instrument.
 *
 * Error correction level Q (about 25 % of the symbol recoverable): a label
 * on a pipe spool gets scratched, painted over at the edge and photographed
 * at an angle, and the extra modules cost nothing worth measuring.
 */
import qrcode from "qrcode-generator";

export const KINDS = { t: "تگ", s: "اسپول", c: "کابل", i: "ابزار" };

/** The URL a label carries. */
export function fieldUrl({ origin, projectCode, kind, no }) {
  if (!KINDS[kind]) throw new Error(`unknown kind: ${kind}`);
  if (!String(no || "").trim() || !String(projectCode || "").trim()) throw new Error("project code and item number are required");
  const q = new URLSearchParams({ p: String(projectCode).trim(), k: kind, n: String(no).trim() });
  return `${String(origin || "").replace(/\/+$/, "")}/field?${q}`;
}

/**
 * Read what a scan or a typed entry says.
 * @returns {{kind: string, no: string, project: string|null}|null}
 *   A full label URL gives all three; a bare number typed by hand gives a
 *   tag lookup in the current project. Anything else is null — a QR code
 *   that is not ours is not guessed at.
 */
export function parseFieldCode(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { return null; }
    if (u.pathname.replace(/\/+$/, "") !== "/field") return null;
    const kind = u.searchParams.get("k"), no = u.searchParams.get("n");
    if (!KINDS[kind] || !no) return null;
    return { kind, no, project: u.searchParams.get("p") || null };
  }
  // A number typed on site: no spaces inside a tag number, and nothing that
  // looks like a URL of someone else's.
  if (/^[A-Za-z0-9][A-Za-z0-9\-_./"]{0,63}$/.test(s)) return { kind: "t", no: s.toUpperCase(), project: null };
  return null;
}

/** The QR symbol as rows of booleans (true = dark), without the quiet zone. */
export function qrMatrix(text, level = "Q") {
  const q = qrcode(0, level);
  q.addData(String(text), "Byte");
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/**
 * The symbol as an SVG string, one path, with the four-module quiet zone
 * the standard requires — without it, scanners fail on labels stuck to
 * anything patterned.
 */
export function qrSvg(text, { size = 160, level = "Q" } = {}) {
  const m = qrMatrix(text, level);
  const n = m.length + 8;
  let d = "";
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c + 4} ${r + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges">`
    + `<rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
