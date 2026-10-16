export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { getStore } from "../../../../lib/storage/index.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";

/** The largest drawing set accepted straight into the bucket. */
const MAX_DIRECT_BYTES = 500 * 1024 * 1024;
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf" };

/**
 * POST { projectId, sha256, byteSize, contentType } → where to PUT a drawing
 * too big for a request body, straight into MinIO.
 *
 * The URL is signed for that hash and that size: the bucket refuses any
 * other bytes, so the digest the browser claims is checked before anything
 * is kept. Then POST /api/documents with { fileSha256, uploaded: true }
 * registers it — after asking the bucket what it holds.
 *
 * 409 when this server keeps files on its own disk: there is no bucket to
 * upload to, and the browser falls back to registering the hash alone.
 */
export async function POST(request) {
  try {
    const { projectId, sha256, byteSize, contentType } = await request.json().catch(() => ({}));
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.UPLOAD_DOCUMENT);
    if (!/^[0-9a-f]{64}$/.test(String(sha256 || ""))) return Response.json({ error: "sha256 of 64 hex characters is required" }, { status: 400 });
    if (!EXT[contentType]) return Response.json({ error: "a drawing is JPEG, PNG or PDF" }, { status: 400 });
    if (!(Number.isInteger(byteSize) && byteSize > 0 && byteSize <= MAX_DIRECT_BYTES)) {
      return Response.json({ error: `byteSize must be between 1 and ${MAX_DIRECT_BYTES} bytes` }, { status: 400 });
    }
    const store = await getStore();
    if (store.driver !== "s3") return Response.json({ error: "direct upload needs object storage (MinIO)" }, { status: 409 });
    return Response.json(await store.presignPut({ digest: sha256, ext: EXT[contentType], contentType, size: byteSize }),
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
