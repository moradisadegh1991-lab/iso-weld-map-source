/**
 * Materials: the warehouse module's deterministic engine.
 *
 * A LOT is one receipt line — one item, one heat, one material test
 * certificate (MTC). Stock is never stored: it is what was accepted on
 * inspection, less what was issued, plus what came back. A stored balance is
 * wrong the first time somebody corrects a receipt.
 *
 * WHAT MAY BE ISSUED
 *
 *   Only accepted quantity (the MIR decided it), and — for heat-traceable
 *   material (pipe, fittings, flanges, valves, plate, structural steel,
 *   bolting) — only with a heat number and an ACCEPTED MTC. A pressure
 *   part whose certificate nobody has reviewed is not stock, it is
 *   quarantine. Those categories are the usual traceability scope of piping
 *   and structural specifications; a project whose spec draws the line
 *   elsewhere changes TRACEABLE here, in one place.
 *
 *   Nothing is issued beyond what the lot holds, and nothing is returned
 *   beyond what was issued from it.
 *
 * WHAT HAPPENS WHEN A CERTIFICATE IS REJECTED LATE
 *
 *   The lot stops being issuable, and everything already issued from it is
 *   listed by destination — the spools and tags that now carry suspect
 *   material. That list is the recall, and it is why an issue records where
 *   the material went.
 */

export const CATEGORIES = {
  pipe: "لوله", fitting: "اتصالات", flange: "فلنج", valve: "شیر", plate: "ورق",
  structural: "پروفیل فولادی", bolting: "پیچ و مهره", cable: "کابل", instrument: "ابزار دقیق",
  consumable: "مصرفی", other: "سایر",
};

/** Heat/lot-traceable categories: issued only with a heat and an accepted MTC. */
export const TRACEABLE = new Set(["pipe", "fitting", "flange", "valve", "plate", "structural", "bolting"]);

/** Inspection state of a lot, from what the MIR recorded. */
export function inspectionState(lot) {
  const acc = num(lot.qtyAccepted), rej = num(lot.qtyRejected);
  if (acc === null && rej === null) return "pending";
  if (!acc) return "rejected";
  if (rej) return "partial";
  return "accepted";
}

/**
 * Can this lot be issued from, and if not, why.
 * @returns {{ok: boolean, reasons: string[]}}
 */
export function lotIssuable(lot, item) {
  const reasons = [];
  const state = inspectionState(lot);
  if (state === "pending") reasons.push("بازرسی ورود (MIR) انجام نشده");
  if (state === "rejected") reasons.push("در بازرسی ورود رد شده");
  if (TRACEABLE.has(item.category)) {
    if (!lot.heatNo) reasons.push("شمارهٔ ذوب (Heat) ثبت نشده");
    if (!lot.mtcRef) reasons.push("گواهی آزمون مواد (MTC) ثبت نشده");
    else if (lot.mtcStatus === "rejected") reasons.push("MTC رد شده — قرنطینه");
    else if (lot.mtcStatus !== "accepted") reasons.push("MTC هنوز بررسی و پذیرفته نشده");
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Balance of one lot from its movements.
 * @param {{qtyAccepted}} lot
 * @param {Array<{kind: "issue"|"return"|"count_gain"|"count_loss", qty: number}>} movements
 */
export function lotBalance(lot, movements = []) {
  const issued = sum(movements.filter((m) => m.kind === "issue"));
  const returned = sum(movements.filter((m) => m.kind === "return"));
  // Count adjustments move the book to what was physically found; they are not issues.
  const gain = sum(movements.filter((m) => m.kind === "count_gain"));
  const loss = sum(movements.filter((m) => m.kind === "count_loss"));
  const accepted = num(lot.qtyAccepted) ?? 0;
  return { accepted, issued, returned, netIssued: round3(issued - returned), onHand: round3(accepted - issued + returned + gain - loss) };
}

/**
 * Check one movement before it is recorded.
 * @returns {{ok: boolean, reason?: string}}
 */
export function checkMovement({ kind, qty }, lot, item, movements) {
  const q = num(qty);
  if (!(q > 0)) return { ok: false, reason: "مقدار باید مثبت باشد" };
  const b = lotBalance(lot, movements);
  if (kind === "issue") {
    const can = lotIssuable(lot, item);
    if (!can.ok) return { ok: false, reason: can.reasons.join(" · ") };
    if (q > b.onHand) return { ok: false, reason: `موجودی این لات ${b.onHand} ${item.uom} است؛ ${q} خواسته شده` };
    return { ok: true };
  }
  if (kind === "return") {
    if (q > b.netIssued) return { ok: false, reason: `از این لات ${b.netIssued} ${item.uom} حواله شده؛ برگشت ${q} ممکن نیست` };
    return { ok: true };
  }
  return { ok: false, reason: `نوع حرکت «${kind}» شناخته نشد` };
}

/**
 * Required against held, per item: what the MTO asks for, what has gone to
 * site, what is on hand and issuable, what is on hand but held, and the
 * shortfall. Held stock is NOT counted against the shortfall — a pipe in
 * quarantine cannot be welded.
 */
export function shortage(required, issuedNet, issuable, held) {
  const r = num(required) ?? 0;
  const gap = r - (issuedNet || 0) - (issuable || 0);
  return { required: r, issued: issuedNet || 0, issuable: issuable || 0, held: held || 0,
    shortfall: round3(Math.max(0, gap)),
    availabilityPct: r > 0 ? Math.min(100, Math.round(((issuedNet + issuable) / r) * 1000) / 10) : null };
}

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const sum = (list) => round3(list.reduce((a, m) => a + Number(m.qty), 0));
const round3 = (n) => Math.round(n * 1000) / 1000;
