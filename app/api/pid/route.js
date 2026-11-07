export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { ingestDraft, getDraft, compareDrafts, listPidDocuments } from "../../../lib/db/repos/pid.mjs";
import { draftFromOcr, sanitizeProposal } from "../../../lib/pid/draft.mjs";
import { registers } from "../../../lib/pid/registers.mjs";

/**
 * P&ID drafts (lib/db/repos/pid.mjs).
 *   GET  ?projectId                              the project's P&ID drawings and the state of their drafts
 *   GET  ?projectId&documentId                  the current draft of a drawing revision: draft, validation (the Validation Center's engine), registers
 *                                               (views), asset-link proposals, review summary
 *   GET  ?projectId&documentId&compareTo=<doc>  comparison of two revisions of one sheet (by explicit mappings; candidates are only proposals)
 *   POST { projectId, documentId, ocr: {page, w, h, items}, bubbles?, meta? }      a deterministic reading (lib/pid/ocr-parse.mjs readers)
 *   POST { projectId, documentId, proposal: {items, edges, meta?}, page: {number,width,height}, reader }   a vision/LLM PROPOSAL — sanitized: it can
 *        only create `extracted` records; edges need evidence; nothing it says is approved
 * Retryable: the same reading of the same document returns the existing draft (no duplicates). Nothing here approves anything.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), documentId = url.searchParams.get("documentId"), compareTo = url.searchParams.get("compareTo");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    // without a document: the project's P&ID drawings and the state of their drafts
    if (!documentId) return await withProject(db, projectId, async () => Response.json({ documents: await listPidDocuments(db, { projectId }) }));
    return await withProject(db, projectId, async () => {
      if (compareTo) return Response.json(await compareDrafts(db, { projectId, fromDocumentId: documentId, toDocumentId: compareTo }));
      const r = await getDraft(db, { projectId, documentId });
      const regs = registers(r.draft, { projectId, documentId, revisionId: documentId, revision: r.document.revision, findings: r.validation.findings, links: r.links, directory: r.directory });
      return Response.json({ ...r, registers: regs });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    if (!b.projectId || !b.documentId) return Response.json({ error: "projectId and documentId are required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId: b.projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.EDIT_EXTRACTION);
    let draft, rejected = [], reader = String(b.reader || "pid").slice(0, 80);
    if (b.ocr) draft = draftFromOcr(b.ocr, b.bubbles || null, { meta: b.meta || {}, reader });
    else if (b.proposal) {
      const page = b.page || { number: 1, width: 0, height: 0 };
      ({ draft, rejected } = sanitizeProposal(b.proposal, { page, meta: b.meta || {}, source: { kind: "vision", reader } }));
    } else return Response.json({ error: "ocr or proposal is required" }, { status: 400 });
    return await withProject(db, b.projectId, async () => {
      const r = await ingestDraft(db, { projectId: b.projectId, documentId: b.documentId, draft, userId: user.id, reader });
      return Response.json({ ...r, items: draft.items.length, edges: draft.edges.length, rejected }, { status: r.created ? 201 : 200 });
    });
  } catch (e) { return errorResponse(e); }
}
