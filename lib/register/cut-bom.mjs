/**
 * The cut table the sheet prints (CUT PIPE LENGTH) against the sheet's own
 * BOM (owner's request of 2026-11-02: «cutting lengths consistent with the
 * BOM's quantities»). Per pipe size: how many pieces, their total length, and
 * the metres the BOM lists as pipe of that size. It says what the numbers
 * are and where they disagree; it does not decide which is right.
 *
 *   over    the pieces add up to more than the BOM lists (more than the 0.05 m
 *           the sheets' own rounding gives) — pipe the BOM does not have
 *   noBom   pieces of a size the BOM has no pipe row of, or only a row not
 *           counted in metres
 *   noSize  pieces whose size was not read
 *
 * More BOM than cut is normal (lengths bought whole, the end of a run on the
 * next sheet) and is shown, not flagged.
 */
import { sizesOf } from "./weld-marks.mjs";

const text = (v) => String(v ?? "").trim();
const isPipe = (b) => /^PIPE\b/i.test(text(b?.group)) || /^PIPE\b/i.test(text(b?.description));
const TOL_M = 0.05;

/** @returns {{ sizes: Array<{ size: number|null, pieces: number, cutM: number, bomM: number|null, status: "ok"|"over"|"noBom"|"noSize", pts: number[] }>, problems: string[], pieces: number, totalM: number }} */
export function cutVsBom(cutLengths = [], bom = []) {
  const by = new Map();
  let noSize = 0;
  for (const c of Array.isArray(cutLengths) ? cutLengths : []) {
    const len = Number(c?.lengthMm);
    if (!Number.isFinite(len) || len <= 0) continue;
    const size = sizesOf(c?.ns)[0] ?? null;
    const k = size == null ? "?" : String(size);
    const g = by.get(k) || { size, pieces: 0, cutM: 0 };
    g.pieces += 1; g.cutM += len / 1000; by.set(k, g);
    if (size == null) noSize += 1;
  }
  const sizes = [];
  for (const g of by.values()) {
    const rows = (bom || []).filter((b) => isPipe(b) && g.size != null && sizesOf(b.diam ?? b.size)[0] === g.size);
    const inM = rows.filter((b) => b.qtyUnit === "m" && Number.isFinite(Number(b.qty)));
    const bomM = inM.length ? inM.reduce((t, b) => t + Number(b.qty), 0) : null;
    const cutM = Math.round(g.cutM * 1000) / 1000;
    const status = g.size == null ? "noSize" : bomM == null ? "noBom" : cutM > bomM + TOL_M ? "over" : "ok";
    sizes.push({ size: g.size, pieces: g.pieces, cutM, bomM, status, pts: rows.map((b) => Number(b.pt)).filter(Number.isInteger) });
  }
  sizes.sort((a, b) => (b.size ?? -1) - (a.size ?? -1));
  const problems = [];
  for (const s of sizes) {
    const n = s.size == null ? "قطر نامعلوم" : `قطر ${s.size}"`;
    if (s.status === "over") problems.push(`${n}: ${s.pieces} قطعهٔ برش روی هم ${s.cutM} m است ولی BOM فقط ${s.bomM} m لوله دارد`);
    if (s.status === "noBom") problems.push(`${n}: ${s.pieces} قطعهٔ برش (${s.cutM} m) هست ولی BOM ردیف لولهٔ متری‌ای برای این قطر ندارد`);
    if (s.status === "noSize") problems.push(`${s.pieces} قطعهٔ برش قطرش خوانده نشده — با BOM سنجیده نشد`);
  }
  return { sizes, problems, pieces: sizes.reduce((t, s) => t + s.pieces, 0), totalM: Math.round(sizes.reduce((t, s) => t + s.cutM, 0) * 1000) / 1000, noSize };
}
