export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { getStore } from "../../../../lib/storage/index.mjs";
import { designerBoard, designerReply, registerIncoming, crsCsv } from "../../../../lib/db/repos/incoming.mjs";
import { PURPOSES, RETURN_CODES } from "../../../../lib/documents/control.mjs";

/**
 * The designer's side of document control: its documents, its transmittals
 * and the comments returned to it. Held by SUBMIT_DESIGN — a designer has
 * that and nothing else, and a reviewer does not have it.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.SUBMIT_DESIGN);
    return await withProject(db, projectId, async () => {
      const crs = url.searchParams.get("crs");
      if (crs) {
        if (!/^[0-9a-f-]{36}$/i.test(crs)) return Response.json({ error: "not found" }, { status: 404 });
        const f = await crsCsv(db, { projectId, mdrId: crs, releasedOnly: true });
        return new Response(f.csv, { headers: { "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${f.fileName.replace(/[^\w.-]/g, "_")}"` } });
      }
      return Response.json({ ...(await designerBoard(db, { projectId })), purposes: PURPOSES, returnCodes: RETURN_CODES });
    });
  } catch (e) { return errorResponse(e); }
}

/** multipart: submit a transmittal with its files · JSON kind "reply": answer a returned comment. */
export async function POST(request) {
  try {
    const multipart = (request.headers.get("content-type") || "").startsWith("multipart/form-data");
    let body, files = [];
    if (multipart) {
      const form = await request.formData();
      body = JSON.parse(String(form.get("meta") || "{}"));
      body.kind = "submit";
      files = await Promise.all((body.items || []).map(async (_, k) => {
        const f = form.get(`file_${k}`);
        return f && typeof f === "object" && f.size ? { bytes: Buffer.from(await f.arrayBuffer()), name: f.name, type: f.type } : null;
      }));
    } else body = await request.json();
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.SUBMIT_DESIGN);
    const store = kind === "submit" ? await getStore() : null;
    return await withProject(db, projectId, async () => {
      if (kind === "submit") {
        const items = (body.items || []).map((it, k) => ({ ...it, file: files[k] || null }));
        return Response.json({ result: await registerIncoming(db, { ...body, items, projectId, userId: user.id, store }) });
      }
      if (kind === "reply") {
        return Response.json({ result: await designerReply(db, { projectId, commentId: body.commentId, reply: body.reply, userId: user.id }) });
      }
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
