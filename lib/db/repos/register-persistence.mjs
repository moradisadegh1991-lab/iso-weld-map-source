/**
 * One persistence path for a drawing revision's register and everything that hangs off it.
 *
 * Saving a run (app/api/runs) and correcting one (lib/db/repos/review.mjs applyCorrection) both end in the same facts:
 *
 *   register   welds and spools, with weld identity carried from the previous derivation   (saveRegister)
 *   BOM        the sheet revision's iso_bom_row                                            (saveIsoBom)
 *   equipment  the installation equipment and its accessories, from the sheet's marks       (syncEquipment)
 *   allocation the ledger of who holds what of the BOM, from the sheet's marks              (syncAllocations)
 *
 * Until now only the save wrote the last three, and only when the BOM had rows; a correction rebuilt the register and
 * left the BOM, the allocations and the equipment as the first save had made them. This module is the one place that keeps them
 * consistent. It is NOT a transaction: it runs on the handle it is given, which must be the caller's open transaction (a run
 * save, a correction), and it never opens another — a failure anywhere throws and the caller's rollback takes everything.
 *
 * Revision semantics are the caller's, not this module's: a save carries weld identity from the previous run of the drawing and
 * creates a run; a correction re-derives the SAME run (`replaceRegister`). What they share is below.
 *
 * ── The BOM in the payload has three states (bomState) ──────────────────────────────────────────────────────────────────
 *   `bom` absent (or null)  the saved BOM is left exactly as it is; allocations and equipment are reconciled against it
 *   `bom: []`               an explicit request to clear it: refused (409) while any allocation of the revision is reserved or
 *                           installed — release them first, on purpose
 *   `bom: [ … ]`            replace it by these rows (one per PT); an installed line whose row is gone or smaller refuses, a
 *                           reserved line is adjusted or released, as it always was
 * Replacing or clearing is refused (409) when the revision has an approved run: a signed BOM changes by a new revision.
 *
 * ── The sheet's marks (payload.sheetMarkup.items) ─────────────────────────────────────────────────────────────────────
 * The page sends them only when there are some, so absent means none: equipment and allocations are reconciled to NO marks —
 * which removes planned ones and REFUSES (409) for anything installed or tested. Nothing installed is ever dropped.
 */
import { saveRegister } from "./runs.mjs";
import { saveIsoBom, isoBom } from "./line-list.mjs";
import { syncEquipment } from "./iso-equipment.mjs";
import { syncAllocations } from "./bom-allocation.mjs";
import { ledgerDemands } from "../../register/bom-allocation.mjs";
import { reconcileSheetMarks, registerMarks, recordMarkWarnings, recordEquipmentWeldWarnings } from "./mark-identity.mjs";
import { effectiveItems } from "../../sheet/weld-projection.mjs";
import { weldRowMarks, applyWeldIdentity } from "../../sheet/weld-list-identity.mjs";
import { isUid } from "../../sheet/mark-identity.mjs";

const bad = (msg, code = "INVALID_INPUT") => Object.assign(new Error(msg), { status: 400, code });
const conflict = (msg, code) => Object.assign(new Error(msg), { status: 409, code });
const ACTIVE = ["reserved", "installed"];

/**
 * @param {object} payload  the run's payload
 * @returns {{ mode: "unchanged" } | { mode: "clear" } | { mode: "replace", rows: object[] }}
 */
export function bomState(payload) {
  const b = payload?.bom;
  if (b === undefined || b === null) return { mode: "unchanged" };
  if (!Array.isArray(b)) throw bad("bom must be an array (omit it to leave the saved BOM as it is, [] to clear it)", "BOM_INVALID");
  return b.length ? { mode: "replace", rows: b } : { mode: "clear" };
}

/** Does a list of payload edits (lib/review/payload-diff.mjs) touch what the dependents are made from? */
// (a typed weld list's rows hold what the welds reserve (c1/c2) and how they are named: those fields, and a row coming or going, re-make
// the allocations and links in the correction's transaction)
export const touchesSheetData = (edits) => (edits || []).some((e) => /^(bom|sheetMarkup)(\.|\[|$)/.test(String(e.path || "")) || /^weldList\[\d+\]\.(c1|c2|no|uid)$/.test(String(e.path || "")));

/** The drawing revision of this project: it must exist and be the project's. Locks it, so two saves of one revision are taken in turn. */
export async function lockDocument(db, { projectId, documentId }) {
  const { rows: [d] } = await db.query("SELECT id FROM document WHERE id = $1 AND project_id = $2 FOR UPDATE", [documentId, projectId]);
  if (!d) throw Object.assign(new Error("document not found"), { status: 404 });
}

/**
 * The payload with its marks' (and a typed weld list's rows') persistent identities settled (lib/sheet/mark-identity.mjs): every mark leaves with a uid — the
 * one it carries, the one of the saved mark of this SAME drawing revision it reliably is, or a new one. `previousItems` are the
 * revision's marks as last saved. Returns the payload (untouched if it has no marks) and the report. Refuses (409
 * MARK_IDENTITY_AMBIGUOUS) when an ambiguity would put a mark with something installed on it at risk.
 */
export async function prepareSheetPayload(db, { projectId, documentId, previousItems = [], previousRows = [], payload }) {
  let out = payload;
  const reports = [];
  const items = payload?.sheetMarkup?.items;
  if (Array.isArray(items) && items.length) {
    const { items: settled, report } = await reconcileSheetMarks(db, { projectId, documentId, previousItems, items });
    out = { ...out, sheetMarkup: { ...payload.sheetMarkup, items: settled } };
    reports.push(report);
  }
  // A typed weld list's rows are weld marks with the same kind of identity (docs/audit/phase-4-typed-weld-identity.md): a row keeps the uid
  // it carries (or the previous run's row it reliably is), a new one gets one, an ambiguity is reported — never guessed.
  if (Array.isArray(payload?.weldList) && payload.weldList.length) {
    const { items: settled, report } = await reconcileSheetMarks(db, { projectId, documentId,
      previousItems: weldRowMarks(previousRows), items: weldRowMarks(payload.weldList) });
    out = applyWeldIdentity(out, settled);
    reports.push(report);
  }
  const none = { kept: 0, matched: [], created: [], removed: [], ambiguous: [] };
  return { payload: out, report: reports.reduce((t, r) => ({ kept: t.kept + r.kept, matched: [...t.matched, ...r.matched], created: [...t.created, ...r.created],
    removed: [...t.removed, ...r.removed], ambiguous: [...t.ambiguous, ...r.ambiguous] }), none) };
}

/**
 * Make the revision's BOM, equipment and allocations match the payload.
 * Call inside the caller's transaction. Returns what was done, structurally.
 */
export async function syncSheetData(db, { projectId, documentId, runId = null, lineId = null, payload, userId = null }) {
  await lockDocument(db, { projectId, documentId });
  const state = bomState(payload);
  const items = payload?.sheetMarkup?.items || [];
  // the sheet's marks plus the welds of a typed list, each weld once (lib/sheet/weld-projection.mjs): what allocations and equipment links read
  const { items: effective, projection } = effectiveItems(payload);

  let bomRows = 0;
  if (state.mode !== "unchanged") {
    const { rows: [signed] } = await db.query(
      "SELECT id FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND status = 'approved' LIMIT 1", [projectId, documentId]);
    if (signed) throw conflict("BOM این رویژن همراه رجیستر تأییدشده قفل است؛ برای تغییر آن رویژن جدید نقشه را ثبت کنید.", "BOM_LOCKED");
    if (state.mode === "clear") {
      const { rows: [held] } = await db.query(
        "SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'installed')::int AS installed FROM bom_allocation WHERE project_id = $1 AND document_id = $2 AND status = ANY($3)",
        [projectId, documentId, ACTIVE]);
      if (held.n) {
        throw conflict(`BOM خالی‌شده نمی‌شود: ${held.n} ردیف تخصیص فعال دارد (${held.installed} نصب‌شده). ابتدا تخصیص‌ها را آزاد یا برگردانید، بعد BOM را خالی کنید.`, "BOM_IN_USE");
      }
    }
    bomRows = await saveIsoBom(db, { projectId, documentId, runId, lineId, bom: state.mode === "replace" ? state.rows : [], createdBy: userId });
  }

  // every uid in use is registered to this revision (and refused if it is another's)
  await registerMarks(db, { projectId, documentId, runId, items });

  // the BOM the marks are judged against: the one just written, or the one on file
  const bom = state.mode === "replace" ? state.rows : state.mode === "clear" ? [] : await isoBom(db, { projectId, documentId });
  const equipment = await syncEquipment(db, { projectId, documentId, runId, userId, items: effective, bom });
  await recordEquipmentWeldWarnings(db, { projectId, documentId, runId, unresolved: equipment.unresolved || [] });
  const allocation = await syncAllocations(db, { projectId, documentId, runId, userId, demands: ledgerDemands(effective, bom) });
  return { bom: { mode: state.mode, rows: bomRows }, equipment, allocation, welds: { source: projection.source, count: projection.welds.length, unlinked: projection.unlinked, noIdentity: projection.noIdentity } };
}

/**
 * The register of a run and, unless told otherwise, its dependents.
 *
 * @param {object}  o
 * @param {boolean} [o.replaceRegister]  correction: the run's own welds and spools are removed first (the engine re-derives
 *                                       them; identity comes from `carryFrom`)
 * @param {object}  [o.model]            buildModel result; a failed model leaves no register (and no dependents)
 * @param {boolean} [o.syncDependents]   default true
 */
export async function persistRegister(db, {
  projectId, runId, documentId, lineId = null, model, carryFrom = null, payload, userId = null,
  replaceRegister = false, syncDependents = true,
}) {
  if (replaceRegister) {
    await db.query("DELETE FROM weld WHERE extraction_run_id = $1 AND project_id = $2", [runId, projectId]);
    await db.query("DELETE FROM spool WHERE extraction_run_id = $1 AND project_id = $2", [runId, projectId]);
  }
  if (model?.error) return { saved: null, dependents: null };
  const saved = await saveRegister(db, { projectId, runId, documentId, lineId, model, carryFrom });
  // the typed weld rows' identities are registered to this drawing revision (one registered to another is refused, rolling this back)
  const weldMarks = Array.isArray(payload?.weldList) ? weldRowMarks(payload.weldList).filter((m) => isUid(m.uid)) : [];
  if (weldMarks.length) await registerMarks(db, { projectId, documentId, runId, items: weldMarks });
  const dependents = syncDependents ? await syncSheetData(db, { projectId, documentId, runId, lineId, payload, userId }) : null;
  return { saved, dependents };
}

export { recordMarkWarnings };
