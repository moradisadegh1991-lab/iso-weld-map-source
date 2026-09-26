/**
 * A spool's material against the warehouse: what it needs (from the
 * register, lib/piping/spool-bom.mjs), what is reserved for it and issued
 * to it, and one act that reserves the rest. Call inside `withProject`.
 */
import { materialLine } from "../../piping/spool-bom.mjs";
import { freeFor } from "../../warehouse/reserve.mjs";
import { itemReservations, reserve } from "./reserve.mjs";

/** The spool's material list, one line per stock code, with its state. */
export async function spoolMaterial(db, { projectId, spoolId }) {
  const { rows: raw } = await db.query(
    `SELECT kind, fitting_type, nps::float8 AS nps, qty::float8 AS qty, uom, stock_code, description, reason
       FROM spool_material WHERE spool_id = $1 AND project_id = $2 ORDER BY kind DESC, nps DESC, fitting_type`, [spoolId, projectId]);
  // One stock code is one line, whatever pieces it came from.
  const lines = [];
  for (const r of raw) {
    const same = r.stock_code && lines.find((l) => l.stockCode === r.stock_code && l.uom === r.uom);
    if (same) { same.qty = Math.round((same.qty + r.qty) * 1000) / 1000; continue; }
    lines.push({ kind: r.kind, type: r.fitting_type, nps: r.nps, qty: r.qty, uom: r.uom, stockCode: r.stock_code, description: r.description, reason: r.reason });
  }
  const key = `spool:${spoolId}`;
  const out = [];
  for (const l of lines) {
    if (!l.stockCode) { out.push(materialLine(l, {})); continue; }
    const { rows: [item] } = await db.query(
      "SELECT id, code, uom FROM material_item WHERE project_id = $1 AND upper(code) = upper($2)", [projectId, l.stockCode]);
    if (!item) { out.push(materialLine(l, {})); continue; }
    const s = await itemReservations(db, { projectId, itemId: item.id });
    const mine = s.reservations.filter((r) => r.key === key);
    const reserved = mine.reduce((a, r) => a + r.left, 0);
    const { rows: [{ issued }] } = await db.query(
      `SELECT COALESCE(sum(CASE WHEN m.kind = 'issue' THEN m.qty WHEN m.kind = 'return' THEN -m.qty ELSE 0 END), 0)::float8 AS issued
         FROM material_movement m JOIN material_lot l ON l.id = m.lot_id
        WHERE m.project_id = $1 AND m.spool_id = $2 AND l.item_id = $3`, [projectId, spoolId, item.id]);
    const onHand = s.lots.filter((x) => x.issuable).reduce((a, x) => a + Math.max(0, x.onHand), 0);
    const free = Math.max(0, freeFor({ issuableOnHand: onHand, reservations: s.reservations, key }) - reserved);
    out.push({ ...materialLine(l, { item, reserved, issued, free: Math.round(free * 1000) / 1000 }), itemId: item.id, itemCode: item.code, reserved, issued });
  }
  const blocking = out.filter((l) => ["unmatched", "no_item", "uom", "short"].includes(l.state));
  return { lines: out, ready: out.length > 0 && blocking.length === 0,
    toReserve: out.filter((l) => l.state === "available").length, blocking: blocking.length };
}

/**
 * Reserve what the spool still needs — all of it or none: a spool released
 * with half its pipe set aside is a spool that stops at the saw.
 */
export async function reserveSpoolMaterial(db, { projectId, spoolId, needBy = null, userId = null }) {
  if (!userId) throw bad("رزرو را یک شخص ثبت می‌کند.");
  const m = await spoolMaterial(db, { projectId, spoolId });
  if (!m.lines.length) throw bad("فهرست مواد این اسپول خالی است — رجیستر نقشه با MTO ذخیره نشده.");
  const blocking = m.lines.filter((l) => ["unmatched", "no_item", "uom", "short"].includes(l.state));
  if (blocking.length) {
    throw bad(`مواد اسپول کامل رزرو نمی‌شود: ${blocking.map((l) => `${l.stockCode || l.type || "لوله"} ${l.nps}" — ${l.text}`).join(" · ")}`);
  }
  const made = [];
  for (const l of m.lines.filter((x) => x.state === "available")) {
    made.push(await reserve(db, { projectId, itemId: l.itemId, qty: l.need, spoolId, needBy, userId }));
  }
  if (!made.length) throw bad("همهٔ مواد این اسپول پیش‌تر رزرو یا حواله شده است.");
  return { reserved: made.length };
}

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
