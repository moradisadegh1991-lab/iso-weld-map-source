export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { createRun, getRegister, latestRunForDocument, latestRunForDrawing }
  from "../../../lib/db/repos/runs.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { modelFor } from "../../../lib/register/weld-list.mjs";
import { approvedRunFor } from "../../../lib/db/repos/review.mjs";
import { lineForRegister, tieInRefsOf } from "../../../lib/db/repos/spine.mjs";
import { fillLineList } from "../../../lib/db/repos/line-list.mjs";
import { persistRegister, prepareSheetPayload, lockDocument, recordMarkWarnings } from "../../../lib/db/repos/register-persistence.mjs";
import { assertIsometricDocument, assertPassNameAllowed } from "../../../lib/db/run-scope.mjs";

/**
 * Persist an extraction and the register it produces.
 *
 * The register is recomputed here from the payload rather than accepted from
 * the client. The engine is the only thing allowed to decide where a weld
 * goes, and a browser is not a place to enforce that: a client could post any
 * register it liked. Recomputing costs microseconds and closes the hole.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { projectId, documentId, lineId = null, lineNo, payload: sentPayload, options = {},
            model: modelName = null, modelVersion = null, passName = null,
            inputTokens = null, outputTokens = null, rawOutputUri = null } = body;

    if (!projectId || !documentId || !sentPayload) {
      return Response.json({ error: "projectId, documentId and payload are required" }, { status: 400 });
    }
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.RUN_EXTRACTION);

    const model = modelFor(sentPayload, options);
    // A typed weld list that is not a register is sent back row by row. It is
    // not a model run that failed — nothing was extracted — so no run is kept.
    if (model.problems) return Response.json({ error: model.error, problems: model.problems }, { status: 400 });

    assertPassNameAllowed(passName);        // an isometric run is not filed under the P&ID / SLD pass names
    return await withProject(db, projectId, async () => {
      await assertIsometricDocument(db, { projectId, documentId, allowMissing: true });     // a P&ID / SLD document is not saved as a weld register
      // Everything this save writes — the line, the run, the register with its spools and welds
      // (identity carried from the last revision), the line list, the BOM — is ONE transaction
      // (architecture review, 2026-11-01): half a save is worse than none, since a run with no
      // register, or a register whose BOM was never kept, looks complete. `saveRegister` opens its
      // own transaction on the handle it is given; on the transaction's handle that is a
      // pass-through (lib/db/client.mjs), so nothing nests. The project scope and role set by
      // `withProject` were set before BEGIN and hold inside it.
      const out = await db.transaction(async (tx) => {
        // A signed register is not re-extracted over. Correcting it means a new
        // drawing revision, because that is what the signature was against.
        const signed = await approvedRunFor(tx, { projectId, documentId });
        if (signed) return { signed };

        // One save of a drawing revision at a time (its marks' identities are settled against what was saved last), then the
        // marks of this revision's last run, so a re-read of the sheet keeps the identity of the marks it reliably finds again
        // (lib/sheet/mark-identity.mjs). A new revision is a new document: its marks are new marks.
        await lockDocument(tx, { projectId, documentId });
        // (the last run that BUILT: a failed extraction has no marks to speak of and must not stand for the identities of valid ones)
        const { rows: [lastOfRevision] } = await tx.query(
          `SELECT payload FROM extraction_run WHERE project_id = $1 AND document_id = $2 AND engine_error IS NULL
            ORDER BY created_at DESC, id DESC LIMIT 1`, [projectId, documentId]);
        const { payload, report: markReport } = model.error
          ? { payload: sentPayload, report: null }
          : await prepareSheetPayload(tx, { projectId, documentId, previousItems: lastOfRevision?.payload?.sheetMarkup?.items || [], previousRows: lastOfRevision?.payload?.weldList || [], payload: sentPayload });

        // Look this up BEFORE creating the new run, or the "latest run for this
        // drawing" is the row we are about to insert and nothing is ever carried.
        const docNo = payload?.meta?.drawingNo;
        const sheetNo = payload?.meta?.sheet || "1/1";
        const previous = docNo
          ? await latestRunForDrawing(tx, { projectId, docNo, sheetNo })
          : null;

        // The line this drawing belongs to: without one, its welds are in no
        // test package and no subsystem (lib/db/repos/spine.mjs).
        // A failed model has no register, and a payload that names neither a
        // line nor a drawing has no line to make: the run is still recorded.
        const lineNoOf = payload?.meta?.lineNo || lineNo || docNo;
        const line = lineId || model.error || !lineNoOf ? null : await lineForRegister(tx, { projectId, lineNo: lineNoOf,
          docNo, unitCode: payload?.meta?.unit || null, pipingClass: payload?.meta?.pipingClass || null, tieInRefs: tieInRefsOf(payload) });
        const theLine = lineId || line?.id || null;

        const run = await createRun(tx, {
          projectId, documentId, lineId: theLine,
          modelName, modelVersion, passName, inputTokens, outputTokens, rawOutputUri,
          payload,
          validationChecks: model.error ? [] : model.checks,
          engineError: model.error || null,
          createdBy: user.id,
        });

        // A failed model still gets a run row — the failure is evidence too —
        // but there is no register to save.
        if (model.error) return { run, failed: true };

        // Carry weld identity forward from whatever was last extracted for the
        // SAME DRAWING, across revisions. That is the whole point: a new
        // revision is a new document row, and it is exactly then that the NDT
        // records and ITRs hung off a weld must not be orphaned.
        const carryFrom = previous
          ? await getRegister(tx, { projectId, runId: previous.id })
          : null;

        // the register and everything that hangs off it — BOM, equipment, allocations — in this transaction
        // (lib/db/repos/register-persistence.mjs); `payload.bom` absent leaves the BOM, [] clears it, rows replace it
        await recordMarkWarnings(tx, { projectId, documentId, runId: run.id, report: markReport });
        const { saved, dependents } = await persistRegister(tx, {
          projectId, runId: run.id, documentId, lineId: theLine, model, carryFrom, payload, userId: user.id,
        });
        const register = await getRegister(tx, { projectId, runId: run.id });
        // the line list the sheet prints fills the line's empty values — only on a line named by its own
        // number (a drawing number standing in for it may be a package's, shared by many lines); a value
        // on file that differs is reported, not written over
        const named = payload?.meta?.lineNo || (lineNo && lineNo !== docNo ? lineNo : null);
        const lineList = theLine && named && payload?.lineData
          ? await fillLineList(tx, { projectId, lineId: theLine, lineData: payload.lineData }) : null;
        const bomRows = dependents.bom.rows;
        const equipment = dependents.equipment;
        const allocation = bomRows || dependents.allocation.reserved || dependents.allocation.adjusted || dependents.allocation.released ? dependents.allocation : null;
        return { run, register, saved, lineList, bomRows, allocation, equipment, markReport };
      });

      if (out.signed) {
        return Response.json({
          error: "برای این رویژن سند، رجیستر تأییدشده وجود دارد. " +
            "برای تغییر، رویژن جدید نقشه را ثبت کنید.",
          code: "REVISION_ALREADY_APPROVED",
          approvedRunId: out.signed.id,
          approvedAt: out.signed.approved_at,
        }, { status: 409 });
      }
      if (out.failed) return Response.json({ run: out.run, register: [], engineError: model.error }, { status: 201 });
      return Response.json({
        run: out.run,
        register: out.register,
        ...(out.lineList ? { lineList: out.lineList } : {}),
        bomRows: out.bomRows,
        ...(out.allocation ? { allocation: out.allocation } : {}),
        ...(out.equipment?.equipment || out.equipment?.removed ? { equipment: out.equipment } : {}),
        carriedIdentities: out.saved.carried,
        ...(out.markReport && (out.markReport.matched.length || out.markReport.created.length || out.markReport.removed.length || out.markReport.ambiguous.length)
          ? { markIdentity: { kept: out.markReport.kept, matched: out.markReport.matched.length, created: out.markReport.created.length, removed: out.markReport.removed, ambiguous: out.markReport.ambiguous } } : {}),
        totals: model.totals,
        spools: model.spoolIds,
        checks: model.checks,
      }, { status: 201 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** The latest run for a document, with its register. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const documentId = url.searchParams.get("documentId");
    if (!projectId || !documentId) {
      return Response.json({ error: "projectId and documentId are required" }, { status: 400 });
    }
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      await assertIsometricDocument(db, { projectId, documentId, allowMissing: true });
      const run = await latestRunForDocument(db, { projectId, documentId });
      if (!run) return Response.json({ run: null, register: [] });
      return Response.json({ run, register: await getRegister(db, { projectId, runId: run.id }) });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
