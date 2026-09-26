/**
 * Reservations and stock counts. Rules: lib/warehouse/reserve.mjs.
 * Call inside `withProject`.
 */
import { lotBalance, lotIssuable } from "../../warehouse/stock.mjs";
import { destKey, remaining, freeFor, reservationProblems, variance, accuracy, DEST_FA } from "../../warehouse/reserve.mjs";

// ── state ────────────────────────────────────────────────────────────────

/** One item's lots (on hand, issuable) and its active reservations with what each still holds. */
export async function itemReservations(db, { projectId, itemId }) {
  const { rows: [item] } = await db.query("SELECT * FROM material_item WHERE id = $1 AND project_id = $2", [itemId, projectId]);
  if (!item) throw notFound("item");
  const { rows: lots } = await db.query("SELECT * FROM material_lot WHERE item_id = $1 AND project_id = $2", [itemId, projectId]);
  const { rows: moves } = await db.query(
    "SELECT lot_id, kind, qty, reservation_id FROM material_movement WHERE project_id = $1 AND lot_id = ANY($2::uuid[])",
    [projectId, lots.map((l) => l.id)]);
  const lotState = lots.map((l) => {
    const b = lotBalance(asLot(l), moves.filter((m) => m.lot_id === l.id).map((m) => ({ kind: m.kind, qty: Number(m.qty) })));
    return { id: l.id, onHand: b.onHand, issuable: lotIssuable(asLot(l), item).ok };
  });
  const { rows: res } = await db.query(
    `SELECT * FROM material_reservation WHERE item_id = $1 AND project_id = $2 AND released_at IS NULL ORDER BY reserved_at`,
    [itemId, projectId]);
  const against = (id) => moves.filter((m) => m.reservation_id === id && m.kind === "issue").reduce((a, m) => a + Number(m.qty), 0);
  return {
    item, lots: lotState,
    reservations: res.map((r) => ({ id: r.id, key: destKey({ spoolId: r.spool_id, tagId: r.tag_id, purpose: r.purpose }),
      lotId: r.lot_id, qty: Number(r.qty), left: remaining({ qty: r.qty }, against(r.id)) })),
  };
}

const issuableOnHand = (lots, lotId = null) =>
  lots.filter((l) => l.issuable && (lotId === null || l.id === lotId)).reduce((a, l) => a + Math.max(0, l.onHand), 0);

/**
 * Before an issue: refuse what would take stock reserved for another
 * destination, and name the reservation of this destination it fills.
 */
export async function checkIssueAgainstReservations(db, { projectId, lotId, itemId, qty, spoolId, tagId, purpose }) {
  const s = await itemReservations(db, { projectId, itemId });
  const key = destKey({ spoolId, tagId, purpose });
  const itemFree = freeFor({ issuableOnHand: issuableOnHand(s.lots), reservations: s.reservations, key });
  const lotFree = freeFor({ issuableOnHand: issuableOnHand(s.lots, lotId), reservations: s.reservations, key, lotId });
  const q = Number(qty);
  if (q > itemFree || q > lotFree) {
    throw bad(`این مقدار برای مقصد دیگری رزرو شده — آزاد برای این حواله ${Math.min(itemFree, lotFree)} ${s.item.uom} است.`);
  }
  const mine = s.reservations.filter((r) => r.key === key && r.left > 0 && (r.lotId === null || r.lotId === lotId));
  mine.sort((a, b) => (a.lotId === lotId ? -1 : 0) - (b.lotId === lotId ? -1 : 0));
  return mine[0]?.id ?? null;
}

// ── reservations ─────────────────────────────────────────────────────────

export async function reserve(db, {
  projectId, itemId, lotId = null, qty, spoolId = null, tagId = null, purpose = null, needBy = null, userId = null,
}) {
  const s = await itemReservations(db, { projectId, itemId });
  if (lotId && !s.lots.some((l) => l.id === lotId)) throw notFound("lot of this item");
  const key = destKey({ spoolId, tagId, purpose });
  const free = Math.min(
    freeFor({ issuableOnHand: issuableOnHand(s.lots), reservations: s.reservations, key: "__new__" }),
    lotId ? freeFor({ issuableOnHand: issuableOnHand(s.lots, lotId), reservations: s.reservations, key: "__new__", lotId }) : Infinity);
  const p = reservationProblems({ qty, key }, { free, uom: s.item.uom });
  if (p.length) throw bad(p.join(" · "));
  const { rows: [r] } = await db.query(
    `INSERT INTO material_reservation (project_id, item_id, lot_id, qty, spool_id, tag_id, purpose, need_by, reserved_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, itemId, lotId || null, Number(qty), spoolId || null, tagId || null, blank(purpose), needBy || null, userId]);
  return r;
}

/** Give reserved stock back before it is issued — a person's act, with a reason. */
export async function releaseReservation(db, { projectId, reservationId, reason, userId = null }) {
  if (!blank(reason)) throw bad("دلیل آزادسازی رزرو لازم است.");
  const { rows: [r] } = await db.query(
    `UPDATE material_reservation SET released_at = now(), released_by = $3, release_reason = $4
      WHERE id = $1 AND project_id = $2 AND released_at IS NULL RETURNING *`, [reservationId, projectId, userId, blank(reason)]);
  if (!r) throw notFound("active reservation");
  return r;
}

export async function reservationBoard(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT r.*, i.code AS item_code, i.uom, l.receipt_no, l.heat_no, sp.spool_no, t.tag_no, u.display_name AS by_name,
            COALESCE((SELECT sum(m.qty) FROM material_movement m WHERE m.reservation_id = r.id AND m.kind = 'issue'), 0)::float8 AS issued
       FROM material_reservation r JOIN material_item i ON i.id = r.item_id
       LEFT JOIN material_lot l ON l.id = r.lot_id LEFT JOIN spool sp ON sp.id = r.spool_id LEFT JOIN tag t ON t.id = r.tag_id
       LEFT JOIN app_user u ON u.id = r.reserved_by
      WHERE r.project_id = $1 ORDER BY r.released_at NULLS FIRST, r.need_by NULLS LAST, r.reserved_at`, [projectId]);
  return rows.map((r) => {
    const left = remaining({ qty: r.qty, releasedAt: r.released_at }, r.issued);
    return {
      id: r.id, itemCode: r.item_code, uom: r.uom, qty: Number(r.qty), issued: r.issued, left,
      lot: r.lot_id ? `${r.receipt_no}${r.heat_no ? ` · ${r.heat_no}` : ""}` : null,
      dest: r.spool_no ? `${DEST_FA.spool} ${r.spool_no}` : r.tag_no ? `${DEST_FA.tag} ${r.tag_no}` : r.purpose,
      needBy: iso(r.need_by), byName: r.by_name,
      state: r.released_at ? "released" : left === 0 ? "fulfilled" : "active", releaseReason: r.release_reason,
    };
  });
}

// ── stock counts ─────────────────────────────────────────────────────────

export async function openCount(db, { projectId, countNo, countedOn, scope = null, userId = null }) {
  if (!blank(countNo) || !countedOn) throw bad("شمارهٔ انبارگردانی و تاریخ لازم است.");
  const { rows: [c] } = await db.query(
    `INSERT INTO stock_count (project_id, count_no, counted_on, scope, opened_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [projectId, blank(countNo).toUpperCase(), countedOn, blank(scope), userId]);
  return c;
}

/** Book balance of a lot on a date: what was accepted, less what moved out by then. */
async function bookOn(db, projectId, lot, onDate) {
  const { rows } = await db.query(
    "SELECT kind, qty FROM material_movement WHERE lot_id = $1 AND project_id = $2 AND moved_on <= $3", [lot.id, projectId, onDate]);
  return lotBalance(asLot(lot), rows.map((m) => ({ kind: m.kind, qty: Number(m.qty) }))).onHand;
}

export async function enterCount(db, { projectId, countId, lotId, countedQty, countedBy = null, note = null, userId = null }) {
  const c = await countRow(db, projectId, countId);
  if (c.status !== "open") throw bad("انبارگردانی بسته شده.");
  const { rows: [lot] } = await db.query("SELECT * FROM material_lot WHERE id = $1 AND project_id = $2", [lotId, projectId]);
  if (!lot) throw notFound("lot");
  if (iso(lot.received_on) > iso(c.counted_on)) throw bad("این لات پس از تاریخ انبارگردانی رسیده است.");
  // The book holds accepted stock only. A lot the MIR has not decided is quarantine: counting it
  // into the book would release it past inspection.
  if (lot.qty_accepted === null) throw bad("این لات هنوز بازرسی ورود (MIR) نشده — موجودی قرنطینه در انبارگردانی دفتری شمرده نمی‌شود.");
  if (countedQty === "" || countedQty === null || !(Number(countedQty) >= 0)) throw bad("مقدار شمارش‌شده باید عدد نامنفی باشد.");
  const system = await bookOn(db, projectId, lot, iso(c.counted_on));
  const { rows: [l] } = await db.query(
    `INSERT INTO stock_count_line (project_id, count_id, lot_id, system_qty, counted_qty, counted_by, note, entered_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, countId, lotId, system, Number(countedQty), blank(countedBy), blank(note), userId]);
  return { ...l, ...variance(system, countedQty) };
}

/**
 * Decide a difference: adjust the book to the count (a count movement dated
 * the count day) or keep the book. Not by whoever entered the count, and
 * never so that the lot would hold less than nothing today.
 */
export async function decideCountLine(db, { projectId, lineId, decision, reason, userId }) {
  if (!["adjust", "keep_book"].includes(decision)) throw bad("تصمیم: اصلاح موجودی دفتری یا حفظ دفتر.");
  if (!blank(reason)) throw bad("دلیل تصمیم لازم است.");
  const { rows: [l] } = await db.query(
    `SELECT cl.*, c.status, c.counted_on, c.count_no FROM stock_count_line cl JOIN stock_count c ON c.id = cl.count_id
      WHERE cl.id = $1 AND cl.project_id = $2`, [lineId, projectId]);
  if (!l) throw notFound("count line");
  if (l.status !== "open") throw bad("انبارگردانی بسته شده.");
  if (l.decision) throw bad("برای این ردیف قبلاً تصمیم گرفته شده.");
  if (!userId || userId === l.entered_by) throw bad("تصمیم دربارهٔ مغایرت با کسی جز ثبت‌کنندهٔ شمارش است.");
  const v = variance(l.system_qty, l.counted_qty);
  if (v.kind === "match") throw bad("این ردیف مغایرت ندارد.");
  if (decision === "adjust") {
    const { rows: [lot] } = await db.query("SELECT * FROM material_lot WHERE id = $1", [l.lot_id]);
    const now = await bookOn(db, projectId, lot, "9999-12-31");
    if (v.kind === "loss" && now + v.diff < 0) {
      throw bad(`موجودی فعلی دفتر ${now} است؛ کسر ${-v.diff} آن را منفی می‌کند — پس از شمارش حواله شده، دوباره بشمارید.`);
    }
    await db.query(
      `INSERT INTO material_movement (project_id, lot_id, kind, qty, moved_on, ref_no, count_line_id, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [projectId, l.lot_id, v.kind === "gain" ? "count_gain" : "count_loss", Math.abs(v.diff), l.counted_on, l.count_no, lineId, userId]);
  }
  const { rows: [r] } = await db.query(
    `UPDATE stock_count_line SET decision = $2, decision_reason = $3, decided_by = $4, decided_at = now() WHERE id = $1 RETURNING *`,
    [lineId, decision, blank(reason), userId]);
  return r;
}

export async function closeCount(db, { projectId, countId, userId = null }) {
  const c = await countRow(db, projectId, countId);
  if (c.status !== "open") throw bad("انبارگردانی قبلاً بسته شده.");
  const { rows: lines } = await db.query("SELECT system_qty, counted_qty, decision FROM stock_count_line WHERE count_id = $1", [countId]);
  if (!lines.length) throw bad("هیچ لاتی شمرده نشده.");
  const open = lines.filter((l) => variance(l.system_qty, l.counted_qty).kind !== "match" && !l.decision).length;
  if (open) throw bad(`${open} مغایرت بدون تصمیم مانده.`);
  const { rows: [r] } = await db.query(
    "UPDATE stock_count SET status = 'closed', closed_by = $2, closed_at = now() WHERE id = $1 RETURNING *", [countId, userId]);
  return r;
}

export async function countBoard(db, { projectId }) {
  const { rows: counts } = await db.query("SELECT * FROM stock_count WHERE project_id = $1 ORDER BY counted_on DESC, count_no", [projectId]);
  const out = [];
  for (const c of counts) {
    const { rows } = await db.query(
      `SELECT cl.*, i.code AS item_code, i.uom, l.receipt_no, l.heat_no, l.location, ue.display_name AS entered_name, ud.display_name AS decided_name
         FROM stock_count_line cl JOIN material_lot l ON l.id = cl.lot_id JOIN material_item i ON i.id = l.item_id
         LEFT JOIN app_user ue ON ue.id = cl.entered_by LEFT JOIN app_user ud ON ud.id = cl.decided_by
        WHERE cl.count_id = $1 ORDER BY i.code, l.receipt_no`, [c.id]);
    const lines = rows.map((r) => ({ id: r.id, lotId: r.lot_id, itemCode: r.item_code, uom: r.uom, receiptNo: r.receipt_no, heatNo: r.heat_no,
      location: r.location, systemQty: Number(r.system_qty), countedQty: Number(r.counted_qty), countedBy: r.counted_by, note: r.note,
      ...variance(r.system_qty, r.counted_qty), decision: r.decision, decisionReason: r.decision_reason,
      enteredBy: r.entered_by, enteredName: r.entered_name, decidedName: r.decided_name }));
    out.push({ id: c.id, countNo: c.count_no, countedOn: iso(c.counted_on), scope: c.scope, status: c.status, lines,
      accuracyPct: accuracy(lines), pending: lines.filter((l) => l.kind !== "match" && !l.decision).length });
  }
  return out;
}

async function countRow(db, projectId, id) {
  const { rows: [c] } = await db.query("SELECT * FROM stock_count WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!c) throw notFound("stock count");
  return c;
}
const asLot = (l) => ({ qtyAccepted: l.qty_accepted, qtyRejected: l.qty_rejected, heatNo: l.heat_no, mtcRef: l.mtc_ref, mtcStatus: l.mtc_status });
const blank = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
