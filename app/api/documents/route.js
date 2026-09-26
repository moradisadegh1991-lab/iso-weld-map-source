export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { unitByCode } from "../../../lib/db/repos/projects.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { registerDocument, currentRevision, supersedePrevious } from "../../../lib/db/repos/documents.mjs";
import { getStore } from "../../../lib/storage/index.mjs";
import { keyFor } from "../../../lib/storage/content-store.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";


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
            unitId: givenUnitId = null, unitCode = null,
            contentType = "image/jpeg", fileBase64, supersede = true } = body;

    if (!projectId || !docNo || !revision) {
      return Response.json({ error: "projectId, docNo and revision are required" }, { status: 400 });
    }
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.UPLOAD_DOCUMENT);

    // Three paths. With bytes, the server hashes them itself and ignores any
    // digest the client claimed — a hash supplied by the uploader is a
    // statement of intent, not evidence. Uploaded straight to the bucket
    // (a sheet too big for the request body, see ./upload-url): the bucket
    // is asked what it holds under that hash — the SHA-256 it checked on
    // the way in — and nothing is registered unless it is there. With
    // neither, it is registered by hash alone; the storage uri says
    // `pending://` so nothing can mistake it for a stored file.
    let blob;
    const claimed = /^[0-9a-f]{64}$/.test(String(body.fileSha256 || "")) ? body.fileSha256 : null;
    if (fileBase64) {
      const bytes = Buffer.from(fileBase64, "base64");
      blob = await (await getStore()).put(bytes, { ext: extFor(contentType), contentType });
    } else if (claimed && body.uploaded) {
      const store = await getStore();
      if (store.driver !== "s3") return Response.json({ error: "direct upload needs object storage (MinIO)" }, { status: 409 });
      const uri = `s3://${store.bucket}/${keyFor(claimed, extFor(contentType))}`;
      const held = await store.stat(uri);
      if (!held) return Response.json({ error: "the file is not in the bucket — upload it first" }, { status: 409 });
      if (held.sha256 !== claimed) return Response.json({ error: "the bucket holds different bytes under that name" }, { status: 409 });
      blob = { digest: claimed, uri, size: held.size, deduplicated: false };
    } else if (claimed) {
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
      // The unit printed in the title block, matched to a DECLARED unit. An
      // unmatched code attaches nothing — the project grade then applies,
      // which is also what the preview used, so the two still agree.
      const unitId = givenUnitId || (await unitByCode(db, { projectId, code: unitCode }))?.id || null;
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
