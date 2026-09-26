export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { getStore } from "../../../../lib/storage/index.mjs";
import { revisionFile } from "../../../../lib/db/repos/incoming.mjs";

/** The file a document revision was issued as. It never changes: its name is its hash. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const revisionId = url.searchParams.get("revisionId");
    if (!projectId || !revisionId) return Response.json({ error: "projectId and revisionId are required" }, { status: 400 });
    if (!/^[0-9a-f-]{36}$/i.test(revisionId)) return Response.json({ error: "not found" }, { status: 404 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const store = await getStore();
    const f = await withProject(db, projectId, () => revisionFile(db, { projectId, revisionId, store }));
    const safe = f.name.replace(/[^\w.\- ]/g, "_");
    return new Response(f.bytes, { headers: {
      "Content-Type": f.type === "application/pdf" ? "application/pdf" : "application/octet-stream",
      "Content-Length": String(f.bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "ETag": `"${f.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `${f.type === "application/pdf" ? "inline" : "attachment"}; filename="${safe}"`,
    } });
  } catch (e) { return errorResponse(e); }
}
