/**
 * The sheet's cut pieces as a model, not only a table (owner's request 2026-11-02): a piece has a
 * length, a cut angle, the weld at each end (`from`, `to` — weld numbers of this sheet) and the spool
 * it goes to. It says where those disagree with the sheet's own marks; it does not decide which is right.
 *
 *   - an end names a weld that is not on the sheet
 *   - both ends are the same weld
 *   - the piece's spool is not a spool of the sheet
 *   - the piece's spool is not the spool of a weld it ends at (when that weld has one)
 *   - the angle is not a number between 0 and 90 (a cut is square at 90°; 0 < a ≤ 90)
 *
 * `items` are the sheet's marks (lib/sheet/markup.mjs): welds carry attrs.spool, spools are marks of kind "spool".
 */
const text = (v) => String(v ?? "").trim();

/** The spool a piece's two ends say it belongs to: the distinct spools of the welds it ends at. */
export function endSpools(cut, items = []) {
  const byNo = new Map(items.filter((m) => /^weld/.test(m.kind)).map((m) => [text(m.no), text(m.attrs?.spool)]));
  return [...new Set([cut?.from, cut?.to].map((n) => byNo.get(text(n))).filter(Boolean))];
}

/** @returns {string[]} problems, each naming its piece */
export function cutChecks(cuts = [], items = []) {
  const welds = new Set(items.filter((m) => /^weld/.test(m.kind)).map((m) => text(m.no)).filter(Boolean));
  const spools = new Set(items.filter((m) => m.kind === "spool").map((m) => text(m.no)).filter(Boolean));
  const out = [];
  for (const c of Array.isArray(cuts) ? cuts : []) {
    const id = `قطعهٔ برش <${text(c?.piece)}>`;
    const from = text(c?.from), to = text(c?.to), spool = text(c?.spool), angle = text(c?.angle);
    for (const [label, n] of [["ابتدا", from], ["انتها", to]]) if (n && welds.size && !welds.has(n)) out.push(`${id}: ${label}ی قطعه سرجوش ${n} است و روی این برگ نیست.`);
    if (from && from === to) out.push(`${id}: ابتدا و انتها یک سرجوش است (${from}).`);
    if (spool && spools.size && !spools.has(spool)) out.push(`${id}: اسپول ${spool} روی این برگ علامت ندارد.`);
    const es = endSpools(c, items);
    if (spool && es.length && !es.includes(spool)) out.push(`${id}: اسپول ${spool}، اما سرجوش‌های دو سرش در ${es.join("، ")} هستند.`);
    if (angle) { const a = Number(angle); if (!(a > 0 && a <= 90)) out.push(`${id}: زاویهٔ برش «${angle}» باید عددی بین ۰ تا ۹۰ باشد.`); }
  }
  return out;
}
