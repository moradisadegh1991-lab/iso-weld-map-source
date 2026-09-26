export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { getStore } from "../../../../lib/storage/index.mjs";
import {
  incomingBoard, crsCsv, registerIncoming, assignReview, finishReview, raiseComment, closeComment, sendReply,
} from "../../../../lib/db/repos/incoming.mjs";
import { PURPOSES, RETURN_CODES } from "../../../../lib/documents/control.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const crs = url.searchParams.get("crs");
      if (crs) {
        const f = await crsCsv(db, { projectId, mdrId: crs });
        return new Response(f.csv, { headers: { "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${f.fileName.replace(/[^\w.-]/g, "_")}"` } });
      }
      return Response.json({ ...(await incomingBoard(db, { projectId })), purposes: PURPOSES, returnCodes: RETURN_CODES });
    });
  } catch (e) { return errorResponse(e); }
}

// Registering, distributing and replying are document control's; reviewing and commenting are the engineers'.
const REVIEWER = new Set(["finish", "comment", "close-comment"]);

export async function POST(request) {
  try {
    const multipart = (request.headers.get("content-type") || "").startsWith("multipart/form-data");
    let body, files = [];
    if (multipart) {
      const form = await request.formData();
      body = JSON.parse(String(form.get("meta") || "{}"));
      body.kind = "register";
      files = await Promise.all((body.items || []).map(async (_, k) => {
        const f = form.get(`file_${k}`);
        return f && typeof f === "object" && f.size ? { bytes: Buffer.from(await f.arrayBuffer()), name: f.name, type: f.type } : null;
      }));
    } else body = await request.json();
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, REVIEWER.has(kind) ? ACTIONS.EDIT_EXTRACTION : ACTIONS.CONTROL_DOCUMENTS);
    const store = kind === "register" ? await getStore() : null;
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "register") {
        args.items = (body.items || []).map((it, k) => ({ ...it, file: files[k] || null }));
        return Response.json({ result: await registerIncoming(db, { ...args, store }) });
      }
      const run = { assign: assignReview, finish: finishReview, comment: raiseComment, "close-comment": closeComment, reply: sendReply }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ result: await run(db, args) });
    });
  } catch (e) { return errorResponse(e); }
}
