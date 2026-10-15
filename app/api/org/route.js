export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import { getStore } from "../../../lib/storage/index.mjs";
import * as org from "../../../lib/db/repos/org.mjs";

/**
 * The organisation's process, steps 1–2 (lib/db/repos/org.mjs).
 *   GET ?projectId                       companies, project stakeholders, currencies, budgets, contracts
 *   GET ?projectId&contractId            + that contract's budget, stakeholders, amendments, category trees
 *   GET ?projectId&logo=ID               a company logo's bytes
 *   POST multipart {projectId, companyId, name, file}   a company logo
 *   POST {kind: company | logo-active | stakeholder | stakeholder-remove | currency | budget | budget-remove}
 *        — the project's managers (members' managers)
 *   POST {kind: contract-currency | contract-stakeholder | contract-stakeholder-remove | amendment |
 *         category | category-move | category-rename | category-remove} — contract managers
 */
const PROJECT_KINDS = new Set(["company", "logo", "logo-active", "stakeholder", "stakeholder-remove", "currency", "budget", "budget-remove"]);

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const logo = url.searchParams.get("logo");
    if (logo) {
      if (!/^[0-9a-f-]{36}$/i.test(logo)) return Response.json({ error: "not found" }, { status: 404 });
      const f = await withProject(db, projectId, async () => org.readCompanyLogo(db, { logoId: logo, store: await getStore() }));
      return new Response(f.bytes, { headers: { "Content-Type": f.contentType, "Content-Length": String(f.bytes.length),
        "Cache-Control": "private, max-age=31536000, immutable", "ETag": `"${f.sha256}"`, "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" } });
    }
    const contractId = url.searchParams.get("contractId");
    return await withProject(db, projectId, async () => {
      const { rows: contracts } = await db.query(
        "SELECT id, contract_no, title, currency, start_on, end_on, status FROM contract WHERE project_id = $1 ORDER BY contract_no", [projectId]);
      return Response.json({
        ...(await org.projectSetup(db, { projectId })), contracts,
        contract: contractId ? await org.contractSetup(db, { projectId, contractId }) : null,
        labels: { contractRoles: org.CONTRACT_ROLES, amendmentKinds: org.AMENDMENT_KINDS, trees: org.TREES },
        may: { project: can(membership, ACTIONS.MANAGE_MEMBERS), contract: can(membership, ACTIONS.MANAGE_CONTRACTS) },
      });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const multipart = (request.headers.get("content-type") || "").startsWith("multipart/form-data");
    let body, file = null;
    if (multipart) {
      const form = await request.formData();
      body = { projectId: String(form.get("projectId") || ""), kind: "logo", companyId: String(form.get("companyId") || ""), name: String(form.get("name") || "") };
      const f = form.get("file");
      file = f && typeof f === "object" && f.size ? Buffer.from(await f.arrayBuffer()) : Buffer.alloc(0);
    } else body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, PROJECT_KINDS.has(kind) ? ACTIONS.MANAGE_MEMBERS : ACTIONS.MANAGE_CONTRACTS);
    const store = kind === "logo" ? await getStore() : null;
    const userId = user.id;
    return await withProject(db, projectId, async () => {
      const ok = (x) => Response.json({ ok: true, ...x });
      switch (kind) {
        case "company": return ok({ company: await org.upsertCompany(db, { ...body, userId }) });
        case "logo": return ok({ logo: await org.addCompanyLogo(db, { companyId: body.companyId, name: body.name, bytes: file, store, userId }) });
        case "logo-active": return ok({ logo: await org.setCompanyLogoActive(db, { logoId: body.id, active: body.active }) });
        case "stakeholder": return ok({ row: await org.addProjectStakeholder(db, { projectId, companyId: body.companyId, role: body.role, note: body.note }) });
        case "stakeholder-remove": await org.removeProjectStakeholder(db, { projectId, id: body.id }); return ok({});
        case "currency": return ok({ row: await org.upsertCurrency(db, { projectId, code: body.code, name: body.name, rate: body.rate }) });
        case "budget": return ok({ row: await org.addProjectBudget(db, { projectId, title: body.title, currency: body.currency, amount: body.amount, note: body.note, userId }) });
        case "budget-remove": await org.removeProjectBudget(db, { projectId, id: body.id }); return ok({});
        case "contract-currency": return ok({ row: await org.upsertContractCurrency(db, { projectId, contractId: body.contractId, currency: body.currency,
          rate: body.rate, budget: body.budget, doneTyped: body.doneTyped, userId }) });
        case "contract-stakeholder": return ok({ row: await org.addContractStakeholder(db, { projectId, contractId: body.contractId, companyId: body.companyId, role: body.role, note: body.note }) });
        case "contract-stakeholder-remove": await org.removeContractStakeholder(db, { projectId, id: body.id }); return ok({});
        case "amendment": return ok({ row: await org.addAmendment(db, { projectId, contractId: body.contractId, amendmentNo: body.amendmentNo, kind: body.amendmentKind,
          title: body.title, signedOn: body.signedOn, days: body.days, lines: body.lines, note: body.note, userId }) });
        case "category": return ok({ row: await org.addCategory(db, { projectId, contractId: body.contractId, tree: body.tree, parentId: body.parentId || null,
          name: body.name, discipline: body.discipline }) });
        case "category-move": return ok({ row: await org.moveCategory(db, { projectId, id: body.id, parentId: body.parentId || null }) });
        case "category-rename": return ok({ row: await org.renameCategory(db, { projectId, id: body.id, name: body.name, discipline: body.discipline }) });
        case "category-remove": await org.removeCategory(db, { projectId, id: body.id }); return ok({});
        default: return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      }
    });
  } catch (e) { return errorResponse(e); }
}
