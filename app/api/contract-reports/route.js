export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { getStore } from "../../../lib/storage/index.mjs";
import * as rp from "../../../lib/db/repos/reports.mjs";
import * as cr from "../../../lib/db/repos/contract-reports.mjs";
import { checkCreate } from "../../../lib/reports/workflow.mjs";
import { DAY_STATUS, WEATHER, SECTIONS } from "../../../lib/reports/contract-daily.mjs";
import { KIND } from "../../../lib/reports/catalog.mjs";
import { assertContractAccess } from "../../../lib/db/repos/users.mjs";

/** The contract a report (or a report's file) belongs to, for the access check. */
async function contractOfReport(db, projectId, { reportId = null, fileId = null }) {
  const { rows: [r] } = fileId
    ? await db.query("SELECT r.contract_id FROM report_file f JOIN report r ON r.id = f.report_id WHERE f.id = $1 AND f.project_id = $2", [fileId, projectId])
    : await db.query("SELECT contract_id FROM report WHERE id = $1 AND project_id = $2", [reportId, projectId]);
  if (!r?.contract_id) throw Object.assign(new Error("not found"), { status: 404 });
  return r.contract_id;
}

/**
 * The contract's daily report (lib/db/repos/contract-reports.mjs). The caller
 * reaches a contract's reports only through their access to the contract
 * (a project contracts role, or an assignment to it): «مشاهده» reads, signs
 * and decides as the workflow allows; writing content needs «ثبت و ویرایش».
 * Within that, who may do what is the report workflow's to say
 * (lib/reports/workflow.mjs).
 *
 *   GET ?projectId                          contracts, report types
 *   GET ?projectId&contractId               the contract's reports, whether the caller may start one
 *   GET ?projectId&id                       one report, as the caller may see it
 *   GET ?projectId&summary=1&contractId&from&to&kind&categoryId&name   resources over a period
 *   GET ?projectId&file=ID                  a photo or file of a report the caller may read
 *   POST {kind: create|edit|sign|withdraw|approve|return|cancel|send|file-remove}
 *   POST multipart {projectId, reportId, kind: photo|file, name, caption, tags, file}
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const q = (k) => url.searchParams.get(k) || null;
    const file = q("file");
    if (file) {
      if (!/^[0-9a-f-]{36}$/i.test(file)) return Response.json({ error: "not found" }, { status: 404 });
      const f = await withProject(db, projectId, async () => {
        await assertContractAccess(db, { projectId, contractId: await contractOfReport(db, projectId, { fileId: file }), userId: user.id, role: membership.role });
        return cr.readReportFile(db, { projectId, fileId: file, userId: user.id, store: await getStore() });
      });
      const image = /^image\//.test(f.contentType);
      return new Response(f.bytes, { headers: { "Content-Type": image ? f.contentType : "application/octet-stream", "Content-Length": String(f.bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}` } });
    }
    return await withProject(db, projectId, async () => {
      const labels = { dayStatus: DAY_STATUS, weather: WEATHER, sections: Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, v.title])), kinds: KIND };
      const id = q("id");
      if (id) {
        const access = await assertContractAccess(db, { projectId, contractId: await contractOfReport(db, projectId, { reportId: id }), userId: user.id, role: membership.role });
        const view = await cr.contractReportView(db, { projectId, reportId: id, userId: user.id });
        if (access === "view") view.may = { ...view.may, edit: false, upload: false, editWhy: "دسترسی شما در این قرارداد «مشاهده» است." };
        return Response.json({ ...view, labels });
      }
      const contractId = q("contractId");
      const access = contractId ? await assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role }) : null;
      if (q("summary") && contractId) {
        return Response.json(await cr.resourceSummaryRange(db, { projectId, contractId, from: q("from"), to: q("to"), kind: q("kind"), categoryId: q("categoryId"), name: q("name") }));
      }
      const { rows: contracts } = await db.query("SELECT id, contract_no, title FROM contract WHERE project_id = $1 ORDER BY contract_no", [projectId]);
      const { rows: [type] } = await db.query("SELECT id FROM report_type WHERE project_id = $1 AND code = 'CR'", [projectId]);
      const stages = type ? await rp.workflowOf(db, { projectId, reportTypeId: type.id }) : [];
      const { rows: users } = await db.query(
        `SELECT u.id, COALESCE(u.display_name, u.email) AS name FROM project_member m JOIN app_user u ON u.id = m.user_id
          WHERE m.project_id = $1 AND u.is_active ORDER BY 2`, [projectId]);
      return Response.json({ contracts, typeReady: !!type && stages.length > 0, users, labels,
        reports: contractId ? await cr.listContractReports(db, { projectId, contractId, userId: user.id }) : [],
        may: { create: type && access && access !== "view" ? checkCreate(stages, user.id).ok : false, setup: membership.role === "admin" || membership.role === "developer" } });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const multipart = (request.headers.get("content-type") || "").startsWith("multipart/form-data");
    let body, bytes = null;
    if (multipart) {
      const form = await request.formData();
      body = Object.fromEntries(["projectId", "reportId", "kind", "name", "caption", "tags"].map((k) => [k, String(form.get(k) || "")]));
      const f = form.get("file");
      bytes = f && typeof f === "object" && f.size ? Buffer.from(await f.arrayBuffer()) : Buffer.alloc(0);
      body.contentType = f && typeof f === "object" ? f.type : null;
      body.fileKind = body.kind; body.kind = "upload";
      if (!body.name && f && typeof f === "object") body.name = f.name;
    } else body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const store = kind === "upload" ? await getStore() : null;
    return await withProject(db, projectId, async () => {
      if (kind !== "setup-type") {
        const contractId = kind === "create" ? body.contractId
          : await contractOfReport(db, projectId, kind === "file-remove" ? { fileId: body.fileId } : { reportId: body.reportId });
        const writes = ["create", "edit", "upload", "file-remove"].includes(kind);
        await assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role, need: writes ? "edit" : "view" });
      }
      const a = { projectId, userId: user.id, reportId: body.reportId };
      const run = {
        "setup-type": async () => { if (!["admin", "developer"].includes(membership.role)) throw Object.assign(new Error("تنظیم گردش کار با مدیر پروژه است."), { status: 403 }); return cr.ensureType(db, { projectId }); },
        create: () => cr.createContractReport(db, { ...a, contractId: body.contractId, reportDate: body.reportDate, title: body.title, header: body.header || {}, copyFromId: body.copyFromId || null }),
        edit: () => cr.editContractReport(db, { ...a, content: body.content }),
        sign: () => rp.signReport(db, { ...a, groupId: body.groupId || null }),
        withdraw: () => rp.withdrawSignature(db, { ...a, groupId: body.groupId || null }),
        approve: () => rp.approveStage(db, { ...a, comment: body.comment }),
        return: () => rp.returnReport(db, { ...a, comment: body.comment }),
        cancel: () => rp.cancelReport(db, { ...a, comment: body.comment }),
        send: () => rp.sendReport(db, { ...a, userIds: body.userIds || [], note: body.note }),
        upload: () => cr.addReportFile(db, { ...a, kind: body.fileKind, name: body.name, caption: body.caption, tags: body.tags, bytes, contentType: body.contentType, store }),
        "file-remove": () => cr.removeReportFile(db, { projectId, fileId: body.fileId, userId: user.id }),
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ ok: true, row: (await run()) ?? null });
    });
  } catch (e) { return errorResponse(e); }
}
