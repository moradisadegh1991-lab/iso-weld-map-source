/**
 * The ledger of who uses what of a drawing revision's BOM
 * (db/migrations/097_bom_allocation.sql, lib/register/bom-allocation.mjs).
 *
 *   syncAllocations       on save: the welds', installed items' and accessories' reservations made to match the sheet's
 *                         marks — added, changed, or released with a recorded reason;
 *                         a line already INSTALLED is never released by a save
 *   transition            install / return / release one line, with a reason
 *   availability          per BOM row: total, ceiling, reserved, installed, left
 *   history               the events of a revision's lines
 *
 * The ceiling is the database's (a trigger under a row lock), so two saves at
 * once cannot both take the last one. Call inside `withProject` (a transaction
 * for sync, which the run save already is).
 */

import { assertIsometricDocument, assertIsometricAllocation } from "../run-scope.mjs";
const conflict = (msg) => Object.assign(new Error(msg), { status: 409, code: "BOM_ALLOCATION" });
const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "BOM_ALLOCATION" });

const ACTIVE = ["reserved", "installed"];

/** The database's refusal, in words. */
function explain(e) {
  const m = /bom_allocation: (.*)/.exec(e?.message || "");
  if (!m) return e;
  const t = m[1];
  const left = /PT (\d+) has (\S+) of (\S+) left, (\S+) asked/.exec(t);
  if (left) return conflict(`از ردیف PT ${left[1]} فقط ${Number(left[2])} از ${Number(left[3])} باقی است و ${Number(left[4])} خواسته شد.`);
  const none = /PT (\d+) is not in/.exec(t);
  if (none) return conflict(`PT ${none[1]} در BOM این رویژن نیست.`);
  return conflict(t);
}

async function log(db, { projectId, documentId, id, event, before, after, statusBefore, statusAfter, reason, userId }) {
  await db.query(
    `INSERT INTO bom_allocation_event (project_id, document_id, allocation_id, event, qty_before, qty_after, status_before, status_after, reason, by_user)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [projectId, documentId, id, event, before, after, statusBefore, statusAfter, reason ? String(reason).slice(0, 400) : null, userId]);
}

const OWNERS = ["weld", "equipment", "accessory"];
const who = (r) => ({ weld: "سرجوش", equipment: "تجهیز", accessory: "متعلقات تجهیز" }[r.owner_kind] || r.owner_kind);

/** The sheet's lines made to match `demands` (lib/register/bom-allocation.mjs ledgerDemands). */
export async function syncAllocations(db, { projectId, documentId, runId = null, demands = [], userId = null }) {
  await assertIsometricDocument(db, { projectId, documentId, allowMissing: true });     // an isometric-only record (lib/db/run-scope.mjs)
  const { rows: have } = await db.query(
    // FOR UPDATE: a transition of one of these lines (install / return / release) waits for this save and is judged on what it leaves
    `SELECT id, pt, owner_kind, owner_ref, owner_no, qty, unit, status FROM bom_allocation
      WHERE project_id = $1 AND document_id = $2 AND owner_kind = ANY($4) AND status = ANY($3) ORDER BY id FOR UPDATE`,
    [projectId, documentId, ACTIVE, OWNERS]);
  if (!have.length && !demands.length) return { reserved: 0, adjusted: 0, released: 0 };
  const { rows: bomRows } = await db.query("SELECT pt FROM iso_bom_row WHERE project_id = $1 AND document_id = $2", [projectId, documentId]);
  const inBom = new Set(bomRows.map((r) => r.pt));
  // a weld naming a PT the saved BOM does not have is reported by the page; it holds nothing here
  const want = new Map(demands.filter((d) => inBom.has(d.pt)).map((d) => [`${d.ownerKind || "weld"}|${d.ownerRef}|${d.pt}`, d]));
  const out = { reserved: 0, adjusted: 0, released: 0 };
  const key = (r) => `${r.owner_kind}|${r.owner_ref}|${r.pt}`;
  const installed = new Map(have.filter((r) => r.status === "installed").map((r) => [key(r), r]));
  const reserved = new Map(have.filter((r) => r.status === "reserved").map((r) => [key(r), r]));

  // a line already installed whose weld or component is gone from the sheet: not released by a save
  for (const [k, r] of installed) {
    const w = want.get(k);
    if (!w || Number(w.qty) < Number(r.qty)) {
      throw conflict(`${who(r)} ${r.owner_no || r.owner_ref} روی PT ${r.pt} نصب‌شده ثبت است (${Number(r.qty)}) و با حذف یا تغییر آن در نقشه آزاد نمی‌شود؛ ابتدا نصب را برگردانید.`);
    }
  }
  try {
    // releases first, so a part moved from one weld to another is not counted twice
    for (const [k, r] of reserved) {
      const w = want.get(k);
      const need = w ? Number(w.qty) - Number(installed.get(k)?.qty || 0) : 0;
      if (need <= 0) {
        await db.query("UPDATE bom_allocation SET status = 'released', status_by = $2, status_at = now() WHERE id = $1", [r.id, userId]);
        await log(db, { projectId, documentId, id: r.id, event: "release", before: r.qty, after: r.qty, statusBefore: "reserved", statusAfter: "released",
          reason: w ? "covered by an installed line" : "owner or component removed from the sheet", userId });
        out.released += 1; reserved.delete(k);
      } else if (need < Number(r.qty)) {
        await db.query("UPDATE bom_allocation SET qty = $2, status_by = $3, status_at = now() WHERE id = $1", [r.id, need, userId]);
        await log(db, { projectId, documentId, id: r.id, event: "adjust", before: r.qty, after: need, statusBefore: "reserved", statusAfter: "reserved", reason: "sheet changed", userId });
        out.adjusted += 1;
      }
    }
    for (const [k, w] of want) {
      const need = Number(w.qty) - Number(installed.get(k)?.qty || 0);
      if (need <= 0) continue;
      const r = reserved.get(k);
      if (r) {
        if (Number(r.qty) === need) { if (w.ownerNo && w.ownerNo !== r.owner_no) await db.query("UPDATE bom_allocation SET owner_no = $2 WHERE id = $1", [r.id, w.ownerNo]); continue; }
        await db.query("UPDATE bom_allocation SET qty = $2, owner_no = $3, status_by = $4, status_at = now() WHERE id = $1", [r.id, need, w.ownerNo || r.owner_no, userId]);
        await log(db, { projectId, documentId, id: r.id, event: "adjust", before: r.qty, after: need, statusBefore: "reserved", statusAfter: "reserved", reason: "sheet changed", userId });
        out.adjusted += 1;
      } else {
        const { rows: [n] } = await db.query(
          `INSERT INTO bom_allocation (project_id, document_id, run_id, pt, owner_kind, owner_ref, owner_no, qty, unit, status, created_by, status_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reserved', $10, $10) RETURNING id`,
          [projectId, documentId, runId, w.pt, w.ownerKind || "weld", w.ownerRef, w.ownerNo || null, need, w.unit || "pcs", userId]);
        await log(db, { projectId, documentId, id: n.id, event: "reserve", before: null, after: need, statusBefore: null, statusAfter: "reserved", reason: "picked on the sheet", userId });
        out.reserved += 1;
      }
    }
  } catch (e) { throw explain(e); }
  await verifyLedger(db, { projectId, documentId });
  return out;
}

/**
 * After the BOM is saved again: no row may hold more than it now has, and no
 * line may name a PT the BOM lost. (The trigger guards each write; a smaller
 * BOM is a write to another table.)
 */
export async function verifyLedger(db, { projectId, documentId }) {
  await assertIsometricDocument(db, { projectId, documentId, allowMissing: true });     // an isometric-only record (lib/db/run-scope.mjs)
  const { rows } = await db.query(
    `SELECT a.pt, (a.owner_kind = 'weld') AS weld, sum(a.qty) AS used, max(b.qty) AS total, max(b.alloc_cap) AS cap, bool_or(b.pt IS NULL) AS gone
       FROM bom_allocation a LEFT JOIN iso_bom_row b ON b.document_id = a.document_id AND b.pt = a.pt
      WHERE a.project_id = $1 AND a.document_id = $2 AND a.status = ANY($3)
      GROUP BY a.pt, (a.owner_kind = 'weld')`, [projectId, documentId, ACTIVE]);
  for (const r of rows) {
    if (r.gone) throw conflict(`PT ${r.pt} از BOM حذف شده ولی هنوز ${Number(r.used)} از آن رزرو یا نصب‌شده ثبت است؛ ابتدا آزاد کنید.`);
    const cap = r.weld ? r.cap : r.total;
    if (cap != null && Number(r.used) > Number(cap)) throw conflict(`PT ${r.pt}: ${Number(r.used)} ${r.weld ? "سر" : "عدد"} رزرو یا نصب‌شده ثبت است ولی BOM اکنون فقط ${Number(cap)} دارد؛ ابتدا آزاد کنید.`);
  }
}

/**
 * Install a reserved line, return an installed one, or release a reserved one.
 *
 * The line is locked (SELECT … FOR UPDATE) BEFORE its status is read, in one transaction with the status update and the event:
 * two requests for the same line are taken one after the other, and the second is judged on what the first left — so an install
 * and a release at once cannot both succeed, and the history cannot say the line went two ways. Ownership (project, revision) is
 * part of the same read. The BOM-row ceiling stays the trigger's. (Inside a caller's transaction this is a savepoint, not another
 * transaction.)
 */
export async function transition(db, { projectId, documentId, allocationId, action, reason = null, userId = null }) {
  const next = { install: ["reserved", "installed"], return: ["installed", "returned"], release: ["reserved", "released"] }[action];
  if (!next) throw bad("action must be install, return or release");
  if ((action === "return" || action === "release") && !String(reason || "").trim()) throw bad("دلیل برگشت یا آزادسازی لازم است.");
  return db.transaction(async () => {
    await assertIsometricDocument(db, { projectId, documentId, allowMissing: true });     // an isometric-only record (lib/db/run-scope.mjs)
    await assertIsometricAllocation(db, { projectId, allocationId });     // the allocation's own drawing is resolved from the database
    const { rows: [a] } = await db.query(
      "SELECT * FROM bom_allocation WHERE id = $1 AND project_id = $2 AND document_id = $3 FOR UPDATE", [allocationId, projectId, documentId]);
    if (!a) throw Object.assign(new Error("allocation not found"), { status: 404 });
    if (a.status !== next[0]) throw conflict(`این خط «${a.status}» است؛ ${action} فقط برای «${next[0]}» ممکن است.`);
    try {
      if (action === "install") {
        // an installed line replaces nothing: the same owner's reserved line becomes it (one installed line per owner and row)
        const { rows: [dup] } = await db.query(
          "SELECT id, qty FROM bom_allocation WHERE document_id = $1 AND pt = $2 AND owner_kind = $3 AND owner_ref = $4 AND status = 'installed' FOR UPDATE",
          [documentId, a.pt, a.owner_kind, a.owner_ref]);
        if (dup) {
          await db.query("UPDATE bom_allocation SET qty = qty + $2, status_by = $3, status_at = now() WHERE id = $1", [dup.id, a.qty, userId]);
          await db.query("UPDATE bom_allocation SET status = 'released', status_by = $2, status_at = now() WHERE id = $1", [a.id, userId]);
          await log(db, { projectId, documentId, id: dup.id, event: "install", before: dup.qty, after: Number(dup.qty) + Number(a.qty), statusBefore: "installed", statusAfter: "installed", reason, userId });
          return;
        }
      }
      await db.query("UPDATE bom_allocation SET status = $2, status_by = $3, status_at = now() WHERE id = $1", [a.id, next[1], userId]);
      await log(db, { projectId, documentId, id: a.id, event: action, before: a.qty, after: a.qty, statusBefore: a.status, statusAfter: next[1], reason, userId });
    } catch (e) { throw explain(e); }
  });
}

/** Per BOM row of the revision: its ceilings and what is reserved, installed and left. */
export async function availability(db, { projectId, documentId }) {
  await assertIsometricDocument(db, { projectId, documentId, allowMissing: true });     // an isometric-only record (lib/db/run-scope.mjs)
  const { rows: rows } = await db.query(
    `SELECT b.pt, b.description, b.size, b.qty, b.qty_unit, b.alloc_cap,
            coalesce(sum(a.qty) FILTER (WHERE a.status = 'reserved' AND a.owner_kind = 'weld'), 0) AS weld_reserved,
            coalesce(sum(a.qty) FILTER (WHERE a.status = 'installed' AND a.owner_kind = 'weld'), 0) AS weld_installed,
            coalesce(sum(a.qty) FILTER (WHERE a.status = 'reserved' AND a.owner_kind <> 'weld'), 0) AS reserved,
            coalesce(sum(a.qty) FILTER (WHERE a.status = 'installed' AND a.owner_kind <> 'weld'), 0) AS installed,
            coalesce(sum(a.qty) FILTER (WHERE a.status = 'returned'), 0) AS returned
       FROM iso_bom_row b LEFT JOIN bom_allocation a ON a.document_id = b.document_id AND a.pt = b.pt
      WHERE b.project_id = $1 AND b.document_id = $2 GROUP BY b.pt, b.description, b.size, b.qty, b.qty_unit, b.alloc_cap ORDER BY b.pt`,
    [projectId, documentId]);
  const n = (v) => (v == null ? null : Number(v));
  const { rows: lines } = await db.query(
    `SELECT id, pt, owner_kind, owner_ref, owner_no, qty, unit, status, note, status_at FROM bom_allocation
      WHERE project_id = $1 AND document_id = $2 AND status = ANY($3) ORDER BY pt, owner_kind, owner_no`, [projectId, documentId, ACTIVE]);
  return {
    rows: rows.map((r) => ({ pt: r.pt, description: r.description, size: r.size, qty: n(r.qty), unit: r.qty_unit, weldEnds: n(r.alloc_cap),
      weldReserved: n(r.weld_reserved), weldInstalled: n(r.weld_installed), weldLeft: r.alloc_cap == null ? null : n(r.alloc_cap) - n(r.weld_reserved) - n(r.weld_installed),
      reserved: n(r.reserved), installed: n(r.installed), returned: n(r.returned),
      left: r.qty == null ? null : n(r.qty) - n(r.reserved) - n(r.installed) })),
    lines: lines.map((l) => ({ id: l.id, pt: l.pt, ownerKind: l.owner_kind, ownerRef: l.owner_ref, ownerNo: l.owner_no, qty: n(l.qty), unit: l.unit, status: l.status, note: l.note, at: l.status_at })),
  };
}

/**
 * The events of a revision, newest first. Each event says what it was about from its own snapshot (migration 104): the
 * history does not need the allocation row to still exist.
 */
export async function history(db, { projectId, documentId, limit = 200 }) {
  await assertIsometricDocument(db, { projectId, documentId, allowMissing: true });     // an isometric-only record (lib/db/run-scope.mjs)
  const { rows } = await db.query(
    `SELECT e.event, e.qty_before, e.qty_after, e.status_before, e.status_after, e.reason, e.at, e.pt, e.owner_kind, e.owner_no, e.owner_ref, e.unit, u.display_name
       FROM bom_allocation_event e LEFT JOIN app_user u ON u.id = e.by_user
      WHERE e.project_id = $1 AND e.document_id = $2 ORDER BY e.at DESC, e.id LIMIT $3`, [projectId, documentId, Math.min(500, Math.max(1, limit))]);
  return rows.map((r) => ({ event: r.event, before: r.qty_before == null ? null : Number(r.qty_before), after: r.qty_after == null ? null : Number(r.qty_after),
    from: r.status_before, to: r.status_after, reason: r.reason, at: r.at, pt: r.pt, ownerKind: r.owner_kind, ownerNo: r.owner_no, ownerRef: r.owner_ref, unit: r.unit, by: r.display_name }));
}

/** The old name: the welds' lines (and now the installed items') made to match the sheet. */
export const syncWeldAllocations = syncAllocations;
