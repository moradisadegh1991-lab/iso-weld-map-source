export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { readPhoto } from "../../../../lib/db/repos/punch-photos.mjs";
import { createLocalStore } from "../../../../lib/storage/content-store.mjs";

/**
 * GET ?projectId=&id=   the bytes of one punch photo.
 *
 * Served with the type read from the bytes when the photo was kept, never
 * sniffed again by the browser, and never as anything that could run. A
 * photo never changes (its row is append-only and its file is named by its
 * hash), so the browser may keep it for good.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const photoId = url.searchParams.get("id");
    if (!projectId || !photoId) return Response.json({ error: "projectId and id are required" }, { status: 400 });
    if (!/^[0-9a-f-]{36}$/i.test(photoId)) return Response.json({ error: "not found" }, { status: 404 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const store = createLocalStore({ root: process.env.STORAGE_ROOT || ".storage" });
    const f = await withProject(db, projectId, () => readPhoto(db, { projectId, photoId, store }));
    return new Response(f.bytes, { headers: {
      "Content-Type": f.contentType,
      "Content-Length": String(f.bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "ETag": `"${f.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    } });
  } catch (e) { return errorResponse(e); }
}
