/**
 * The welds a sheet's bill of material implies (owner's request of
 * 2026-11-01: «based on the BOM, e.g. an elbow — each of its two ends is
 * welded to a fitting or a pipe»).
 *
 * Each BOM item is counted by its ends that are welded on this line, as its
 * description says how they are made: a butt-weld elbow has two BW ends, a
 * socket-weld tee three SW ends, a weld-neck flange one BW end, a flanged or
 * threaded valve none, a half coupling one weld to the run pipe (an OLET)
 * and its socket. Pipe and nipples are not counted — their ends are the
 * fittings' sockets and bevels, counted there.
 *
 * What the count is, and what it is not:
 *   - every welded end is one weld, except where two fittings are welded
 *     straight to each other (a weld-neck flange on an elbow): those two
 *     ends are one weld. So the welds of the BOM's fittings are at most
 *     `ends`, and at least half of it;
 *   - a weld of pipe to pipe (a straight run made of two lengths) is in no
 *     BOM row, and neither is a joint to the next sheet's pipe;
 *   - an item whose description does not say how its ends are made, or
 *     whose quantity was not read, is named and not counted — never guessed.
 *
 * The engine compares; a person decides what is missing.
 */
import { endTypes, sizesOf } from "./weld-marks.mjs";

const up = (v) => ` ${String(v ?? "").toUpperCase().replace(/[,;]/g, " ")} `;
const FLANGED = /\s(RF|FF|RTJ|FLG|FLGD|FLANGED|WAFER|LUG|LUGGED)\s/;
const has = (s, re) => re.test(s);

/**
 * What one piece of a BOM row is, and its joined ends: [{ size, kind, n }]
 * with kind BW, SW, OLET (a branch fitting welded to its run), SO (a slip-on
 * flange's fillet welds) or THD (a threaded joint — a joint of the register,
 * not a weld), or `ends: null` when the description does not say. A size not
 * read is null: the end is counted, its size unknown.
 */
export function piecesEnds(row) {
  const s = up(row?.description);
  const grp = up(row?.group);
  const sizes = sizesOf(row?.diam ?? row?.size);
  const big = sizes.length ? sizes[0] : null;
  const small = sizes.length ? sizes[sizes.length - 1] : null;
  const t = endTypes(row?.description);
  const bw = t.has("BW"), sw = t.has("SW"), thd = t.has("THD");
  const kind = bw ? "BW" : sw ? "SW" : thd ? "THD" : null;
  const of = (item, ...ends) => ({ item, ends: ends.filter((e) => e.n > 0) });
  const e = (size, k, n = 1) => ({ size, kind: k, n });
  const unknown = (item) => ({ item, ends: null });

  // nothing on it is joined into the line
  if (has(s, /GASKET|STUD\s*BOLT|\sBOLT|\sNUTS?\s|INSTRUMENT|GAUGE|SPECTACLE|SPADE|SPACER|BLIND|\sPLUG\s|NAME\s*PLATE|SUPPORT/)) return of("no joint");
  // pipe and nipples: their ends are counted at the fittings they go into (or the bevel they meet)
  if (/^\s*PIPE\s/.test(s) || (/^\s*PIPE\s/.test(grp) && !has(s, /ELBOW|TEE|REDUC|CAP|FLANGE|VALVE|COUPLING|OLET/))) return of("pipe");
  if (has(s, /SWAGE/)) {
    // a bevelled end is butt-welded to pipe; a threaded one takes a threaded nipple; a plain end goes
    // into a socket (counted there)
    if (!has(s, /[BPT](BE|LE|SE)/)) return unknown("swage");
    const end = (where, size) => has(s, new RegExp(`B(BE|${where}E)`)) ? e(size, "BW") : has(s, new RegExp(`T(BE|${where}E)`)) ? e(size, "THD") : e(size, "BW", 0);
    return of("swage", end("L", big), end("S", small));
  }
  if (has(s, /INSERT/)) return of("insert", e(small, "THD", has(s, /TSE|NPT/) ? 1 : 0), e(small, "SW", has(s, /SW\s|SSE/) ? 1 : 0));
  if (has(s, /NIPPLE/)) return of("nipple");
  // a branch fitting: welded to its run (an OLET), its branch end as its description says
  if (has(s, /HALF\s*COUPLING|OLET\s/)) {
    const br = sw || has(s, /SOCKOLET/) ? "SW" : bw || has(s, /WELDOLET|SWEEPOLET/) ? "BW" : thd || has(s, /THREDOLET/) ? "THD" : null;
    return br ? of("branch", e(small, "OLET"), e(small, br)) : unknown("branch fitting");
  }
  if (has(s, /FLANGE/)) {
    if (has(s, /BLIND|LAP\s*JOINT/)) return of("flange");
    if (has(s, /SCREWED|THREADED|\sNPT\s|\sTHD\s/)) return of("flange", e(big, "THD"));
    if (has(s, /WELD(ING)?\s*NECK|\sW\.?N\.?\s|\sLWN\s/)) return of("flange", e(sizes.length > 1 ? small : big, "BW"));
    if (has(s, /SOCKET\s*WELD|\sSW\s/)) return of("flange", e(big, "SW"));
    if (has(s, /SLIP\s*-?ON|\sSO\s/)) return of("flange", e(big, "SO"));
    return unknown("flange");
  }
  if (has(s, /STUB\s*END/)) return bw ? of("stub end", e(big, "BW")) : unknown("stub end");
  if (has(s, /ELBOW|\sELL\s|\sBEND\s/)) return kind ? of("elbow", e(big, kind, 2)) : unknown("elbow");
  if (has(s, /\sTEE\s|^\s*TEE|CROSS/) && !has(s, /STRAINER/)) {
    if (!kind) return unknown("tee");
    const n = has(s, /CROSS/) ? 4 : 3;
    return sizes.length > 1 && small !== big ? of("tee", e(big, kind, n - 1), e(small, kind)) : of("tee", e(big, kind, n));
  }
  if (has(s, /REDUCER/)) return kind ? of("reducer", e(big, kind), e(small, kind)) : unknown("reducer");
  if (has(s, /\sCAP\s/)) return kind ? of("cap", e(big, kind)) : unknown("cap");
  if (has(s, /COUPLING|UNION/)) return kind ? of("coupling", e(big, kind, 2)) : unknown("coupling");
  // an in-line item (valve, strainer, trap, sight glass…): joined as its ends say; flanged ends are bolted
  if (has(s, /VALVE|STRAINER|TRAP|SIGHT|ORIFICE|FILTER|EXPANSION|HOSE|METER/)) {
    const welded = bw ? "BW" : sw ? "SW" : null;
    if (welded) return of("inline", e(big, welded, thd ? 1 : 2), e(big, "THD", thd ? 1 : 0));
    if (thd) return of("inline", e(big, "THD", 2));
    if (FLANGED.test(s)) return of("inline");
    return unknown("inline");
  }
  return unknown(null);
}

const KEY = (size, kind) => `${size}|${kind}`;

/**
 * The welded ends a sheet's BOM implies, by size and kind, with the rows it
 * could not count.
 * @returns {{ ends: Array<{size, kind, n, pts}>, total: number, complete: boolean,
 *             unclassified: Array<{pt, description}>, noQty: Array<{pt, description}> }}
 */
export function bomWeldEnds(bom = []) {
  const acc = new Map(), unclassified = [], noQty = [];
  for (const row of Array.isArray(bom) ? bom : []) {
    const { ends } = piecesEnds(row);
    if (ends === null) { unclassified.push({ pt: row.pt ?? null, description: String(row.description || "") }); continue; }
    if (!ends.length) continue;
    const q = Number(row.qty);
    if (row.qty == null || row.qty === "" || !Number.isInteger(q) || q <= 0 || (row.qtyUnit && row.qtyUnit !== "pcs")) {
      noQty.push({ pt: row.pt ?? null, description: String(row.description || "") });
      continue;
    }
    for (const e of ends) {
      const k = KEY(e.size, e.kind);
      const a = acc.get(k) || { size: e.size, kind: e.kind, n: 0, pts: [] };
      a.n += e.n * q;
      if (row.pt != null && !a.pts.includes(row.pt)) a.pts.push(row.pt);
      acc.set(k, a);
    }
  }
  const ends = [...acc.values()].sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || a.kind.localeCompare(b.kind));
  // a PT number missing from 1 … the last is a row not read: what it holds is not counted
  const pts = new Set((bom || []).map((r) => Number(r.pt)).filter(Number.isInteger));
  const last = pts.size ? Math.max(...pts) : 0;
  const missingPts = Array.from({ length: last }, (_, i) => i + 1).filter((n) => !pts.has(n));
  const welds = ends.filter((x) => x.kind !== "THD");
  return { ends, total: welds.reduce((t, x) => t + x.n, 0), threaded: ends.filter((x) => x.kind === "THD").reduce((t, x) => t + x.n, 0),
    complete: !unclassified.length && !noQty.length && !missingPts.length, unclassified, noQty, missingPts };
}

/**
 * The BOM's welded ends against the welds of the register (or the welds
 * found on the sheet), size by size and kind by kind. A weld with no size
 * or kind yet is counted apart. Nothing is concluded beyond the counts: a
 * size with more welded ends than welds may have two fittings welded to
 * each other, or a weld not yet found; a size with more welds than ends may
 * have pipe welded to pipe, or a joint to the next sheet.
 */
export function compareBomWelds(bom, welds = []) {
  const b = bomWeldEnds(bom);
  const found = new Map(), unsized = [];
  for (const w of welds || []) {
    const size = Number(w.nps ?? w.size);
    const kind = String(w.kind || "").toUpperCase();
    if (!(size > 0) || !kind) { unsized.push(String(w.no ?? "")); continue; }
    const k = KEY(size, kind);
    found.set(k, (found.get(k) || 0) + 1);
  }
  const keys = new Set([...b.ends.map((e) => KEY(e.size, e.kind)), ...found.keys()]);
  // a size the BOM did not read is "null|kind"
  const rows = [...keys].map((k) => {
    const [size, kind] = k.split("|");
    const e = b.ends.find((x) => KEY(x.size, x.kind) === k);
    return { size: size === "null" ? null : Number(size), kind, bomEnds: e?.n ?? 0, pts: e?.pts ?? [], welds: found.get(k) || 0 };
  }).sort((x, y) => (y.size ?? -1) - (x.size ?? -1) || x.kind.localeCompare(y.kind));
  const weldCount = (welds || []).filter((w) => String(w.kind || "").toUpperCase() !== "THD").length;
  return { ...b, rows, weldCount, unsized,
    // at most every welded end is its own weld; at least two ends share each
    least: Math.ceil(b.total / 2) };
}
