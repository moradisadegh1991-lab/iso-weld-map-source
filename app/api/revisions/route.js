export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { lineageOf, compareRevisions, createRevision, linkRevision } from "../../../lib/db/repos/revision-lifecycle.mjs";
import { getStore } from "../../../lib/storage/index.mjs";

/**
 * A drawing sheet's revisions (docs/audit/phase-8-revision-lifecycle.md):
 *   GET   ?projectId&documentId                         the chain (oldest first) with status, approval, source, change note
 *   GET   ?projectId&documentId&compareTo=<documentId>  the comparison of the source (documentId) with the target (compareTo), read-only
 *   POST  { projectId, action: "create", sourceDocumentId, revision, changeNote?, noFile|fileBase64 }   a new revision made from a source
 *   POST  { projectId, action: "link", documentId, parentDocumentId, changeNote? }                      link an existing revision to its source
 * Nothing here writes to the source revision.
 */
async function scope(request, projectId, action) {
  const { db, user, membership } = await authenticate(request, { projectId });
  if (!membership) throw Object.assign(new Error("not found"), { status: 404 });
  assertCan(membership, action);
  return { db, user };
}
const extFor = (ct) => ({ "image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf" }[ct] || "");

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), documentId = url.searchParams.get("documentId"), compareTo = url.searchParams.get("compareTo");
    if (!projectId || !documentId) return Response.json({ error: "projectId and documentId are required" }, { status: 400 });
    const { db } = await scope(request, projectId, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json(compareTo
      ? await compareRevisions(db, { projectId, fromDocumentId: documentId, toDocumentId: compareTo })
      : await lineageOf(db, { projectId, documentId })));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, action } = body;
    if (!projectId || !["create", "link"].includes(action)) return Response.json({ error: "projectId and action (create|link) are required" }, { status: 400 });
    const { db, user } = await scope(request, projectId, ACTIONS.UPLOAD_DOCUMENT);
    if (action === "link") {
      if (!body.documentId || !body.parentDocumentId) return Response.json({ error: "documentId and parentDocumentId are required" }, { status: 400 });
      return await withProject(db, projectId, async () => db.transaction(async (tx) => Response.json(await linkRevision(tx, { projectId, documentId: body.documentId, parentDocumentId: body.parentDocumentId, changeNote: body.changeNote }))));
    }
    if (!body.sourceDocumentId || !body.revision) return Response.json({ error: "sourceDocumentId and revision are required" }, { status: 400 });
    let blob = null;
    if (body.fileBase64) {
      const contentType = body.contentType || "image/jpeg";
      const put = await (await getStore()).put(Buffer.from(body.fileBase64, "base64"), { ext: extFor(contentType), contentType });
      blob = { digest: put.digest, uri: put.uri, size: put.size, contentType };
    } else if (body.noFile !== true) return Response.json({ error: "فایل نقشه همراه نیست: فایل را بارگذاری کنید یا صریحاً «بدون فایل» (noFile) ثبت کنید." }, { status: 400 });
    return await withProject(db, projectId, async () => db.transaction(async (tx) => {
      const out = await createRevision(tx, { projectId, sourceDocumentId: body.sourceDocumentId, revision: body.revision, changeNote: body.changeNote, blob, userId: user.id, revisionDate: body.revisionDate || null });
      return Response.json(out, { status: out.created ? 201 : 200 });
    }));
  } catch (e) { return errorResponse(e); }
}
