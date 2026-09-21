export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { registerDocument, currentRevision, supersedePrevious } from "../../../lib/db/repos/documents.mjs";
import { createLocalStore } from "../../../lib/storage/content-store.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";

const store = createLocalStore({ root: process.env.STORAGE_ROOT || ".storage" });

/**
 * Register an uploaded drawing.
 *
 * The bytes arrive base64 because that is what the client already has after
 * tiling the image in the browser. They are hashed and stored content-first:
 * the same sheet uploaded twice costs one blob and, more to the point,
 * re-extracts nothing.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { projectId, docNo, revision, sheetNo = "1/1", revisionDate = null,
            unitId = null, contentType = "image/jpeg", fileBase64, supersede = true } = body;

    if (!projectId || !docNo || !revision) {
      return Response.json({ error: "projectId, docNo and revision are required" }, { status: 400 });
    }
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.UPLOAD_DOCUMENT);

    // Two paths. With bytes, the server hashes them itself and ignores any
    // digest the client claimed — a hash supplied by the uploader is a
    // statement of intent, not evidence. Without bytes, the sheet was too big
    // for the request body and is registered by hash alone until the
    // presigned upload straight to object storage exists; the storage uri
    // says `pending://` so nothing can mistake it for a stored file.
    let blob;
    if (fileBase64) {
      const bytes = Buffer.from(fileBase64, "base64");
      blob = await store.put(bytes, { ext: extFor(contentType), contentType });
    } else if (/^[0-9a-f]{64}$/.test(String(body.fileSha256 || ""))) {
      blob = {
        digest: body.fileSha256,
        uri: `pending://${body.fileSha256}`,
        size: body.byteSize ?? null,
        deduplicated: false,
        pending: true,
      };
    } else {
      return Response.json(
        { error: "either fileBase64, or a fileSha256 of 64 hex characters, is required" },
        { status: 400 });
    }

    return await withProject(db, projectId, async () => {
      const { document, created } = await registerDocument(db, {
        projectId, unitId, docNo, revision, revisionDate, sheetNo,
        fileSha256: blob.digest, storageUri: blob.uri,
        contentType, byteSize: blob.size, createdBy: user.id,
      });
      // A newer revision retires the ones before it. EPIC-2 builds the
      // register diff on top of this pointer; here it just has to be set.
      const superseded = created && supersede
        ? await supersedePrevious(db, { projectId, documentId: document.id })
        : [];
      return Response.json({ document, created, deduplicated: blob.deduplicated, superseded },
        { status: created ? 201 : 200 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** The revision currently in force for a drawing sheet. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const docNo = url.searchParams.get("docNo");
    const sheetNo = url.searchParams.get("sheetNo") || "1/1";
    if (!projectId || !docNo) {
      return Response.json({ error: "projectId and docNo are required" }, { status: 400 });
    }
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      const document = await currentRevision(db, { projectId, docNo, sheetNo });
      return Response.json({ document });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const extFor = (ct) => ({ "image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf" }[ct] || "");
