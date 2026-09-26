/**
 * Reservations and stock counts.
 *
 * RESERVATION — stock set aside for a spool, a tag or a stated use before it
 * is issued, so that a spool released for fabrication does not find its pipe
 * gone to another. A reservation can be for an item (any issuable lot) or a
 * lot (when the heat matters). What is still reserved is DERIVED: the
 * reservation's quantity less what has been issued against it — never a
 * number someone keeps up to date. Releasing one early is a person's act,
 * with a reason.
 *
 *   free for D = issuable on hand − what is still reserved for anyone else
 *
 * An issue to D may use D's own reservation and anything free; it may not
 * take stock reserved for another destination. A reservation cannot promise
 * more than is free: stock in quarantine, not yet inspected, or already
 * promised is not free.
 *
 * STOCK COUNT — a physical count per lot against the book balance on the
 * count date. A difference is not corrected by editing the ledger: a person
 * decides — adjust the book to the count (a count gain / loss movement, with
 * a reason) or keep the book (recount found the error). Record accuracy is
 * the share of counted lots whose count matched the book exactly; a
 * tolerance, if the company has one, is the project's to state, not ours.
 */

export const DEST_FA = { spool: "اسپول", tag: "تگ", purpose: "مصرف" };

/** One key per destination, so reservations and issues can be matched. */
export function destKey({ spoolId = null, tagId = null, purpose = null }) {
  if (spoolId) return `spool:${spoolId}`;
  if (tagId) return `tag:${tagId}`;
  const p = String(purpose || "").trim().toLowerCase();
  return p ? `purpose:${p}` : null;
}

/** What a reservation still holds: its quantity less the issues made against it, never below zero. */
export function remaining(res, issuedAgainst = 0) {
  if (res.releasedAt) return 0;
  return round3(Math.max(0, Number(res.qty) - Number(issuedAgainst || 0)));
}

/**
 * Stock free for a destination, for one item and optionally one lot. An
 * issue must pass both: item-wide, and on the lot it is taken from.
 *   issuableOnHand   on hand in lots that may be issued (item-wide, or the lot)
 *   reservations     [{ key, lotId, left }] active, with what they still hold
 */
export function freeFor({ issuableOnHand, reservations, key, lotId = null }) {
  // Item-wide: every other reservation counts. One lot: only those pinned to that lot —
  // an item-wide reservation can be met from any lot, and the item-wide check covers it.
  const others = reservations.filter((r) => r.key !== key && r.left > 0 && (lotId === null || r.lotId === lotId));
  return round3(Math.max(0, issuableOnHand - others.reduce((a, r) => a + r.left, 0)));
}

/** Why this reservation cannot be made; empty when it can. */
export function reservationProblems({ qty, key }, { free, uom }) {
  const out = [];
  if (!key) out.push("مقصد رزرو لازم است (اسپول، تگ یا شرح مصرف)");
  if (!(Number(qty) > 0)) out.push("مقدار رزرو باید مثبت باشد");
  else if (Number(qty) > free) out.push(`آزاد برای رزرو ${free} ${uom} است؛ ${qty} خواسته شده`);
  return out;
}

/** A count line: the difference between the count and the book. */
export function variance(systemQty, countedQty) {
  const d = round3(Number(countedQty) - Number(systemQty));
  return { diff: d, kind: d === 0 ? "match" : d > 0 ? "gain" : "loss" };
}

/** Record accuracy over counted lines: exact matches / lines. Null with nothing counted. */
export function accuracy(lines) {
  if (!lines.length) return null;
  const ok = lines.filter((l) => variance(l.systemQty, l.countedQty).kind === "match").length;
  return Math.round((ok / lines.length) * 1000) / 10;
}

const round3 = (n) => Math.round(n * 1000) / 1000;
