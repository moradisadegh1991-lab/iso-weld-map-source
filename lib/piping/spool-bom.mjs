/**
 * What each spool is made of, in the drawing's own stock codes — the list
 * the warehouse reserves and issues against when a spool is released.
 *
 * From the engine's elements (lib/engine.js) and the drawing's BOM:
 *   pipe    the net lengths of the spool's pipe and pup pieces, per size,
 *           matched to the BOM's pipe row of that size. NET: the cutting
 *           and bevel allowance is the fabricator's and is not added here.
 *   fitting one per fitting element (ghosted ones are not bought), matched
 *           to the BOM row buying that fitting type at that size.
 * A size or type the BOM does not buy exactly once is left UNMATCHED with
 * the reason — two pipe rows of one size (e.g. two schedules) cannot be
 * told apart from geometry, and a guess would reserve the wrong pipe.
 */
import { fittingTypeOf } from "../bom.js";

const isPipeRow = (b) => /pipe/i.test(`${b.group || ""} ${b.description || ""}`) && fittingTypeOf(b) === null;

export function spoolBom(elements = [], bom = []) {
  const out = new Map();
  const add = (spool, row) => { if (!out.has(spool)) out.set(spool, []); out.get(spool).push(row); };
  const pipeLen = new Map(), fits = new Map();
  for (const el of elements) {
    if (!el.spool) continue;
    if (el.kind === "pipe" || el.kind === "pup") {
      const k = `${el.spool}|${Number(el.nps)}`;
      pipeLen.set(k, (pipeLen.get(k) || 0) + (Number(el.length) || 0));
    } else if (el.kind === "fitting" && !el.ghost) {
      const k = `${el.spool}|${el.type}|${Number(el.nps)}`;
      fits.set(k, (fits.get(k) || 0) + 1);
    }
  }
  const codes = (rows) => [...new Set(rows.map((b) => b.stockCode).filter(Boolean))];
  for (const [k, mm] of pipeLen) {
    const [spool, nps] = k.split("|");
    const rows = bom.filter((b) => isPipeRow(b) && Number(b.diam) === Number(nps));
    const c = codes(rows);
    add(spool, { kind: "pipe", nps: Number(nps), qty: Math.round(mm) / 1000, uom: "m",
      stockCode: c.length === 1 ? c[0] : null, description: rows[0]?.description ?? null,
      reason: c.length === 1 ? null : c.length ? `${c.length} ردیف لوله با سایز ${nps}" در MTO — از روی هندسه قابل تشخیص نیست` : `لولهٔ ${nps}" در MTO نیست` });
  }
  for (const [k, n] of fits) {
    const [spool, type, nps] = k.split("|");
    const rows = bom.filter((b) => fittingTypeOf(b) === type && Number(b.diam) === Number(nps));
    const c = codes(rows);
    add(spool, { kind: "fitting", type, nps: Number(nps), qty: n, uom: "EA",
      stockCode: c.length === 1 ? c[0] : null, description: rows[0]?.description ?? null,
      reason: c.length === 1 ? null : c.length ? `${c.length} کد برای ${type} ${nps}" در MTO` : `${type} ${nps}" در MTO نیست` });
  }
  return out;
}

/**
 * One line of a spool's material against the stock catalogue and what is
 * already set aside or issued for the spool.
 */
export function materialLine(line, { item, reserved = 0, issued = 0, free = 0 }) {
  if (!line.stockCode) return { ...line, state: "unmatched", text: line.reason };
  if (!item) return { ...line, state: "no_item", text: `کد ${line.stockCode} در کاتالوگ انبار نیست` };
  if (String(item.uom).toUpperCase() !== String(line.uom).toUpperCase()) {
    return { ...line, state: "uom", text: `واحد کالای انبار ${item.uom} است، فهرست اسپول ${line.uom}` };
  }
  const covered = reserved + issued;
  const need = Math.max(0, Math.round((line.qty - covered) * 1000) / 1000);
  if (need === 0) return { ...line, need, state: issued >= line.qty ? "issued" : "reserved", text: issued >= line.qty ? "حواله شد" : "رزرو شد" };
  if (free >= need) return { ...line, need, state: "available", text: `${need} ${line.uom} آزاد و قابل رزرو` };
  return { ...line, need, state: "short", text: `کسری: لازم ${need}، آزاد ${free} ${line.uom}` };
}
