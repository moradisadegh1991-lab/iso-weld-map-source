export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import { getStore } from "../../../lib/storage/index.mjs";
import * as intake from "../../../lib/db/repos/intake.mjs";
import { logEvent } from "../../../lib/db/repos/log.mjs";
import { ocrActive } from "../../../lib/intake/ocr-queue.mjs";
import { startOcr } from "../../../lib/intake/ocr-start.mjs";

/**
 * Reading received documents into the registers (lib/db/repos/intake.mjs).
 *   GET                          approved revisions, their latest reading and its proposal; the numbering patterns
 *   POST {kind:"read"}           read (again) one approved revision
 *   POST {kind:"decide"}         apply or reject proposal items (a conflict or a rejection needs a reason)
 *   POST {kind:"ocr"}            queue a scanned revision for OCR (read in the background, one at a time)
 *   POST {kind:"line-format"}    the line-number format from the legend · {kind:"codes"} add fluid/insulation codes · {kind:"code-remove"}
 *   POST {kind:"learn"}          learn numbering shapes from the registers
 *   POST {kind:"pattern"}        add a shape by example · {kind:"pattern-active"} switch one on/off
 * Everyone on the project reads; document control changes.
 */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json({
      ...(await intake.intakeBoard(db, { projectId, ocrActive: ocrActive() })), may: { edit: can(membership, ACTIONS.CONTROL_DOCUMENTS) } }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.CONTROL_DOCUMENTS);
    return await withProject(db, projectId, async () => {
      const log = (label, action, comment = null) => logEvent(db, { projectId, section: "documents", entityType: "doc_intake", label, action, comment, userId: user.id });
      if (kind === "read") {
        const r = await intake.readRevision(db, { projectId, revisionId: body.revisionId, store: await getStore(), userId: user.id });
        await log("خواندن مدرک", "recorded", `${r.run.status} · ${r.items.length} ردیف`);
        return Response.json({ ok: true, status: r.run.status, items: r.items.length });
      }
      if (kind === "decide") {
        const r = await intake.decide(db, { projectId, itemIds: body.itemIds || [], decision: body.decision, reason: body.reason, userId: user.id });
        await log("تغییرات خوانده‌شده از مدرک", body.decision === "applied" ? "approved" : "returned", `${r.done} ردیف${body.reason ? ` — ${body.reason}` : ""}`);
        return Response.json({ ok: true, ...r });
      }
      if (kind === "ocr") {
        await startOcr(db, { projectId, revisionId: body.revisionId, userId: user.id });
        return Response.json({ ok: true, queued: true });
      }
      if (kind === "line-format") return Response.json({ ok: true, format: await intake.setLineFormat(db, { projectId, format: body.format, example: body.example, source: body.source, userId: user.id }) });
      if (kind === "codes") return Response.json({ ok: true, added: await intake.addLegendCodes(db, { projectId, kind: body.codeKind, text: body.text, source: body.source, userId: user.id }) });
      if (kind === "code-remove") { await intake.removeLegendCode(db, { projectId, id: body.id }); return Response.json({ ok: true }); }
      if (kind === "learn") return Response.json({ ok: true, added: await intake.learnPatterns(db, { projectId }) });
      if (kind === "pattern") return Response.json({ ok: true, pattern: await intake.addPattern(db, { projectId, kind: body.patternKind, example: body.example, userId: user.id }) });
      if (kind === "pattern-active") return Response.json({ ok: true, pattern: await intake.setPatternActive(db, { projectId, id: body.id, active: body.active }) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
