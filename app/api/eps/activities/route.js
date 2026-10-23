export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import * as act from "../../../../lib/db/repos/eps-activities.mjs";
import * as scope from "../../../../lib/db/repos/eps-scope.mjs";
import { DISCIPLINES, MEASURES, MODES } from "../../../../lib/eps/scope.mjs";
import { assertContractAccess } from "../../../../lib/db/repos/users.mjs";
import { REL_TYPES, BUDGET_UNITS, ROLE_STATUS, QTY_MODES } from "../../../../lib/eps/activities.mjs";
import { fromDailySheet } from "../../../../lib/eps/daily-sheet.mjs";
import * as XLSX from "xlsx";

/**
 * The activity view (P6-like) and the daily progress entry
 * (lib/db/repos/eps-activities.mjs). Everything is reached through the
 * caller's access to the contract the record belongs to: reading with any
 * access, changing with «ثبت و ویرایش» or more. Progress lines are written
 * into the contract's daily report, so the report's workflow decides on top
 * of that whether the caller may write to that report now.
 *
 *   GET ?projectId&(pmsId|versionId)         the PMS's WBS (as the version plans it) with activities, done, progress, codes, relations
 *   GET ?projectId&activityId[&versionId]    one activity's detail sub-forms (as the version plans it; else the master plan)
 *   GET ?projectId&contractId&codes=1        the contract's activity codes
 *   GET ?projectId&contractId&day=YYYY-MM-DD the contract's daily reports of that day, and whether the caller may write to each
 *   GET ?projectId&versionId&days=d1,d2      the chosen days as columns
 *   GET ?projectId&versionId&lines=1         the version's progress lines (activity-code summary)
 *   GET ?projectId&versionId&unplanned=1     the platform's items no scope rule of the version takes in
 *   (reading a version with «ثبت و ویرایش» first applies the scope rules that apply themselves — the
 *    drawings, P&IDs and registers added or withdrawn since reach the PMS here)
 *   POST {kind: relation | relation-remove | code | code-remove | code-assign | role | role-remove |
 *         delay | delay-remove | progress-add | progress-edit | scope-rule | scope-rule-remove | scope-apply}
 *        progress-edit may name another activity (activityId) or move the line to another report (toReportId)
 *   POST multipart {kind: progress-import, contractId, file}   a daily work sheet into the contract's reports
 */
const LABELS = { relTypes: REL_TYPES, budgetUnits: BUDGET_UNITS, roleStatus: ROLE_STATUS, qtyModes: QTY_MODES, scope: { disciplines: DISCIPLINES, measures: MEASURES, modes: MODES } };
const notFound = () => Object.assign(new Error("not found"), { status: 404 });

const VERSION = "SELECT p.contract_id FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id WHERE v.id = $1 AND v.project_id = $2";
const PMS = "SELECT contract_id FROM eps_pms WHERE id = $1 AND project_id = $2";
const ACTIVITY = `SELECT p.contract_id FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id JOIN eps_pms p ON p.id = n.pms_id
                   WHERE a.id = $1 AND a.project_id = $2`;
const REL = `SELECT p.contract_id FROM activity_relation r JOIN wbs_activity a ON a.id = r.pred_id JOIN wbs_node n ON n.id = a.node_id
              JOIN eps_pms p ON p.id = n.pms_id WHERE r.id = $1 AND r.project_id = $2`;
const CODE = "SELECT contract_id FROM activity_code WHERE id = $1 AND project_id = $2";
const ROLE = `SELECT p.contract_id FROM activity_role r JOIN wbs_activity a ON a.id = r.activity_id JOIN wbs_node n ON n.id = a.node_id
               JOIN eps_pms p ON p.id = n.pms_id WHERE r.id = $1 AND r.project_id = $2`;
const DELAY = ROLE.replace("activity_role", "activity_delay");
const REPORT = "SELECT contract_id FROM report WHERE id = $1 AND project_id = $2";
const NODE = "SELECT p.contract_id FROM wbs_node n JOIN eps_pms p ON p.id = n.pms_id WHERE n.id = $1 AND n.project_id = $2";
const RULE = "SELECT p.contract_id FROM scope_rule r JOIN eps_pms p ON p.id = r.pms_id WHERE r.id = $1 AND r.project_id = $2";

/** The contract a request's record belongs to, read from the record itself. */
async function contractOf(db, projectId, b) {
  const q = async (sql, id) => (id ? (await db.query(sql, [id, projectId])).rows[0]?.contract_id ?? null : null);
  switch (b.kind) {
    case "relation": return b.id ? q(REL, b.id) : q(ACTIVITY, b.predId);
    case "relation-remove": return q(REL, b.id);
    case "code": return b.id ? q(CODE, b.id) : b.contractId || null;
    case "code-remove": case "code-assign": return q(CODE, b.id || b.codeId);
    case "role": case "delay": return q(ACTIVITY, b.activityId);
    case "role-remove": return q(ROLE, b.id);
    case "delay-remove": return q(DELAY, b.id);
    case "progress-add": case "progress-edit": return q(REPORT, b.reportId);
    case "progress-import": return b.contractId || null;
    case "scope-rule": return b.id ? q(RULE, b.id) : b.nodeId ? q(NODE, b.nodeId) : q(ACTIVITY, b.activityId);
    case "scope-rule-remove": return q(RULE, b.id);
    case "scope-apply": return q(RULE, b.ruleId);
    default: return null;
  }
}

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
      const access = async (contractId) => {
        if (!contractId) throw notFound();
        return assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role });
      };
      const one = async (sql, id) => (await db.query(sql, [id, projectId])).rows[0]?.contract_id ?? null;
      const versionId = q("versionId"), pmsId = q("pmsId"), activityId = q("activityId"), contractId = q("contractId");
      if (activityId) {
        const a = await access(await one(ACTIVITY, activityId));
        return Response.json({ ...(await act.activityDetail(db, { projectId, activityId, versionId, userId: user.id })), labels: LABELS, may: { edit: a !== "view" } });
      }
      if (versionId || pmsId) {
        const a = await access(versionId ? await one(VERSION, versionId) : await one(PMS, pmsId));
        const at = { projectId, pmsId, versionId };
        if (q("lines")) return Response.json({ lines: await act.versionLines(db, at) });
        if (q("unplanned")) return Response.json({ unplanned: await scope.unplanned(db, at), labels: LABELS });
        const autoApplied = a !== "view" ? (await scope.autoApply(db, { ...at, userId: user.id })).filter((x) => x.error || x.added || x.removed || x.changed || x.made || x.dropped) : [];
        if (q("days") !== null || url.searchParams.has("days")) {
          const days = String(q("days") || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 62);
          return Response.json({ ...(await act.daysView(db, { ...at, days })), labels: LABELS, may: { edit: a !== "view" } });
        }
        return Response.json({ ...(await act.activityView(db, at)), autoApplied, labels: LABELS, may: { edit: a !== "view" } });
      }
      if (contractId) {
        const a = await access(contractId);
        if (q("day")) return Response.json({ reports: await act.reportsOn(db, { projectId, contractId, day: q("day"), userId: user.id }) });
        return Response.json({ codes: await act.codesOf(db, { projectId, contractId }), may: { edit: a !== "view" } });
      }
      return Response.json({ error: "versionId, activityId or contractId is required" }, { status: 400 });
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
        if (f.size > 20 * 1024 * 1024) return Response.json({ error: "فایل بزرگ‌تر از ۲۰ مگابایت است." }, { status: 400 });
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
        relation: () => act.saveRelation(db, a),
        "relation-remove": () => act.removeRelation(db, a),
        code: () => act.saveCode(db, a),
        "code-remove": () => act.removeCode(db, a),
        "code-assign": () => act.assignCode(db, { ...a, codeId: b.codeId || b.id }),
        role: () => act.saveRole(db, a),
        "role-remove": () => act.removeRole(db, a),
        delay: () => act.saveDelay(db, a),
        "delay-remove": () => act.removeDelay(db, a),
        "progress-add": () => act.addProgress(db, a),
        "progress-edit": async () => {
          // a line moved to another report: that report's contract must be the caller's too (the repository checks it is the same contract)
          if (b.toReportId) await assertContractAccess(db, { projectId, contractId: await contractOf(db, projectId, { kind: "progress-add", reportId: b.toReportId }) ?? "", userId: user.id, role: membership.role, need: "edit" });
          return act.editProgress(db, a);
        },
        "progress-import": () => {
          if (!file) throw Object.assign(new Error("فایل اکسل را انتخاب کنید."), { status: 400 });
          let rows;
          try {
            const wb = XLSX.read(file, { type: "buffer", cellDates: true });
            rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false });
          } catch { throw Object.assign(new Error("فایل اکسل خوانده نشد."), { status: 400 }); }
          const { lines, problems } = fromDailySheet(rows);
          if (problems.length || !lines.length) throw Object.assign(new Error((problems.length ? problems : ["در فایل هیچ ردیفی نبود."]).slice(0, 30).join(" ")), { status: 400 });
          return act.importProgressSheet(db, { ...a, lines });
        },
        "scope-rule": () => scope.saveRule(db, a),
        "scope-rule-remove": () => scope.removeRule(db, a),
        "scope-apply": () => scope.applyRule(db, a),
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ ok: true, row: (await run()) ?? null });
    });
  } catch (e) { return errorResponse(e); }
}
