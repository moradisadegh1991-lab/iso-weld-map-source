/**
 * The server side of the validation center (docs/audit/phase-7-engineering-validation.md §3): the SAVED state of one drawing revision seen through
 * the shared engine (lib/engineering/validation.mjs), and the one write the center has — resolving a stored warning after the relationship
 * it was about exists. Read-only otherwise: nothing is repaired, nothing is stored as a result. Fixed queries (no per-finding lookups).
 * Call inside `withProject`.
 */
import { validate } from "../../engineering/validation.mjs";
import { effectiveItems } from "../../sheet/weld-projection.mjs";
import { equipmentWelds, plainNo, KINDS } from "../../sheet/markup.mjs";
import { isUid } from "../../sheet/mark-identity.mjs";
import { payloadHash } from "../../review/payload-hash.mjs";
import { latestRunForDocument } from "./runs.mjs";
import { listEquipment } from "./iso-equipment.mjs";
import { availability } from "./bom-allocation.mjs";
import { markWarnings, resolveMarkWarning } from "./mark-identity.mjs";
import { approvedRunFor } from "./review.mjs";
import { lineageFacts } from "./revision-lifecycle.mjs";
import { assertIsometricDocument } from "../run-scope.mjs";

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

async function revisionOf(db, { projectId, documentId }) {
  const { rows: [d] } = await db.query("SELECT id, doc_no, revision, sheet_no FROM document WHERE id = $1 AND project_id = $2", [documentId, projectId]);
  if (!d) throw fail(404, "NOT_FOUND", "revision not found");
  return { documentId: d.id, docNo: d.doc_no, rev: d.revision, sheet: d.sheet_no };
}

/** @returns {Promise<{ revision, findings, summary, payloadHash, generatedAt }>} */
export async function validationFor(db, { projectId, documentId }) {
  await assertIsometricDocument(db, { projectId, documentId, allowMissing: true });     // not run on a P&ID / SLD payload (409 NOT_AN_ISOMETRIC_DOCUMENT)
  const rev = await revisionOf(db, { projectId, documentId });
  const run = await latestRunForDocument(db, { projectId, documentId });
  if (!run || !run.payload) throw fail(404, "NO_REGISTER", "این رویژن هنوز رجیستر ذخیره‌شده ندارد");
  const [equipment, ledger, warnings, approved] = await Promise.all([
    listEquipment(db, { projectId, documentId }), availability(db, { projectId, documentId }),
    markWarnings(db, { projectId, documentId, open: false }), approvedRunFor(db, { projectId, documentId })]);
  const revision = { ...rev, runId: run.id, status: approved ? "approved" : run.status };
  const saved = { equipment, ledger, warnings, lineage: await lineageFacts(db, { projectId, documentId }) };
  // `saved` rides along so the page can run the same engine on its DRAFT against the server's ledger, equipment and warnings (one request, not four)
  return { revision, ...validate({ payload: run.payload, revision, saved, source: "saved" }), saved, payloadHash: payloadHash(run.payload), generatedAt: new Date().toISOString() };
}

export async function warningsFor(db, { projectId, documentId }) {
  await revisionOf(db, { projectId, documentId });
  await assertIsometricDocument(db, { projectId, documentId });
  return markWarnings(db, { projectId, documentId, open: false });
}

/**
 * Resolve ONE stored warning — only after the relationship it was about is established in the saved register, and with a note.
 *   equipment_weld   the equipment's legacy number no longer names nothing/several welds in the current revision (its stored links are by uid)
 *   identity         nothing in the ledger or the equipment links still points at an identity the reconciliation could not carry over
 * The warning is kept (resolved_at / resolved_by / resolution); resolving never links, unlinks, renumbers or releases anything.
 */
export async function resolveWarning(db, { projectId, documentId, warningId, resolution, userId, baseHash = null }) {
  await revisionOf(db, { projectId, documentId });
  await assertIsometricDocument(db, { projectId, documentId });
  if (await approvedRunFor(db, { projectId, documentId })) throw fail(409, "RUN_LOCKED", "رجیستر این رویژن تأیید شده؛ هشدار آن در همین رویژن بسته نمی‌شود. رویژن جدید ثبت کنید.");
  const run = await latestRunForDocument(db, { projectId, documentId });
  if (!run?.payload) throw fail(404, "NO_REGISTER", "این رویژن هنوز رجیستر ذخیره‌شده ندارد");
  if (baseHash && baseHash !== payloadHash(run.payload)) throw fail(409, "STALE_RUN", "رجیستر از وقتی این فهرست را دیدید عوض شده؛ فهرست را تازه کنید.");
  const all = await markWarnings(db, { projectId, documentId, open: false });
  const w = all.find((x) => String(x.id) === String(warningId));
  if (!w) throw fail(404, "NOT_FOUND", "warning not found");
  if (w.resolved_at) throw fail(409, "ALREADY_RESOLVED", "این هشدار قبلاً بسته شده");
  if (!String(resolution || "").trim()) throw fail(400, "INVALID_INPUT", "resolution is required");
  const d = w.detail || {}, { items } = effectiveItems(run.payload);
  if (d.type === "equipment_weld") {
    const mark = items.find((m) => KINDS[m?.kind]?.cls === "equipment" && ((isUid(m.uid) ? m.uid.toLowerCase() : String(m.id)) === String(d.equipmentRef).toLowerCase() || String(m.id) === String(d.equipmentRef)));
    if (!mark) throw fail(409, "WARNING_NOT_RESOLVABLE", "تجهیز این هشدار دیگر روی برگ نیست؛ هشدار با تغییر در فرم تجهیز یا با رویژن جدید بسته می‌شود.");
    const ew = equipmentWelds(mark, items);
    if (ew.unresolved.some((u) => plainNo(u.no) === plainNo(d.weldNo))) throw fail(409, "WARNING_NOT_RESOLVABLE", `شمارهٔ «${d.weldNo}» هنوز در تجهیز به‌صورت قدیمی آمده و به سرجوش مشخصی وصل نیست؛ سرجوش درست را در فرم تجهیز انتخاب و ذخیره کنید.`);
    if (!ew.joined.length) throw fail(409, "WARNING_NOT_RESOLVABLE", "تجهیز هنوز به هیچ سرجوشی (با شناسه) وصل نیست؛ پیوند را در فرم تجهیز بسازید.");
  } else {
    const gone = new Set((d.previous || []).map((p) => String(p.uid).toLowerCase()));
    if (gone.size) {
      const { rows: held } = await db.query("SELECT 1 FROM bom_allocation WHERE project_id = $1 AND document_id = $2 AND status = ANY($3) AND lower(owner_ref) = ANY($4) LIMIT 1", [projectId, documentId, ["reserved", "installed"], [...gone]]);
      const { rows: linked } = await db.query("SELECT 1 FROM iso_equipment_weld w JOIN iso_equipment e ON e.id = w.equipment_id WHERE w.project_id = $1 AND e.document_id = $2 AND lower(w.weld_ref) = ANY($3) LIMIT 1", [projectId, documentId, [...gone]]);
      if (held.length || linked.length) throw fail(409, "WARNING_NOT_RESOLVABLE", "هنوز تخصیص یا پیوند تجهیزی به شناسهٔ قبلیِ این نشان وصل است؛ ابتدا آن را در دفتر/فرم تجهیز روشن کنید.");
    }
  }
  await resolveMarkWarning(db, { projectId, warningId: w.id, userId, resolution });
  return { resolved: w.id };
}
