export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { ingestDraft, listDrafts, getDraft, listSldDocuments } from "../../../lib/db/repos/sld.mjs";
import { LIMITS } from "../../../lib/sld/envelope.mjs";

/**
 * SLD drafts — document intake and isolated persistence (Phase 12.2; lib/db/repos/sld.mjs). The payload is an opaque envelope: nothing in it is interpreted.
 *   GET ?projectId                          the project's SLD documents and the state of their latest draft
 *   GET ?projectId&documentId               the drafts of one SLD document (newest first, no payloads)
 *   GET ?projectId&documentId&draft=1[&runId]   one draft with its payload (the given run, else the latest) and its `payloadHash` (the `baseHash` of an edit)
 *   POST { projectId, documentId, draft }   file a draft (retryable: the same `source.hash` returns the existing draft; 201 created / 200 existing)
 * Needs: view the project to read; edit extraction to file. Errors: 400 INVALID_ENVELOPE, 413 PAYLOAD_TOO_LARGE, 409 RUN_LOCKED / NOT_AN_SLD_DOCUMENT.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), documentId = url.searchParams.get("documentId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (!documentId) return Response.json({ documents: await listSldDocuments(db, { projectId }) });
      if (url.searchParams.get("draft")) return Response.json(await getDraft(db, { projectId, documentId, runId: url.searchParams.get("runId") }));
      return Response.json(await listDrafts(db, { projectId, documentId }));
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const raw = await request.text();
    // the size limit is checked BEFORE parsing: an oversized body is never turned into objects
    if (raw.length > LIMITS.bytes * 1.5) return Response.json({ error: "the request body is too large", code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    let b; try { b = JSON.parse(raw); } catch { b = null; }
    if (!b || typeof b !== "object") return Response.json({ error: "a JSON body is required" }, { status: 400 });
    if (!b.projectId || !b.documentId) return Response.json({ error: "projectId and documentId are required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId: b.projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.EDIT_EXTRACTION);
    return await withProject(db, b.projectId, async () => {
      const r = await ingestDraft(db, { projectId: b.projectId, documentId: b.documentId, draft: b.draft, userId: user.id });
      return Response.json(r, { status: r.created ? 201 : 200 });
    });
  } catch (e) { return errorResponse(e); }
}
