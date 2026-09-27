export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../../lib/authz.mjs";
import {
  incomingBoard, crsCsv, assignReview, finishReview, raiseComment, closeComment, sendReply,
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

// The reviewers' side. Distributing and replying are document control's;
// reviewing and commenting are the engineers'. Submitting a transmittal and
// answering a comment are the designer's, at /api/doc-control/designer.
const REVIEWER = new Set(["finish", "comment", "close-comment"]);

export async function POST(request) {
  try {
    if ((request.headers.get("content-type") || "").startsWith("multipart/form-data")) {
      return Response.json({ error: "ترانسمیتال ورودی را طراح از «پرتال طراح» ارسال می‌کند." }, { status: 403 });
    }
    const body = await request.json();
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, REVIEWER.has(kind) ? ACTIONS.EDIT_EXTRACTION : ACTIONS.CONTROL_DOCUMENTS);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      // A reviewer closes on the designer's own reply; it does not type one.
      if (kind === "close-comment" && !can(membership, ACTIONS.SUBMIT_DESIGN)) delete args.designerReply;
      const run = { assign: assignReview, finish: finishReview, comment: raiseComment, "close-comment": closeComment, reply: sendReply }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ result: await run(db, args) });
    });
  } catch (e) { return errorResponse(e); }
}
