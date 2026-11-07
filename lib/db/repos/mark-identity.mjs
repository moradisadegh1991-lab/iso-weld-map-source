/**
 * Persistent mark identity on the server (lib/sheet/mark-identity.mjs is the contract; migration 105 the tables).
 *
 *   legacyMarkUid        the identity a saved mark WITHOUT one has had since migration 105 — the same value the migration wrote
 *   reconcileSheetMarks  which new mark is which saved mark of the SAME drawing revision; refuses (409) when an ambiguity
 *                        would put a mark that something installed stands on at risk
 *   registerMarks        every uid in use is registered to its drawing revision; one registered to another is refused
 *   recordMarkWarnings / markWarnings / resolveMarkWarning
 *
 * Call inside the caller's transaction (it opens none).
 */
import { createHash } from "node:crypto";
import { reconcileMarks, markClass, isUid } from "../../sheet/mark-identity.mjs";

const conflict = (msg, code) => Object.assign(new Error(msg), { status: 409, code });
const text = (v) => String(v ?? "").trim();

/** md5("document:legacyId") laid out as a v4 UUID — identical to legacy_mark_uid() in migration 105. */
export function legacyMarkUid(documentId, legacyId) {
  const h = createHash("md5").update(`${documentId}:${legacyId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[parseInt(h.slice(16, 18), 16) & 3]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Which of the marks a sheet now shows is which of the marks saved for this drawing revision.
 * @param previousItems  the revision's marks as last saved (a payload's sheetMarkup.items), or []
 * @returns {{ items: object[], report: object }}  items all carry a uid; see reconcileMarks for the report
 */
export async function reconcileSheetMarks(db, { projectId, documentId, previousItems = [], items = [] }) {
  const { items: out, report } = reconcileMarks({ previous: previousItems, incoming: items, legacyUid: (id) => legacyMarkUid(documentId, id) });

  // An ambiguity that touches a mark something installed stands on is not solved by guessing: refuse and say how to settle it.
  if (report.ambiguous.length) {
    const uids = report.ambiguous.flatMap((a) => a.previous.map((p) => p.uid));
    const fixed = await fixedDependents(db, { projectId, documentId, uids });
    if (fixed.length) {
      throw Object.assign(conflict(
        `نشانه‌ای که چیزی روی آن نصب یا تست شده با نشانهٔ جدید یکی دانسته نشد: ${fixed.join("؛ ")}. ` +
        "شماره یا ویژگی‌های نشانه‌ها را در نقشه روشن کنید (یا شناسهٔ uid نشانهٔ درست را صریح بدهید) و دوباره ذخیره کنید؛ هیچ چیز تغییر نکرد.", "MARK_IDENTITY_AMBIGUOUS"),
        { ambiguous: report.ambiguous });
    }
  }
  return { items: out, report };
}

/** Which marks, among `uids`, have something installed or tested (equipment, accessories) or an installed allocation behind them. */
async function fixedDependents(db, { projectId, documentId, uids }) {
  if (!uids.length) return [];
  const out = [];
  const { rows: eq } = await db.query(
    `SELECT e.mark_id, e.equipment_no, e.status FROM iso_equipment e
      WHERE e.project_id = $1 AND e.document_id = $2 AND e.mark_id = ANY($3)
        AND (e.status IN ('installed','tested') OR EXISTS (SELECT 1 FROM iso_equipment_accessory a WHERE a.equipment_id = e.id AND a.status IN ('installed','tested')))`,
    [projectId, documentId, uids]);
  for (const r of eq) out.push(`تجهیز ${r.equipment_no || r.mark_id} «${r.status}»`);
  const { rows: al } = await db.query(
    `SELECT DISTINCT owner_ref, owner_no FROM bom_allocation WHERE project_id = $1 AND document_id = $2 AND owner_ref = ANY($3) AND status = 'installed'`,
    [projectId, documentId, uids]);
  for (const r of al) out.push(`تخصیص نصب‌شدهٔ ${r.owner_no || r.owner_ref}`);
  return out;
}

/** Register every uid of the marks to this drawing revision; a uid registered to another revision (or project) is refused. */
export async function registerMarks(db, { projectId, documentId, runId = null, items = [] }) {
  const marks = (items || []).filter((m) => isUid(m?.uid) && markClass(m));
  if (!marks.length) return { registered: 0 };
  let registered = 0;
  for (const m of marks) {
    const { rows } = await db.query(
      `INSERT INTO sheet_mark_identity (uid, project_id, document_id, cls, legacy_id, first_no, run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (uid) DO NOTHING RETURNING uid`,
      [m.uid, projectId, documentId, markClass(m), text(m.id) || null, text(m.no).slice(0, 120) || null, runId]);
    if (rows.length) { registered += 1; continue; }
    const { rows: [have] } = await db.query("SELECT project_id, document_id FROM sheet_mark_identity WHERE uid = $1", [m.uid]);
    // (a row of another project is invisible here under RLS: the insert's conflict is then all there is to see)
    if (!have || have.document_id !== documentId || have.project_id !== projectId) {
      throw conflict(`شناسهٔ نشانهٔ ${text(m.no) || m.id} به رویژن دیگری از نقشه تعلق دارد و برای این رویژن به کار نمی‌رود؛ هر رویژن نشانه‌های خودش را دارد.`, "MARK_UID_CONFLICT");
    }
  }
  return { registered };
}

/** Record what the reconciliation could not settle, for review. */
export async function recordMarkWarnings(db, { projectId, documentId, runId = null, report }) {
  let n = 0;
  for (const a of report?.ambiguous || []) {
    await db.query("INSERT INTO sheet_mark_warning (project_id, document_id, run_id, kind, detail) VALUES ($1,$2,$3,'ambiguous',$4)",
      [projectId, documentId, runId, JSON.stringify(a)]);
    n += 1;
  }
  return n;
}

/**
 * Legacy equipment → weld links that could not be proven (a printed number that names several welds, or none) are recorded, once each, for
 * review — through the existing warning table (`kind = 'ambiguous'`, `detail.type = 'equipment_weld'`); nothing is linked on a guess.
 */
export async function recordEquipmentWeldWarnings(db, { projectId, documentId, runId = null, unresolved = [] }) {
  let n = 0;
  for (const u of unresolved) {
    const detail = { type: "equipment_weld", equipmentNo: u.equipmentNo, equipmentRef: u.equipmentRef, weldNo: u.weldNo, reason: u.reason, candidates: u.candidates || [] };
    const { rows: [same] } = await db.query(
      "SELECT id FROM sheet_mark_warning WHERE project_id = $1 AND document_id = $2 AND resolved_at IS NULL AND detail @> $3::jsonb LIMIT 1",
      [projectId, documentId, JSON.stringify({ type: "equipment_weld", equipmentRef: u.equipmentRef, weldNo: u.weldNo, reason: u.reason })]);
    if (same) continue;
    await db.query("INSERT INTO sheet_mark_warning (project_id, document_id, run_id, kind, detail) VALUES ($1,$2,$3,'ambiguous',$4)", [projectId, documentId, runId, JSON.stringify(detail)]);
    n += 1;
  }
  return n;
}

export async function markWarnings(db, { projectId, documentId, open = true }) {
  const { rows } = await db.query(
    `SELECT id, run_id, kind, detail, created_at, resolved_at, resolved_by, resolution FROM sheet_mark_warning
      WHERE project_id = $1 AND document_id = $2 AND ($3::boolean = false OR resolved_at IS NULL) ORDER BY created_at DESC, id`, [projectId, documentId, open]);
  return rows;
}

export async function resolveMarkWarning(db, { projectId, warningId, userId = null, resolution = "" }) {
  const note = text(resolution);
  if (!note) throw Object.assign(new Error("resolution is required"), { status: 400, code: "INVALID_INPUT" });
  const { rowCount } = await db.query(
    "UPDATE sheet_mark_warning SET resolved_at = now(), resolved_by = $3, resolution = $4 WHERE id = $1 AND project_id = $2 AND resolved_at IS NULL",
    [warningId, projectId, userId, note.slice(0, 400)]);
  if (!rowCount) throw Object.assign(new Error("warning not found or already resolved"), { status: 404 });
}
