export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import * as plan from "../../../../lib/db/repos/planning.mjs";
import { assertContractAccess } from "../../../../lib/db/repos/users.mjs";

/**
 * A version's planning rows (lib/db/repos/planning.mjs), reached through the
 * caller's access to the version's contract: reading with any access,
 * changing with «ثبت و ویرایش» or more.
 *
 *   GET ?projectId&versionId          the version's planning rows
 *   GET ?projectId&versionId&activityId   the preview's sub-forms for that activity: requirements, comments, status with holds
 *   POST {kind: plan-add | plan-edit | plan-remove | plan-copy | req | req-remove | req-type | req-type-remove | comment | comment-remove}
 *   POST multipart {kind: plan-import, versionId, file}   a planning sheet into the version
 */
const notFound = () => Object.assign(new Error("not found"), { status: 404 });
const VERSION = "SELECT p.contract_id FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id WHERE v.id = $1 AND v.project_id = $2";
const ROW = "SELECT p.contract_id FROM activity_plan x JOIN eps_version v ON v.id = x.version_id JOIN eps_pms p ON p.id = v.pms_id WHERE x.id = $1 AND x.project_id = $2";
const REQ = "SELECT p.contract_id FROM activity_requirement q JOIN eps_version v ON v.id = q.version_id JOIN eps_pms p ON p.id = v.pms_id WHERE q.id = $1 AND q.project_id = $2";
const COMMENT = REQ.replace("activity_requirement q", "activity_comment q");
const TYPE = "SELECT contract_id FROM requirement_type WHERE id = $1 AND project_id = $2";
const MAX = 20 * 1024 * 1024;

async function contractOf(db, projectId, b) {
  const q = async (sql, id) => (id ? (await db.query(sql, [id, projectId])).rows[0]?.contract_id ?? null : null);
  switch (b.kind) {
    case "plan-add": case "plan-import": return q(VERSION, b.versionId);
    // a row named by id must be of the version named, when both are given (the repository checks the activity is planned in it)
    case "req": case "comment": return b.id ? q(b.kind === "req" ? REQ : COMMENT, b.id) : q(VERSION, b.versionId);
    case "req-remove": return q(REQ, b.id);
    case "comment-remove": return q(COMMENT, b.id);
    case "req-type": return b.id ? q(TYPE, b.id) : b.contractId || null;
    case "req-type-remove": return q(TYPE, b.id);
    case "plan-edit": return q(ROW, b.id);
    case "plan-remove": {
      // every row named must be of one contract
      const ids = Array.isArray(b.ids) ? b.ids : [];
      const { rows } = await db.query(
        "SELECT DISTINCT p.contract_id FROM activity_plan x JOIN eps_version v ON v.id = x.version_id JOIN eps_pms p ON p.id = v.pms_id WHERE x.id = ANY($1) AND x.project_id = $2", [ids, projectId]);
      return rows.length === 1 ? rows[0].contract_id : null;
    }
    case "plan-copy": {
      const a = await q(VERSION, b.fromVersionId), c = await q(VERSION, b.toVersionId);
      return a && a === c ? a : null;
    }
    default: return null;
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), versionId = url.searchParams.get("versionId");
    if (!projectId || !versionId) return Response.json({ error: "projectId and versionId are required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const contractId = await contractOf(db, projectId, { kind: "plan-add", versionId });
      if (!contractId) throw notFound();
      const access = await assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role });
      const activityId = url.searchParams.get("activityId");
      if (activityId) return Response.json({ ...(await plan.previewDetail(db, { projectId, versionId, activityId })), may: { edit: access !== "view" } });
      return Response.json({ ...(await plan.planRows(db, { projectId, versionId })), may: { edit: access !== "view" } });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    let b, file = null;
    if ((request.headers.get("content-type") || "").startsWith("multipart/form-data")) {
      const form = await request.formData();
      b = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
      const f = form.get("file");
      if (f && typeof f === "object" && f.size) {
        if (f.size > MAX) return Response.json({ error: "فایل بزرگ‌تر از ۲۰ مگابایت است." }, { status: 400 });
        file = Buffer.from(await f.arrayBuffer());
      }
    } else b = await request.json().catch(() => ({}));
    const { projectId, kind } = b;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const contractId = await contractOf(db, projectId, b);
      if (!contractId) throw notFound();
      await assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role, need: "edit" });
      const a = { ...b, projectId, contractId, userId: user.id };
      const run = {
        "plan-add": () => plan.addToPlan(db, a),
        "plan-edit": () => plan.savePlanRow(db, a),
        "plan-remove": () => plan.removePlanRows(db, a),
        "plan-copy": () => plan.copyPlan(db, { ...a, replace: b.replace === true || b.replace === "true" }),
        req: () => plan.saveRequirement(db, a),
        "req-remove": () => plan.removeRequirement(db, a),
        "req-type": () => plan.saveRequirementType(db, a),
        "req-type-remove": () => plan.removeRequirementType(db, a),
        comment: () => plan.saveComment(db, a),
        "comment-remove": () => plan.removeComment(db, a),
        "plan-import": () => {
          if (!file) throw Object.assign(new Error("فایل اکسل را انتخاب کنید."), { status: 400 });
          return plan.importPlanSheet(db, { ...a, content: file });
        },
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ ok: true, row: (await run()) ?? null });
    });
  } catch (e) { return errorResponse(e); }
}
