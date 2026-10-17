export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import * as eps from "../../../lib/db/repos/eps.mjs";
import { assertContractAccess } from "../../../lib/db/repos/users.mjs";
import { BUDGET_MODES, SEPARATORS } from "../../../lib/eps/wbs.mjs";
import { PMS_TYPES } from "../../../lib/db/repos/eps.mjs";
import { importPlan, convertLegacy, legacyImports } from "../../../lib/db/repos/eps-import.mjs";
import { logEvent } from "../../../lib/db/repos/log.mjs";

/**
 * EPS, PMS versions, WBS and activity templates (lib/db/repos/eps.mjs).
 * A contract's EPS and WBS are reached through the caller's access to the
 * contract: reading with any access, changing with «ثبت و ویرایش» or more.
 * Activity templates are the project's: kept by contracts or controls.
 *
 *   GET ?projectId&contractId              the contract's EPS: PMSs and their versions
 *   GET ?projectId&versionId               a version's WBS with every derived figure, and the templates
 *   GET ?projectId&versionId&suggest=1[&parentId]   the code a new node would get
 *   GET ?projectId&templates=1             the activity templates
 *   POST {kind: pms | version | version-master | eps-move | eps-remove | settings | node | node-move | node-copy | node-remove |
 *         attach | activity | activity-remove | template | template-move | template-copy | template-remove |
 *         template-activity | template-activity-remove | template-sync | convert-legacy}
 *   POST multipart {kind: import-plan, pmsId, versionCode, fileKind: mspdi | pms, file}
 *        a plan file (MS Project XML or the PMS workbook) as a new version of a PMS
 */
const LABELS = { budgetModes: BUDGET_MODES, separators: SEPARATORS, pmsTypes: PMS_TYPES };
const notFound = () => Object.assign(new Error("not found"), { status: 404 });

/** The contract a request's record belongs to, read from the record itself (the repository checks the rest belongs with it). */
const PMS = "SELECT contract_id FROM eps_pms WHERE id = $1 AND project_id = $2";
const VERSION = "SELECT p.contract_id FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id WHERE v.id = $1 AND v.project_id = $2";
const NODE = `SELECT p.contract_id FROM wbs_node n JOIN eps_version v ON v.id = n.version_id JOIN eps_pms p ON p.id = v.pms_id
               WHERE n.id = $1 AND n.project_id = $2`;
const ACTIVITY = `SELECT p.contract_id FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id JOIN eps_version v ON v.id = n.version_id
                   JOIN eps_pms p ON p.id = v.pms_id WHERE a.id = $1 AND a.project_id = $2`;
async function contractOf(db, projectId, b) {
  const q = async (sql, id) => (id ? (await db.query(sql, [id, projectId])).rows[0]?.contract_id ?? null : null);
  switch (b.kind) {
    case "pms": return b.id ? q(PMS, b.id) : b.contractId || null;
    case "version": return b.id ? q(VERSION, b.id) : q(PMS, b.pmsId);
    case "import-plan": case "convert-legacy": return q(PMS, b.pmsId);
    case "version-master": return q(VERSION, b.id);
    case "eps-move": case "eps-remove": return b.epsKind === "version" ? q(VERSION, b.id) : q(PMS, b.id);
    case "settings": case "node": case "node-move": case "node-copy": case "node-remove": return q(VERSION, b.versionId);
    case "attach": case "activity": return q(NODE, b.nodeId);
    case "activity-remove": return q(ACTIVITY, b.id);
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
    const mayTemplates = can(membership, ACTIONS.MANAGE_CONTRACTS) || can(membership, ACTIONS.MANAGE_CONTROLS);
    return await withProject(db, projectId, async () => {
      if (q("templates")) return Response.json({ templates: await eps.templatesWithActivities(db, { projectId }), may: { edit: mayTemplates } });
      const versionId = q("versionId");
      if (versionId) {
        const contractId = await contractOf(db, projectId, { kind: "settings", versionId });
        if (!contractId) throw notFound();
        const access = await assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role });
        if (q("suggest")) return Response.json({ code: await eps.suggestNodeCode(db, { projectId, versionId, parentId: q("parentId") }) });
        return Response.json({ ...(await eps.wbsView(db, { projectId, versionId })), labels: LABELS, may: { edit: access !== "view" } });
      }
      const contractId = q("contractId");
      if (!contractId) return Response.json({ error: "contractId is required" }, { status: 400 });
      const access = await assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role });
      return Response.json({ pms: await eps.epsBoard(db, { projectId, contractId }), labels: LABELS, may: { edit: access !== "view" },
        legacy: await legacyImports(db, { projectId }) });
    });
  } catch (e) { return errorResponse(e); }
}

const MAX = 20 * 1024 * 1024;

export async function POST(request) {
  try {
    // a plan file comes as multipart; everything else as JSON
    let b, file = null, fileName = null;
    if ((request.headers.get("content-type") || "").startsWith("multipart/form-data")) {
      const form = await request.formData();
      b = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
      const f = form.get("file");
      if (f && typeof f === "object" && f.size) {
        if (f.size > MAX) return Response.json({ error: "فایل بزرگ‌تر از ۲۰ مگابایت است." }, { status: 400 });
        file = Buffer.from(await f.arrayBuffer()); fileName = f.name || "upload";
      }
    } else b = await request.json().catch(() => ({}));
    const { projectId, kind } = b;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const a = { ...b, projectId, userId: user.id };
      if (kind.startsWith("template")) {
        if (!can(membership, ACTIONS.MANAGE_CONTRACTS) && !can(membership, ACTIONS.MANAGE_CONTROLS)) {
          throw Object.assign(new Error("الگوهای فعالیت را امور قراردادها یا کنترل پروژه نگه می‌دارد."), { status: 403, code: "FORBIDDEN" });
        }
      } else {
        const contractId = await contractOf(db, projectId, b);
        if (!contractId) throw notFound();
        await assertContractAccess(db, { projectId, contractId, userId: user.id, role: membership.role, need: "edit" });
        a.contractId = contractId;
      }
      const run = {
        pms: () => eps.savePms(db, a),
        version: () => eps.saveVersion(db, a),
        "version-master": () => eps.setMaster(db, a),
        "eps-move": () => eps.moveEps(db, { ...a, kind: b.epsKind }),
        "eps-remove": () => eps.removeEps(db, { ...a, kind: b.epsKind }),
        settings: () => eps.saveSettings(db, a),
        node: () => eps.saveNode(db, a),
        "node-move": () => eps.moveNode(db, a),
        "node-copy": () => eps.copyNode(db, a),
        "node-remove": () => eps.removeNode(db, a),
        attach: () => eps.attachTemplate(db, a),
        activity: () => eps.saveActivity(db, a),
        "activity-remove": () => eps.removeActivity(db, a),
        template: () => eps.saveTemplate(db, a),
        "template-move": () => eps.moveTemplate(db, a),
        "template-copy": () => eps.copyTemplate(db, a),
        "template-remove": () => eps.removeTemplate(db, a),
        "template-activity": () => eps.saveTemplateActivity(db, a),
        "template-activity-remove": () => eps.removeTemplateActivity(db, a),
        "template-sync": () => eps.syncTemplate(db, a),
        "import-plan": async () => {
          if (!file) throw Object.assign(new Error("فایل برنامه را انتخاب کنید."), { status: 400 });
          const r = await importPlan(db, { ...a, kind: b.fileKind, versionCode: b.versionCode, title: b.title || null, sourceName: fileName, content: file });
          await logEvent(db, { projectId, section: "controls", entityType: "eps_version", entityId: r.version.id, label: `نسخهٔ ${r.version.code} از ${fileName}`,
            action: "imported", comment: `${r.nodes} گره، ${r.activities} فعالیت، ${r.relations} رابطه`, userId: user.id });
          return r;
        },
        "convert-legacy": () => convertLegacy(db, { ...a, versionCode: b.versionCode }),
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ ok: true, row: (await run()) ?? null });
    });
  } catch (e) { return errorResponse(e); }
}
