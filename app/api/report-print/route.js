export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import * as pl from "../../../lib/db/repos/print-layout.mjs";
import * as rp from "../../../lib/db/repos/reports.mjs";
import * as forms from "../../../lib/db/repos/forms.mjs";
import { columnTotals } from "../../../lib/reports/forms.mjs";
import { getStore } from "../../../lib/storage/index.mjs";
import { dailyTotals, SOURCE, SHIFT, WEATHER } from "../../../lib/reports/daily.mjs";
import { PAPER, ORIENTATION, FONTS, ALIGN, FOOTER_ELEMENTS, PLACEHOLDERS, DEFAULT_LAYOUT } from "../../../lib/reports/print.mjs";

/**
 * GET ?projectId=&typeCode=DR   a type's layout in use, the project's logos, the choices a layout offers
 * GET ?projectId=&logo=ID       one logo's bytes (served as an image and nothing else)
 * GET ?projectId=&reportId=ID   everything the print page needs: the report as the caller may see it, the layout, the logos
 * POST {kind:"layout"}          save a layout as the next version (members' managers)
 * POST multipart                a logo: projectId, name, file (members' managers)
 */
const CHOICES = { papers: Object.keys(PAPER), orientations: ORIENTATION, fonts: FONTS, align: ALIGN, elements: FOOTER_ELEMENTS,
  placeholders: PLACEHOLDERS, defaults: DEFAULT_LAYOUT };

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const logo = url.searchParams.get("logo");
    if (logo) {
      if (!/^[0-9a-f-]{36}$/i.test(logo)) return Response.json({ error: "not found" }, { status: 404 });
      const store = await getStore();
      const f = await withProject(db, projectId, () => pl.readLogo(db, { projectId, logoId: logo, store }));
      return new Response(f.bytes, { headers: { "Content-Type": f.contentType, "Content-Length": String(f.bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable", "ETag": `"${f.sha256}"`, "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" } });
    }
    return await withProject(db, projectId, async () => {
      const { rows: [proj] } = await db.query("SELECT code, name FROM project WHERE id = $1", [projectId]);
      const reportId = url.searchParams.get("reportId");
      if (reportId) {
        const v = await rp.reportView(db, { projectId, reportId, userId: user.id });
        const lay = await pl.currentLayout(db, { projectId, reportTypeId: v.report.report_type_id });
        // a handover form prints its own table: its definition travels with the report
        const totals = v.content?.schema === "form1" ? columnTotals(v.content.def, v.content.rows || []) : dailyTotals(v.content);
        return Response.json({ ...v, totals, labels: { SOURCE, SHIFT, WEATHER }, project: proj,
          layout: lay.layout, layoutVersion: lay.version });
      }
      const code = url.searchParams.get("typeCode") || "DR";
      const { rows: [type] } = await db.query("SELECT id, code, name, form, section FROM report_type WHERE project_id = $1 AND code = $2", [projectId, code]);
      const { rows: types } = await db.query("SELECT code, name FROM report_type WHERE project_id = $1 AND active ORDER BY form IS NOT NULL, code", [projectId]);
      if (!type) return Response.json({ type: null, types, choices: CHOICES });
      const lay = await pl.currentLayout(db, { projectId, reportTypeId: type.id });
      const { rows: [last] } = await db.query(
        "SELECT id FROM report WHERE project_id = $1 AND report_type_id = $2 AND status <> 'cancelled' ORDER BY report_date DESC LIMIT 1", [projectId, type.id]);
      return Response.json({ type, layout: lay.layout, version: lay.version, savedAt: lay.savedAt, logos: await pl.listLogos(db, { projectId }),
        sampleReportId: last?.id || null, project: proj, choices: CHOICES, types,
        may: { edit: can(membership, ACTIONS.MANAGE_MEMBERS) || (!!type.form && forms.mayDesign(membership, type.section)) } });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const multipart = (request.headers.get("content-type") || "").startsWith("multipart/form-data");
    let body, file = null;
    if (multipart) {
      const form = await request.formData();
      body = { projectId: String(form.get("projectId") || ""), kind: "logo", name: String(form.get("name") || "") };
      const f = form.get("file");
      file = f && typeof f === "object" && f.size ? Buffer.from(await f.arrayBuffer()) : Buffer.alloc(0);
    } else body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    if (kind !== "layout") assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    const store = kind === "logo" ? await getStore() : null;
    return await withProject(db, projectId, async () => {
      if (kind === "layout" && !can(membership, ACTIONS.MANAGE_MEMBERS)) {
        // a form's designer lays out their own form's print
        const t = await forms.typeOf(db, { projectId, reportTypeId: body.reportTypeId });
        if (!t?.form || !forms.mayDesign(membership, t.section)) assertCan(membership, ACTIONS.MANAGE_MEMBERS);
      }
      if (kind === "logo") return Response.json({ ok: true, logo: await pl.saveLogo(db, { projectId, name: body.name, bytes: file, store, userId: user.id }) });
      if (kind === "layout") return Response.json({ ok: true, ...(await pl.saveLayout(db, { projectId, reportTypeId: body.reportTypeId, layout: body.layout, userId: user.id })) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
