export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import * as ch from "../../../lib/db/repos/changes.mjs";

/**
 * TQs, site changes and work orders. The designer reads the TQs put to it
 * and the changes waiting for its as-built (?view=designer) without seeing
 * the rest of the project.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    const designer = url.searchParams.get("view") === "designer";
    assertCan(membership, designer ? ACTIONS.SUBMIT_DESIGN : ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const b = await ch.changesBoard(db, { projectId });
      if (designer) {
        return Response.json({
          tqs: b.tqs.map((t) => ({ id: t.id, tq_no: t.tq_no, subject: t.subject, question: t.question, proposal: t.proposal,
            doc_no: t.doc_no, raised_on: t.raised_on, reply_due: t.reply_due, status: t.status, statusFa: t.statusFa,
            answer: t.answer, answered_on: t.answered_on, overdue: t.overdue })),
          changes: b.changes.filter((c) => ["approved", "asbuilt_submitted", "closed"].includes(c.status)).map((c) => ({ id: c.id,
            fcr_no: c.fcr_no, kindFa: c.kindFa, title: c.title, description: c.description, doc_no: c.doc_no, line_no: c.line_no,
            status: c.status, statusFa: c.statusFa, asbuilt_revision: c.asbuilt_revision, asbuilt_on: c.asbuilt_on })),
        });
      }
      const { rows: contracts } = await db.query(
        `SELECT c.id, c.contract_no, c.title, k.code AS contractor FROM contract c LEFT JOIN contractor k ON k.id = c.contractor_id
          WHERE c.project_id = $1 AND c.status = 'signed' ORDER BY c.contract_no`, [projectId]);
      const { rows: accounts } = await db.query("SELECT id, code, title FROM control_account WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: docs } = await db.query("SELECT id, doc_no, title FROM mdr_document WHERE project_id = $1 ORDER BY doc_no", [projectId]);
      const { rows: lines } = await db.query("SELECT id, line_no FROM line WHERE project_id = $1 ORDER BY line_no", [projectId]);
      return Response.json({ ...b, contracts, accounts, docs, lines,
        may: { raise: can(membership, ACTIONS.RECORD_QUALITY), decide: can(membership, ACTIONS.CONTROL_DOCUMENTS),
          prepareWo: can(membership, ACTIONS.PREPARE_STATEMENT), issueWo: can(membership, ACTIONS.MANAGE_CONTRACTS) } });
    });
  } catch (e) { return errorResponse(e); }
}

const NEED = {
  "tq": ACTIONS.RECORD_QUALITY, "tq-answer": ACTIONS.SUBMIT_DESIGN, "tq-close": ACTIONS.CONTROL_DOCUMENTS,
  "change": ACTIONS.RECORD_QUALITY, "change-decide": ACTIONS.CONTROL_DOCUMENTS, "asbuilt": ACTIONS.SUBMIT_DESIGN,
  "change-close": ACTIONS.CONTROL_DOCUMENTS,
  "wo": ACTIONS.PREPARE_STATEMENT, "wo-issue": ACTIONS.MANAGE_CONTRACTS, "wo-complete": ACTIONS.PREPARE_STATEMENT,
};

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    if (!NEED[kind]) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    assertCan(membership, NEED[kind]);
    return await withProject(db, projectId, async () => {
      const a = { ...body, projectId, userId: user.id };
      const run = {
        "tq": () => ch.raiseTq(db, a), "tq-answer": () => ch.answerTq(db, a), "tq-close": () => ch.closeTq(db, a),
        "change": () => ch.raiseSiteChange(db, { ...a, kind: body.changeKind }), "change-decide": () => ch.decideSiteChange(db, a),
        "asbuilt": () => ch.submitAsBuilt(db, a), "change-close": () => ch.closeSiteChange(db, a),
        "wo": () => ch.createWorkOrder(db, a), "wo-issue": () => ch.issueWorkOrder(db, a), "wo-complete": () => ch.completeWorkOrder(db, a),
      }[kind];
      return Response.json({ ok: true, row: await run() });
    });
  } catch (e) { return errorResponse(e); }
}
