/**
 * Warehouse: items, receiving, inspection (MIR / MTC), issue and return,
 * stock, shortage against the MTO, and heat traceability.
 *
 * Every rule is lib/warehouse/stock.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import { onOrderByItem } from "./procurement.mjs";
import { assertStepReleased, holdsFor } from "./inspection.mjs";
import { checkIssueAgainstReservations } from "./reserve.mjs";
import {
  CATEGORIES, TRACEABLE, inspectionState, lotIssuable, lotBalance, checkMovement, shortage,
} from "../../warehouse/stock.mjs";

export async function upsertItem(db, { projectId, code, description, category, uom, spec = null }) {
  if (!code || !description || !uom) throw bad("کد، شرح و واحد کالا لازم است.");
  if (!CATEGORIES[category]) throw bad(`دستهٔ «${category}» شناخته نشد.`);
  const { rows } = await db.query(
    `INSERT INTO material_item (project_id, code, description, category, uom, spec)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (project_id, code) DO UPDATE
        SET description = EXCLUDED.description, category = EXCLUDED.category,
            uom = EXCLUDED.uom, spec = COALESCE(EXCLUDED.spec, material_item.spec)
     RETURNING *`,
    [projectId, String(code).trim().toUpperCase(), description, category, uom, spec]);
  return rows[0];
}

/** Receive a lot. It is quarantine until the MIR decides. */
export async function receiveLot(db, {
  projectId, itemId, receiptNo, poRef = null, supplier = null, receivedOn, heatNo = null, mtcRef = null,
  qtyReceived, location = null, userId = null,
}) {
  if (!receiptNo || !receivedOn) throw bad("شمارهٔ رسید و تاریخ لازم است.");
  if (!(Number(qtyReceived) > 0)) throw bad("مقدار دریافتی باید مثبت باشد.");
  const item = await itemRow(db, projectId, itemId);
  const { rows } = await db.query(
    `INSERT INTO material_lot (project_id, item_id, receipt_no, po_ref, supplier, received_on, heat_no, mtc_ref,
                               qty_received, location, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [projectId, item.id, receiptNo, poRef, supplier, receivedOn, blank(heatNo), blank(mtcRef),
     Number(qtyReceived), location, userId]);
  return rows[0];
}

/**
 * Record the MIR: accepted and rejected quantities.
 *
 * Accepting any quantity is the step the project's material ITP may hold
 * (a Hold or Witness on "mir"): refused until its inspection request is
 * released. Rejecting the whole lot is not held.
 */
export async function inspectLot(db, { projectId, lotId, qtyAccepted, qtyRejected = 0, mirRef = null, inspectedOn }) {
  const lot = await lotRow(db, projectId, lotId);
  const a = Number(qtyAccepted), r = Number(qtyRejected || 0);
  if (!(a >= 0) || !(r >= 0)) throw bad("مقادیر پذیرفته و ردشده باید عدد نامنفی باشند.");
  if (a + r > Number(lot.qty_received)) throw bad(`پذیرفته + ردشده (${a + r}) از دریافتی (${Number(lot.qty_received)}) بیشتر است.`);
  if (!inspectedOn) throw bad("تاریخ بازرسی لازم است.");
  const { rows: moves } = await db.query("SELECT kind, qty FROM material_movement WHERE lot_id = $1", [lotId]);
  const b = lotBalance({ qtyAccepted: a }, moves.map((m) => ({ kind: m.kind, qty: Number(m.qty) })));
  if (b.onHand < 0) throw bad(`از این لات ${b.netIssued} حواله شده؛ پذیرفته نمی‌تواند کمتر از آن باشد.`);
  if (a > 0) await assertStepReleased(db, { projectId, scope: "material", stepCode: "mir", itemKind: "lot", itemId: lotId });
  const { rows } = await db.query(
    `UPDATE material_lot SET qty_accepted = $1, qty_rejected = $2, mir_ref = $3, inspected_on = $4
      WHERE id = $5 AND project_id = $6 RETURNING *`, [a, r, mirRef, inspectedOn, lotId, projectId]);
  return rows[0];
}

/**
 * Record the MTC and QC's review of it. A rejection after issue opens a
 * recall. Accepting it is held like the MIR ("mtc_review" in the ITP).
 */
export async function reviewMtc(db, { projectId, lotId, mtcRef, heatNo, mtcStatus }) {
  const lot = await lotRow(db, projectId, lotId);
  if (!["pending", "accepted", "rejected"].includes(mtcStatus)) throw bad(`وضعیت MTC «${mtcStatus}» شناخته نشد.`);
  const ref = blank(mtcRef) ?? lot.mtc_ref;
  const heat = blank(heatNo) ?? lot.heat_no;
  if (mtcStatus === "accepted" && (!ref || !heat)) throw bad("پذیرش MTC بدون شمارهٔ گواهی و شمارهٔ ذوب ممکن نیست.");
  if (mtcStatus === "accepted") {
    await assertStepReleased(db, { projectId, scope: "material", stepCode: "mtc_review", itemKind: "lot", itemId: lotId });
  }
  const { rows } = await db.query(
    "UPDATE material_lot SET mtc_ref = $1, heat_no = $2, mtc_status = $3 WHERE id = $4 AND project_id = $5 RETURNING *",
    [ref, heat, mtcStatus, lotId, projectId]);
  return { lot: rows[0], recall: mtcStatus === "rejected" ? await destinations(db, { projectId, lotIds: [lotId] }) : [] };
}

/**
 * Issue or return. The balance is re-read inside the same transaction the
 * insert runs in, so two issues from one request cannot both spend it.
 */
export async function recordMovement(db, {
  projectId, lotId, kind, qty, movedOn, refNo = null, contractorId = null, spoolId = null, tagId = null,
  purpose = null, userId = null,
}) {
  if (!movedOn) throw bad("تاریخ لازم است.");
  const lot = await lotRow(db, projectId, lotId);
  const item = await itemRow(db, projectId, lot.item_id);
  const { rows: moves } = await db.query("SELECT kind, qty FROM material_movement WHERE lot_id = $1", [lotId]);
  const ok = checkMovement({ kind, qty }, asLot(lot), item, moves.map((m) => ({ kind: m.kind, qty: Number(m.qty) })));
  if (!ok.ok) throw bad(ok.reason);
  if (kind === "issue" && !spoolId && !tagId && !purpose) {
    throw bad("مقصد حواله لازم است (اسپول، تگ یا شرح مصرف) — بدون آن ردیابی ذوب ممکن نیست.");
  }
  // Stock reserved for another spool or tag is not issued here; this destination's own reservation is filled.
  const reservationId = kind === "issue"
    ? await checkIssueAgainstReservations(db, { projectId, lotId, itemId: lot.item_id, qty, spoolId, tagId, purpose })
    : null;
  const { rows } = await db.query(
    `INSERT INTO material_movement (project_id, lot_id, kind, qty, moved_on, ref_no, contractor_id, spool_id, tag_id,
                                    purpose, recorded_by, reservation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projectId, lotId, kind, Number(qty), movedOn, refNo, contractorId, spoolId, tagId, purpose, userId, reservationId]);
  return rows[0];
}

/** Add or replace an MTO requirement for an item. */
export async function setRequirement(db, { projectId, itemId, qty, source, lineId = null, tagId = null }) {
  if (!source) throw bad("منبع (MTO و رویژن) لازم است.");
  if (!(Number(qty) > 0)) throw bad("مقدار مورد نیاز باید مثبت باشد.");
  await itemRow(db, projectId, itemId);
  const { rows } = await db.query(
    `INSERT INTO material_requirement (project_id, item_id, qty, source, line_id, tag_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (project_id, item_id, source) DO UPDATE SET qty = EXCLUDED.qty
     RETURNING *`, [projectId, itemId, Number(qty), source, lineId, tagId]);
  return rows[0];
}

/** Every lot with its state, balance and whether it may be issued. */
export async function stock(db, { projectId }) {
  const { rows: lots } = await db.query(
    `SELECT l.*, i.code, i.description, i.category, i.uom, i.spec FROM material_lot l
       JOIN material_item i ON i.id = l.item_id WHERE l.project_id = $1
      ORDER BY i.code, l.received_on, l.created_at`, [projectId]);
  const { rows: moves } = await db.query(
    "SELECT lot_id, kind, qty FROM material_movement WHERE project_id = $1", [projectId]);
  // What the material ITP still holds on each lot, so the page says "waiting
  // on IR-00031" instead of offering a button the server will refuse.
  const hold = await holdsFor(db, { projectId });
  return lots.map((l) => {
    const b = lotBalance(asLot(l), moves.filter((m) => m.lot_id === l.id).map((m) => ({ kind: m.kind, qty: Number(m.qty) })));
    const can = lotIssuable(asLot(l), { category: l.category });
    return { id: l.id, itemId: l.item_id, code: l.code, description: l.description, category: l.category,
      uom: l.uom, spec: l.spec, traceable: TRACEABLE.has(l.category), receiptNo: l.receipt_no, poRef: l.po_ref,
      supplier: l.supplier, receivedOn: iso(l.received_on), heatNo: l.heat_no, mtcRef: l.mtc_ref,
      mtcStatus: l.mtc_status, qtyReceived: Number(l.qty_received), location: l.location,
      inspection: inspectionState(asLot(l)), ...b, issuable: can.ok, holdReasons: can.reasons,
      itpHold: {
        mir: Number(l.qty_accepted) > 0 ? null : hold("material", "lot", l.id, "mir"),
        mtc: l.mtc_status === "accepted" ? null : hold("material", "lot", l.id, "mtc_review"),
      } };
  });
}

/** Required against held, per item. */
export async function shortages(db, { projectId }) {
  const lots = await stock(db, { projectId });
  // What is still coming, from the purchase orders: a shortfall with an
  // order behind it and a date is a different conversation from one with none.
  const ordered = await onOrderByItem(db, { projectId });
  const { rows: items } = await db.query(
    `SELECT i.id, i.code, i.description, i.uom, COALESCE(sum(r.qty), 0) AS required,
            string_agg(DISTINCT r.source, '، ') AS sources
       FROM material_item i LEFT JOIN material_requirement r ON r.item_id = i.id
      WHERE i.project_id = $1 GROUP BY i.id ORDER BY i.code`, [projectId]);
  return items.map((i) => {
    const mine = lots.filter((l) => l.itemId === i.id);
    const s = shortage(Number(i.required),
      mine.reduce((a, l) => a + l.netIssued, 0),
      mine.filter((l) => l.issuable).reduce((a, l) => a + l.onHand, 0),
      mine.filter((l) => !l.issuable).reduce((a, l) => a + Math.max(0, l.onHand), 0)
        + mine.filter((l) => l.inspection === "pending").reduce((a, l) => a + l.qtyReceived, 0));
    return { itemId: i.id, code: i.code, description: i.description, uom: i.uom, sources: i.sources, ...s,
      onOrder: ordered[i.id] || { qty: 0, nextOn: null, lines: 0 } };
  });
}

/** Where material from these lots went: the recall list. */
export async function destinations(db, { projectId, lotIds }) {
  const { rows } = await db.query(
    `SELECT m.lot_id, sum(CASE WHEN m.kind = 'issue' THEN m.qty ELSE -m.qty END) AS qty,
            sp.id AS spool_id, sp.spool_no, ln.line_no, t.tag_no, m.purpose,
            st.stage AS spool_stage
       FROM material_movement m
       LEFT JOIN spool sp ON sp.id = m.spool_id
       LEFT JOIN line ln ON ln.id = sp.line_id
       LEFT JOIN tag t ON t.id = m.tag_id
       LEFT JOIN reporting.spool_stage st ON st.spool_key = sp.id
      WHERE m.project_id = $1 AND m.lot_id = ANY($2::uuid[]) AND m.kind IN ('issue', 'return')
      GROUP BY m.lot_id, sp.id, sp.spool_no, ln.line_no, t.tag_no, m.purpose, st.stage
     HAVING sum(CASE WHEN m.kind = 'issue' THEN m.qty ELSE -m.qty END) > 0
      ORDER BY ln.line_no, sp.spool_no, t.tag_no`, [projectId, lotIds]);
  return rows.map((r) => ({ ...r, qty: Number(r.qty) }));
}

/** Everything one heat number touched: lots, and where they went. */
export async function heatTrace(db, { projectId, heatNo }) {
  const h = String(heatNo || "").trim();
  if (!h) throw bad("شمارهٔ ذوب لازم است.");
  const all = await stock(db, { projectId });
  const lots = all.filter((l) => (l.heatNo || "").toUpperCase() === h.toUpperCase());
  return { heatNo: h, lots, destinations: lots.length ? await destinations(db, { projectId, lotIds: lots.map((l) => l.id) }) : [] };
}

export async function listItems(db, { projectId }) {
  const { rows } = await db.query("SELECT * FROM material_item WHERE project_id = $1 ORDER BY code", [projectId]);
  return rows;
}

async function itemRow(db, projectId, itemId) {
  const { rows: [i] } = await db.query("SELECT * FROM material_item WHERE id = $1 AND project_id = $2", [itemId, projectId]);
  if (!i) throw notFound("item");
  return i;
}
async function lotRow(db, projectId, lotId) {
  const { rows: [l] } = await db.query("SELECT * FROM material_lot WHERE id = $1 AND project_id = $2", [lotId, projectId]);
  if (!l) throw notFound("lot");
  return l;
}
const asLot = (l) => ({ qtyAccepted: l.qty_accepted, qtyRejected: l.qty_rejected, heatNo: l.heat_no,
  mtcRef: l.mtc_ref, mtcStatus: l.mtc_status });
const blank = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
