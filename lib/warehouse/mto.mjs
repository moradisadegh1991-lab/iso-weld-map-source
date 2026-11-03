/**
 * MTO revisions. A requirement's `source` names the MTO and its revision: «Piping MTO rev 2», «MTO rev B». The latest
 * revision of each MTO is the requirement; an earlier one is superseded — kept on record, no longer counted. Before,
 * every source of an item was added, so «MTO rev 2» and «MTO rev 3» together asked for both (audit 2026-11-03).
 *
 * A source that does not end in a revision («Site request 17») is its own series and always counts. Nothing is
 * deleted or rewritten: this is read-time, so a wrong reading is a wrong source string, fixed by typing it again.
 *
 * Revisions compare as the drawing world orders them: letters (A < B < … < Z < AA) before numbers (0 < 1 < 2 …),
 * since a document goes A, B for review and 0, 1 once issued.
 */
const REV = /^(.*?)[\s_,;:-]*\b(?:rev(?:ision)?\.?|r)[\s_.-]*([A-Za-z]{1,2}|\d{1,3})\s*$/i;

/** @returns {{ series: string, rev: string|null }} */
export function mtoSeries(source) {
  const s = String(source ?? "").trim();
  const m = REV.exec(s);
  if (!m) return { series: s.toLowerCase(), rev: null };
  return { series: m[1].trim().toLowerCase(), rev: m[2].toUpperCase() };
}

const rank = (rev) => (/^\d+$/.test(rev) ? [1, Number(rev)] : [0, rev.length, rev]);
/** Negative when `a` is the earlier revision. */
export function compareRev(a, b) {
  const x = rank(a), y = rank(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Split one item's requirement rows into those that count and those superseded.
 * @param {Array<{ source: string, qty: number|string }>} rows
 */
export function activeRequirements(rows) {
  const best = new Map();           // series → the row at the latest revision
  const own = [];                   // rows with no revision: always count
  for (const r of rows) {
    const { series, rev } = mtoSeries(r.source);
    if (rev == null) { own.push(r); continue; }
    const cur = best.get(series);
    if (!cur || compareRev(rev, cur.rev) > 0 || (compareRev(rev, cur.rev) === 0 && String(r.source) > String(cur.row.source))) best.set(series, { rev, row: r });
  }
  const active = [...own, ...[...best.values()].map((b) => b.row)];
  return { active, superseded: rows.filter((r) => !active.includes(r)) };
}
