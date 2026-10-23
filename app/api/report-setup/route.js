export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import * as forms from "../../../lib/db/repos/forms.mjs";
import * as rp from "../../../lib/db/repos/reports.mjs";
import * as wfs from "../../../lib/db/repos/workflows.mjs";
import { listProjectUsers } from "../../../lib/db/repos/users.mjs";
import { logEvent } from "../../../lib/db/repos/log.mjs";
import { PERMISSIONS } from "../../../lib/reports/workflow.mjs";

/**
 * The workflow of each report type: its stages, their review groups and the
 * members of each with their rights. Set by whoever manages the project's
 * members — the same person who decides who is on the project decides who
 * signs what — and, for a handover form, by the section's supervision that
 * designs it (lib/db/repos/forms.mjs): they decide who signs their own forms.
 */
const forbidden = () => Object.assign(new Error("تنظیم گردش کار با مدیر پروژه است؛ نظارت کارفرمای هر بخش فقط فرم‌های تحویل بخش خود را تنظیم می‌کند."), { status: 403, code: "FORBIDDEN" });
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    const admin = can(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => {
      const users = (await listProjectUsers(db, { projectId }))
        .map((u) => ({ id: u.user_id, name: u.display_name || u.email, email: u.email, party: u.inspection_party, role: u.role, active: u.is_active }));
      const all = await rp.reportTypes(db, { projectId });
      const types = all.filter((t) => admin || (t.form && forms.mayDesign(membership, t.section)));
      if (!admin && !types.length) throw forbidden();
      // the workflow tree: an admin sees it whole; a form's designer, the workflows their forms follow
      const mine = new Set(types.map((t) => t.workflow_id).filter(Boolean));
      const tree = (await wfs.workflowTree(db, { projectId })).filter((w) => admin || mine.has(w.id));
      const workflows = await Promise.all(tree.map(async (w) => ({ ...w,
        stageList: await rp.workflowOf(db, { projectId, workflowId: w.id }), pages: await rp.pagesOf(db, { workflowId: w.id }) })));
      const scope = url.searchParams.get("trees") ? await scopeTrees(db, projectId) : null;
      const contracts = admin ? (await db.query("SELECT id, contract_no, title FROM contract WHERE project_id = $1 ORDER BY contract_no", [projectId])).rows : [];
      return Response.json({ types, users, permissions: PERMISSIONS, workflows, duties: admin ? await wfs.duties(db, { projectId }) : (await wfs.duties(db, { projectId })).map((d) => ({ ...d, members: [] })),
        roles: admin ? await wfs.roles(db, { projectId }) : [], contracts,
        sections: wfs.FORM_PARTS, scope, may: { types: admin, tree: admin, duties: admin } });
    });
  } catch (e) { return errorResponse(e); }
}

/**
 * The tree rows a duty's reach is picked from: every contract's narrative
 * branches, resource categories and resources, and work groups, and the
 * WBS nodes of every master plan — each with its parent, so a pick reaches
 * everything under it.
 */
async function scopeTrees(db, projectId) {
  const { rows: cats } = await db.query(
    `SELECT c.id, c.parent_id, c.tree, c.name, k.contract_no FROM contract_category c JOIN contract k ON k.id = c.contract_id
      WHERE k.project_id = $1 ORDER BY k.contract_no, c.tree, c.name`, [projectId]);
  const { rows: res } = await db.query(
    `SELECT r.id, r.category_id AS parent_id, r.name, k.contract_no FROM contract_resource r JOIN contract k ON k.id = r.contract_id
      WHERE k.project_id = $1 ORDER BY k.contract_no, r.name`, [projectId]);
  const { rows: wbs } = await db.query(
    `SELECT n.id, n.parent_id, n.code, n.name, k.contract_no FROM wbs_node n JOIN eps_pms p ON p.id = n.pms_id
       LEFT JOIN contract k ON k.id = p.contract_id WHERE p.project_id = $1 AND EXISTS (SELECT 1 FROM eps_version v WHERE v.pms_id = p.id AND v.master) ORDER BY n.code`, [projectId]);
  return {
    narrative: cats.filter((c) => c.tree === "narrative").map((c) => ({ id: c.id, parentId: c.parent_id, name: c.name, group: c.contract_no })),
    resource: [...cats.filter((c) => c.tree === "resource").map((c) => ({ id: c.id, parentId: c.parent_id, name: c.name, group: c.contract_no })),
      ...res.map((x) => ({ id: x.id, parentId: x.parent_id, name: x.name, group: x.contract_no, leaf: true }))],
    work_group: cats.filter((c) => c.tree === "work_group").map((c) => ({ id: c.id, parentId: c.parent_id, name: c.name, group: c.contract_no })),
    wbs: wbs.map((n) => ({ id: n.id, parentId: n.parent_id, name: `${n.code} ${n.name}`, group: n.contract_no || "" })),
  };
}

const LABEL = {
  type: (b) => `نوع ${b.code}`, stage: (b) => `مرحلهٔ ${b.seq} «${b.name}»`, group: (b) => `گروه «${b.name}»`,
  template: () => "الگوی گزارش روزانه", approver: () => "تأییدکنندهٔ نهایی و جانشین مرحله", "stage-color": () => "رنگ تغییرات مرحله", member: () => "عضو گروه", "member-remove": () => "حذف عضو", "stage-remove": () => "حذف مرحله", "group-remove": () => "حذف گروه",
  duty: (b) => `وظیفهٔ «${b.name}»`, "duty-remove": () => "حذف وظیفه", "duty-members": () => "دارندگان وظیفه",
  workflow: (b) => `گردش کار «${b.name}»`, "workflow-remove": () => "حذف گره گردش کار", attach: () => "گردش کار فرم",
  page: (b) => `صفحهٔ ${b.pageNo} «${b.name}»`, "page-remove": () => "حذف صفحه",
  "group-duty": () => "وظیفه در گروه", "group-duty-remove": () => "برداشتن وظیفه از گروه",
  role: (b) => `نقش «${b.name}»`, "role-remove": () => "حذف نقش", "duty-member": () => "دارندهٔ وظیفه و دسترسی او", "duty-member-remove": () => "برداشتن دارندهٔ وظیفه",
  "stage-deadline": () => "مهلت مرحله",
};
// what only the project's manager decides: the duties, the tree, and which workflow a form follows
const ADMIN_ONLY = ["type", "template", "duty", "duty-remove", "duty-members", "duty-member", "duty-member-remove", "role", "role-remove", "workflow", "workflow-remove", "attach"];

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    if (!LABEL[kind]) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    const admin = can(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => {
      if (!admin) {
        // a form's designer: only a workflow every form of which is one of a section they design
        if (ADMIN_ONLY.includes(kind)) throw forbidden();
        const ts = await forms.typesOf(db, { projectId, reportTypeId: body.reportTypeId || null, workflowId: body.workflowId || null,
          stageId: body.stageId || null, groupId: body.groupId || null, pageId: kind === "page-remove" ? body.id : null });
        if (!ts.length || !ts.every((t) => t.form && forms.mayDesign(membership, t.section))) throw forbidden();
      }
      const a = { ...body, projectId };
      const row = await {
        type: () => rp.upsertReportType(db, a),
        template: async () => (await rp.applyDailyTemplate(db, a)).type,
        stage: () => rp.upsertStage(db, { ...a, seq: Number(body.seq) }),
        group: () => rp.upsertGroup(db, { ...a, seq: Number(body.seq) }),
        member: () => rp.setGroupMember(db, a),
        "member-remove": () => rp.removeGroupMember(db, a),
        "stage-remove": () => rp.removeStage(db, a),
        "group-remove": () => rp.removeGroup(db, a),
        approver: () => rp.setStageApprover(db, a),
        "stage-color": () => rp.setStageColor(db, a),
        duty: () => wfs.saveDuty(db, a),
        "duty-remove": () => wfs.removeDuty(db, a),
        "duty-members": () => wfs.setDutyMembers(db, a).then(() => null),
        workflow: () => wfs.saveWorkflow(db, a),
        "workflow-remove": () => wfs.removeWorkflow(db, a),
        attach: () => wfs.attachWorkflow(db, a),
        page: () => wfs.savePage(db, a),
        "page-remove": () => wfs.removePage(db, a),
        "group-duty": () => wfs.setGroupDuty(db, a),
        "group-duty-remove": () => wfs.removeGroupDuty(db, a),
        role: () => wfs.saveRole(db, a),
        "role-remove": () => wfs.removeRole(db, a),
        "duty-member": () => wfs.setDutyMember(db, a).then(() => null),
        "duty-member-remove": () => wfs.removeDutyMember(db, a).then(() => null),
        "stage-deadline": () => rp.setStageDeadline(db, a),
      }[kind]();
      // who changed who may sign what is itself on the record
      await logEvent(db, { projectId, section: "reports", entityType: "report_setup", entityId: row?.id || null,
        label: LABEL[kind](body), action: kind.endsWith("remove") ? "cancelled" : "updated",
        comment: ["member", "group-duty", "duty", "duty-member"].includes(kind) ? [(body.permissions || []).map((p) => PERMISSIONS[p] || p).join("، "),
          kind === "duty-member" && body.temporary ? `موقت ${body.startsOn} تا ${body.endsOn}` : ""].filter(Boolean).join(" · ") || null
          : kind === "stage-deadline" ? (body.days ? `${body.days} روز: ${body.text}` : "بی‌مهلت") : null, userId: user.id });
      return Response.json({ ok: true, row: row || null });
    });
  } catch (e) { return errorResponse(e); }
}
