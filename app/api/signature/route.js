export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import * as sg from "../../../lib/db/repos/signatures.mjs";
import { getStore } from "../../../lib/storage/index.mjs";

/**
 * GET ?projectId=&id=     the bytes of one signature image — only when its
 *                         owner is a member of this project.
 * GET ?projectId=&mine=1  the caller's own signature: the one in use and how
 *                         many earlier ones are kept.
 * POST multipart          projectId, kind (drawn | scanned), file: a new
 *                         signature image for the caller.
 *
 * Served with the type read from the bytes when it was kept and never as
 * anything that could run. An image never changes (append-only row, file
 * named by its hash), so the browser may keep it.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    if (url.searchParams.get("mine")) {
      return await withProject(db, projectId, async () => Response.json({
        current: await sg.currentSignature(db, { userId: user.id }),
        history: await sg.signatureHistory(db, { userId: user.id }),
        kinds: sg.SIGNATURE_KIND, maxBytes: sg.MAX_SIGNATURE_BYTES,
      }));
    }
    const id = url.searchParams.get("id");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not found" }, { status: 404 });
    const store = await getStore();
    const f = await withProject(db, projectId, () => sg.readSignature(db, { projectId, signatureId: id, store }));
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

export async function POST(request) {
  try {
    if (!(request.headers.get("content-type") || "").startsWith("multipart/form-data")) {
      return Response.json({ error: "multipart/form-data expected" }, { status: 400 });
    }
    const form = await request.formData();
    const projectId = String(form.get("projectId") || "");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const file = form.get("file");
    const bytes = file && typeof file === "object" && file.size ? Buffer.from(await file.arrayBuffer()) : Buffer.alloc(0);
    const store = await getStore();
    const row = await withProject(db, projectId, () =>
      sg.saveSignature(db, { userId: user.id, bytes, kind: String(form.get("kind") || ""), store }));
    return Response.json({ ok: true, signature: row });
  } catch (e) { return errorResponse(e); }
}
