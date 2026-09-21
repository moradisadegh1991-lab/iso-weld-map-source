/**
 * What changed between two revisions of a weld register.
 *
 * This is the output an engineer actually acts on: not "the drawing changed",
 * which they already know, but which welds appeared, which disappeared, which
 * moved or changed size — and, the expensive one, which of them sit in a
 * spool that has already been fabricated.
 */
import { matchRegisters } from "./match.mjs";

/** Attributes worth reporting when a matched weld is not identical. */
const TRACKED = [
  { key: "loc", label: "محل جوش" },
  { key: "kind", label: "نوع" },
  { key: "nps", label: "قطر" },
  { key: "spool", label: "اسپول" },
  { key: "role", label: "اتصال" },
  { key: "ndt", label: "NDT" },
];

/** Beyond this a matched weld has genuinely moved, not just been re-rounded. */
const MOVE_TOLERANCE_MM = 2;

export function diffRegisters(fromRows, toRows, options = {}) {
  const { pairs, onlyFrom, onlyTo, shift } = matchRegisters(fromRows, toRows, options);

  const changed = [], unchanged = [], renumbered = [];
  for (const { from, to, score } of pairs) {
    const fields = [];
    for (const { key, label } of TRACKED) {
      if (String(from[key] ?? "") !== String(to[key] ?? "")) {
        fields.push({ field: key, label, from: from[key] ?? null, to: to[key] ?? null });
      }
    }
    const moved = Math.hypot(
      from.pos.e - (to.pos.e + shift.e),
      from.pos.n - (to.pos.n + shift.n),
      from.pos.el - (to.pos.el + shift.el));
    if (moved > MOVE_TOLERANCE_MM) {
      fields.push({ field: "position", label: "موقعیت", from: null, to: null, movedMm: round(moved) });
    }

    const entry = { uid: from.uid ?? null, from, to, score, fields };
    if (fields.length) changed.push(entry);
    else unchanged.push(entry);
    // Renumbering on its own is not a change to the work, but it IS the thing
    // that makes a register look unrecognisable, so it is reported separately.
    if (from.no !== to.no) renumbered.push({ uid: from.uid ?? null, from: from.no, to: to.no });
  }

  return {
    added: onlyTo,
    removed: onlyFrom,
    changed,
    unchanged,
    renumbered,
    shift,
    summary: {
      from: fromRows.length,
      to: toRows.length,
      added: onlyTo.length,
      removed: onlyFrom.length,
      changed: changed.length,
      unchanged: unchanged.length,
      renumbered: renumbered.length,
      rebased: !!shift.from && (shift.e || shift.n || shift.el) ? shift : null,
    },
  };
}

/**
 * Which spools the change lands in, and which of those are already built.
 *
 * This is the part that costs money. A spool that is still on paper absorbs a
 * revision for free; one that is welded, tested and painted absorbs it as
 * cut-and-reweld, a new NDT report and a delay. So the answer is split by
 * fabrication status rather than presented as one list.
 *
 * @param {object} diff            output of diffRegisters
 * @param {Map<string,string>} fabStatusBySpool  spool_no -> status, from the run being superseded
 */
export function spoolImpact(diff, fabStatusBySpool = new Map()) {
  const touched = new Map();
  const touch = (spoolNo, reason, weldNo) => {
    if (!spoolNo) return;
    if (!touched.has(spoolNo)) touched.set(spoolNo, { spool: spoolNo, reasons: [], welds: [] });
    const t = touched.get(spoolNo);
    if (!t.reasons.includes(reason)) t.reasons.push(reason);
    if (weldNo && !t.welds.includes(weldNo)) t.welds.push(weldNo);
  };

  for (const w of diff.removed) touch(w.spool, "removed", w.no);
  for (const w of diff.added) touch(w.spool, "added", w.no);
  for (const c of diff.changed) {
    // A weld that moved between spools damages BOTH: the one it left is short
    // a joint, the one it arrived in has an extra.
    touch(c.from.spool, "changed", c.from.no);
    touch(c.to.spool, "changed", c.to.no);
  }

  const all = [...touched.values()].map((t) => ({
    ...t,
    fabStatus: fabStatusBySpool.get(t.spool) || "unknown",
  }));

  const built = new Set(["fabricated", "tested", "painted", "shipped", "erected"]);
  return {
    spools: all,
    // The alarm list: work already done that this revision invalidates.
    rework: all.filter((s) => built.has(s.fabStatus)),
    safe: all.filter((s) => !built.has(s.fabStatus)),
  };
}

const round = (n) => Math.round(n * 10) / 10;
