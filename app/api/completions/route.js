export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  mcBoard, packageBoard, upsertPackage, addLines, removeLine, recordTest, acceptTest, signMc, acceptMc,
} from "../../../lib/db/repos/completions.mjs";
import { BLOCKER_FA, MEDIA } from "../../../lib/completions/completions.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const { rows: lines } = await db.query(
        `SELECT l.id, l.line_no, p.pack_no FROM line l
           LEFT JOIN test_package_line tl ON tl.line_id = l.id LEFT JOIN test_package p ON p.id = tl.package_id
          WHERE l.project_id = $1 ORDER BY l.line_no`, [projectId]);
      return Response.json({
        subsystems: await mcBoard(db, { projectId }), packages: await packageBoard(db, { projectId }),
        lines, blockerNames: BLOCKER_FA, media: MEDIA,
      });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, kind === "mc-sign" || kind === "mc-accept" ? ACTIONS.SIGN_MC : ACTIONS.RECORD_COMPLETIONS);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "package") return Response.json({ package: await upsertPackage(db, args) });
      if (kind === "lines-add") return Response.json(await addLines(db, args));
      if (kind === "line-remove") return Response.json(await removeLine(db, args));
      if (kind === "test") return Response.json({ test: await recordTest(db, args) });
      if (kind === "test-accept") return Response.json({ test: await acceptTest(db, args) });
      if (kind === "mc-sign") return Response.json({ mc: await signMc(db, args) });
      if (kind === "mc-accept") return Response.json({ mc: await acceptMc(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
