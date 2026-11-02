/**
 * Installation equipment's register of an isometric (db/migrations/098_iso_equipment.sql), made to
 * match the sheet's equipment marks when the register is saved. The marks are
 * the source: their type, tag, BOM row, spool, welds, accessories and status
 * (lib/sheet/markup.mjs); this keeps them as rows with keys.
 *
 *   syncEquipment    on save, in the run's transaction
 *   listEquipment    the register of a revision, with its welds and accessories
 *   setAccessoryStatus  an accessory's installation, apart from its equipment's
 *
 * Nothing installed is dropped by a save: an equipment, or an accessory,
 * whose mark is gone or changed while it stands installed or tested refuses
 * the save (409), as an installed BOM line does.
 */
import { KINDS, EQUIPMENT_STATUS, weldsOf, accessoriesOf, plainNo } from "../../sheet/markup.mjs";

const conflict = (msg) => Object.assign(new Error(msg), { status: 409, code: "EQUIPMENT" });
const STATUS = new Set(EQUIPMENT_STATUS.map(([k]) => k));
const FIXED = new Set(["installed", "tested"]);
const text = (v) => String(v ?? "").trim();
const intOrNull = (v) => { const n = Number(text(v)); return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null; };

export async function syncEquipment(db, { projectId, documentId, runId = null, items = [], bom = [], userId = null }) {
  const marks = (items || []).filter((m) => KINDS[m?.kind]?.cls === "equipment" && text(m.id));
  const { rows: have } = await db.query("SELECT id, mark_id, equipment_no, status FROM iso_equipment WHERE project_id = $1 AND document_id = $2", [projectId, documentId]);
  if (!have.length && !marks.length) return { equipment: 0, removed: 0 };
  const weldMarks = (items || []).filter((m) => KINDS[m?.kind]?.cls === "weld");
  const byNo = new Map(weldMarks.map((w) => [plainNo(w.no), w]));
  const units = new Map((bom || []).filter((b) => b && b.pt != null).map((b) => [text(b.pt), b.qtyUnit === "m" ? "m" : "pcs"]));
  const want = new Map(marks.map((m) => [text(m.id), m]));
  let removed = 0;
  for (const e of have) {
    if (want.has(e.mark_id)) continue;
    const { rows: acc } = await db.query("SELECT pt, status FROM iso_equipment_accessory WHERE equipment_id = $1", [e.id]);
    if (FIXED.has(e.status) || acc.some((a) => FIXED.has(a.status)))
      throw conflict(`تجهیز ${e.equipment_no || e.mark_id} «${FIXED.has(e.status) ? e.status : "با متعلقات نصب‌شده"}» ثبت است و با حذف نشانش از نقشه پاک نمی‌شود؛ ابتدا وضعیتش را برگردانید.`);
    await db.query("DELETE FROM iso_equipment WHERE id = $1", [e.id]); removed += 1;
  }
  for (const [markId, m] of want) {
    const a = m.attrs || {};
    const status = STATUS.has(text(a.status)) ? text(a.status) : "planned";
    const { rows: [row] } = await db.query(
      `INSERT INTO iso_equipment (project_id, document_id, run_id, mark_id, equipment_no, tag, type, pt, spool, status, note, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       ON CONFLICT (document_id, mark_id) DO UPDATE SET run_id = EXCLUDED.run_id, equipment_no = EXCLUDED.equipment_no, tag = EXCLUDED.tag, type = EXCLUDED.type,
         pt = EXCLUDED.pt, spool = EXCLUDED.spool, status = EXCLUDED.status, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING id`,
      [projectId, documentId, runId, markId, text(m.no).slice(0, 120), text(a.tag).slice(0, 120) || null, text(a.type).slice(0, 120) || null, intOrNull(a.c1),
        text(a.spool).slice(0, 120) || null, status, text(a.note).slice(0, 400) || null, userId]);
    // the welds it joins: the numbers that are weld marks of this sheet
    const joins = weldsOf(a.welds).map((n) => byNo.get(plainNo(n))).filter(Boolean);
    const refs = new Set(joins.map((w) => text(w.id)));
    await db.query("DELETE FROM iso_equipment_weld WHERE equipment_id = $1 AND NOT (weld_ref = ANY($2))", [row.id, [...refs]]);
    for (const w of joins) {
      await db.query(`INSERT INTO iso_equipment_weld (project_id, equipment_id, weld_ref, weld_no) VALUES ($1, $2, $3, $4)
                      ON CONFLICT (equipment_id, weld_ref) DO UPDATE SET weld_no = EXCLUDED.weld_no`, [projectId, row.id, text(w.id), text(w.no) || null]);
    }
    // its accessories: a changed quantity keeps its status; one dropped while installed refuses
    const acc = accessoriesOf(a.acc).filter((x) => intOrNull(x.pt) != null);
    const keep = acc.map((x) => Number(x.pt));
    const { rows: gone } = await db.query("SELECT pt, status FROM iso_equipment_accessory WHERE equipment_id = $1 AND NOT (pt = ANY($2))", [row.id, keep]);
    const fixed = gone.find((g) => FIXED.has(g.status));
    if (fixed) throw conflict(`متعلقِ PT ${fixed.pt} تجهیز ${text(m.no)} «${fixed.status}» ثبت است و از فهرست برداشته نمی‌شود؛ ابتدا وضعیتش را برگردانید.`);
    await db.query("DELETE FROM iso_equipment_accessory WHERE equipment_id = $1 AND NOT (pt = ANY($2))", [row.id, keep]);
    for (const x of acc) {
      await db.query(`INSERT INTO iso_equipment_accessory (project_id, equipment_id, pt, qty, unit) VALUES ($1, $2, $3, $4, $5)
                      ON CONFLICT (equipment_id, pt) DO UPDATE SET qty = EXCLUDED.qty, unit = EXCLUDED.unit`,
        [projectId, row.id, Number(x.pt), x.qty, units.get(text(x.pt)) || "pcs"]);
    }
  }
  return { equipment: want.size, removed };
}

export async function listEquipment(db, { projectId, documentId }) {
  const { rows } = await db.query("SELECT * FROM iso_equipment WHERE project_id = $1 AND document_id = $2 ORDER BY equipment_no, mark_id", [projectId, documentId]);
  const { rows: welds } = await db.query(
    "SELECT w.equipment_id, w.weld_ref, w.weld_no FROM iso_equipment_weld w JOIN iso_equipment e ON e.id = w.equipment_id WHERE w.project_id = $1 AND e.document_id = $2 ORDER BY w.weld_no", [projectId, documentId]);
  const { rows: acc } = await db.query(
    "SELECT a.id, a.equipment_id, a.pt, a.qty, a.unit, a.status FROM iso_equipment_accessory a JOIN iso_equipment e ON e.id = a.equipment_id WHERE a.project_id = $1 AND e.document_id = $2 ORDER BY a.pt", [projectId, documentId]);
  return rows.map((e) => ({ id: e.id, markId: e.mark_id, no: e.equipment_no, tag: e.tag, type: e.type, pt: e.pt, spool: e.spool, status: e.status, note: e.note,
    welds: welds.filter((w) => w.equipment_id === e.id).map((w) => ({ ref: w.weld_ref, no: w.weld_no })),
    accessories: acc.filter((a) => a.equipment_id === e.id).map((a) => ({ id: a.id, pt: a.pt, qty: Number(a.qty), unit: a.unit, status: a.status })) }));
}

export async function setAccessoryStatus(db, { projectId, accessoryId, status }) {
  if (!STATUS.has(status)) throw Object.assign(new Error("status must be planned, delivered, installed or tested"), { status: 400 });
  const { rowCount } = await db.query("UPDATE iso_equipment_accessory SET status = $3 WHERE id = $1 AND project_id = $2", [accessoryId, projectId, status]);
  if (!rowCount) throw Object.assign(new Error("accessory not found"), { status: 404 });
}
