export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import * as rp from "../../../lib/db/repos/reports.mjs";
import * as forms from "../../../lib/db/repos/forms.mjs";
import { FIELD_TYPES, SOURCES, CLAIM_FIELDS } from "../../../lib/reports/forms.mjs";
import { checkCreate } from "../../../lib/reports/workflow.mjs";
import { AREAS } from "../../../lib/platform/areas.mjs";
import { formAllowed } from "../../../lib/platform/tiles.mjs";
import { narrowed } from "../../../lib/platform/navigation.mjs";

/**
 * Handover forms (lib/db/repos/forms.mjs). Designing a form is its
 * section's employer supervision's (or the project admin's); who makes,
 * signs and approves a form's reports is its workflow's. A member narrowed
 * to tiles reaches a form's reports only with that form's tile.
 *
 *   GET ?projectId                     the forms, and what the caller may design
 *   GET ?projectId&code                one form: its definition and its reports
 *   GET ?projectId&code&work=DATE      the work accepted that day in the form's section
 *   GET ?projectId&id                  one report as the caller may see it
 *   POST {kind: save-type | create | edit | sign | withdraw | approve | return | cancel | send}
 */
const notFound = () => Object.assign(new Error("not found"), { status: 404 });
const membershipOf = (m) => ({ ...m, party: m.inspection_party });

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const q = (k) => url.searchParams.get(k) || null;
    const projectId = q("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const labels = { fieldTypes: FIELD_TYPES, sources: SOURCES, claimFields: CLAIM_FIELDS, sections: AREAS };
      const id = q("id");
      if (id) {
        const v = await forms.formReportView(db, { projectId, reportId: id, userId: user.id });
        if (!formAllowed(membership, v.type.code)) throw notFound();
        return Response.json({ ...v, labels });
      }
      const code = q("code");
      if (code) {
        if (!formAllowed(membership, code) && !(forms.mayDesign(membership, (await forms.formTypeByCode(db, { projectId, code })).section)
          && (!narrowed(membership) || membership.tiles.includes("/forms")))) throw notFound();
        const t = await forms.formTypeByCode(db, { projectId, code });
        if (q("work")) return Response.json({ work: await forms.acceptedWork(db, { projectId, section: t.section, date: q("work") }) });
        const stages = await rp.workflowOf(db, { projectId, reportTypeId: t.id });
        const { rows: users } = await db.query(
          `SELECT u.id, COALESCE(u.display_name, u.email) AS name FROM project_member m JOIN app_user u ON u.id = m.user_id
            WHERE m.project_id = $1 AND u.is_active ORDER BY 2`, [projectId]);
        return Response.json({ type: { id: t.id, code: t.code, name: t.name, description: t.description, section: t.section, form: t.form },
          stages: stages.map((s) => ({ seq: s.seq, name: s.name, groups: s.groups.map((g) => ({ name: g.name, members: g.members.length })) })),
          reports: await rp.listReports(db, { projectId, reportTypeId: t.id, userId: user.id }), users, labels,
          may: { create: checkCreate(stages, user.id).ok, design: forms.mayDesign(membership, t.section) } });
      }
      const all = await forms.formTypes(db, { projectId });
      const sections = forms.designableSections(membership);
      return Response.json({
        // a narrowed member sees the forms of their tiles; a designer, the forms of the sections they design too
        types: all.filter((t) => formAllowed(membership, t.code) || sections.includes(t.section)),
        designable: sections, labels,
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
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      if (kind === "save-type") {
        return Response.json({ ok: true, row: await forms.saveFormType(db, { projectId, id: body.id || null, code: body.code, name: body.name,
          description: body.description, section: body.section, definition: body.definition, membership: membershipOf(membership), userId: user.id }) });
      }
      // a report's form, for the tile check
      let code = body.code;
      if (kind !== "create") {
        const { rows: [r] } = await db.query(
          "SELECT t.code FROM report r JOIN report_type t ON t.id = r.report_type_id WHERE r.id = $1 AND r.project_id = $2 AND t.form IS NOT NULL", [body.reportId, projectId]);
        if (!r) throw notFound();
        code = r.code;
      }
      if (!formAllowed(membership, code)) throw notFound();
      const a = { projectId, userId: user.id, reportId: body.reportId };
      const run = {
        create: () => forms.createFormReport(db, { projectId, code, reportDate: body.reportDate, title: body.title, header: body.header || {},
          rows: body.rows || null, fromWork: !!body.fromWork, userId: user.id }),
        edit: () => forms.editFormReport(db, { ...a, header: body.header || {}, rows: body.rows || [] }),
        sign: () => rp.signReport(db, { ...a, groupId: body.groupId || null, acceptChanges: body.acceptChanges === true }),
        withdraw: () => rp.withdrawSignature(db, { ...a, groupId: body.groupId || null }),
        approve: () => rp.approveStage(db, { ...a, comment: body.comment }),
        return: () => rp.returnReport(db, { ...a, comment: body.comment }),
        cancel: () => rp.cancelReport(db, { ...a, comment: body.comment }),
        send: () => rp.sendReport(db, { ...a, userIds: body.userIds || [], note: body.note }),
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ ok: true, row: (await run()) ?? null });
    });
  } catch (e) { return errorResponse(e); }
}
