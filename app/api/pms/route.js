export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import * as pms from "../../../lib/db/repos/pms.mjs";
import { logEvent } from "../../../lib/db/repos/log.mjs";
import { PROBLEM_FA } from "../../../lib/controls/pms.mjs";

/**
 * Schedule (MS Project XML) and PMS for a project.
 *   GET ?projectId&asOf                     the current schedule, PMS, links, progress and plan curve
 *   POST multipart {kind:"schedule", file}  an MS Project schedule saved as XML
 *   POST multipart {kind:"pms", file, dataDate?, linkWithin?}  a PMS workbook
 *   POST {kind:"data-date"}                 state the date an import did not carry
 *   POST {kind:"link"}                      link (or unlink) an element to a schedule task
 *   POST {kind:"progress"}                  a step's progress after the workbook, dated, with its source
 * Reading is for the project; changing is for whoever manages project controls.
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const asOf = url.searchParams.get("asOf") || null;
    return await withProject(db, projectId, async () => Response.json({
      ...(await pms.pmsView(db, { projectId, asOf })), problemFa: PROBLEM_FA,
      may: { edit: can(membership, ACTIONS.MANAGE_CONTROLS) },
    }));
  } catch (e) { return errorResponse(e); }
}

const MAX = 20 * 1024 * 1024;

export async function POST(request) {
  try {
    const multipart = (request.headers.get("content-type") || "").startsWith("multipart/form-data");
    let body, file = null, fileName = null;
    if (multipart) {
      const form = await request.formData();
      body = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
      const f = form.get("file");
      if (f && typeof f === "object" && f.size) {
        if (f.size > MAX) return Response.json({ error: "فایل بزرگ‌تر از ۲۰ مگابایت است." }, { status: 400 });
        file = Buffer.from(await f.arrayBuffer()); fileName = f.name || "upload";
      }
    } else body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_CONTROLS);
    return await withProject(db, projectId, async () => {
      const log = (label, action, comment = null) => logEvent(db, { projectId, section: "controls", entityType: "pms",
        label, action, comment, userId: user.id });
      if (kind === "schedule" || kind === "pms") {
        if (!file) return Response.json({ error: "فایل را انتخاب کنید." }, { status: 400 });
        if (kind === "schedule") {
          const r = await pms.importSchedule(db, { projectId, userId: user.id, sourceName: fileName, content: file });
          await log(`برنامهٔ زمان‌بندی: ${fileName}`, "imported", `${r.tasks} فعالیت، ${r.links} پیوند`);
          return Response.json({ ok: true, tasks: r.tasks, links: r.links });
        }
        const r = await pms.importPms(db, { projectId, userId: user.id, sourceName: fileName, content: file,
          dataDate: body.dataDate || null, linkWithin: body.linkWithin || null });
        await log(`PMS: ${fileName}`, "imported", `${r.steps} گام، ${r.problems} ناسازگاری، ${r.linked} پیوند`);
        return Response.json({ ok: true, steps: r.steps, problems: r.problems, linked: r.linked, elements: r.elements });
      }
      if (kind === "data-date") {
        await pms.setDataDate(db, { projectId, pmsImportId: body.pmsImportId, dataDate: body.dataDate });
        await log("تاریخ دادهٔ PMS", "recorded", body.dataDate);
        return Response.json({ ok: true });
      }
      if (kind === "link") {
        await pms.linkElement(db, { projectId, seq: body.seq, taskUid: body.taskUid ?? null, userId: user.id });
        await log(`پیوند PMS به برنامه (ردیف ${body.seq})`, "updated", body.taskUid == null ? "برداشته شد" : `فعالیت ${body.taskUid}`);
        return Response.json({ ok: true });
      }
      if (kind === "progress") {
        await pms.recordProgress(db, { projectId, seq: body.seq, asOf: body.asOf, pct: body.pct, source: body.source, userId: user.id });
        await log(`پیشرفت گام PMS (ردیف ${body.seq})`, "recorded", `${body.pct}% تا ${body.asOf} — ${body.source}`);
        return Response.json({ ok: true });
      }
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
