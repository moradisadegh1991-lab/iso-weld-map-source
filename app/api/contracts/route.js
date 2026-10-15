export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import {
  contractsBoard, designQuantities, upsertContract, setContractStatus, upsertLine, importDesignQuantities,
  createStatement, remeasure, setMeasured, statementDetail, statementTransition,
} from "../../../lib/db/repos/contracts.mjs";
import { METRIC_FA } from "../../../lib/contracts/metrics.mjs";
import { METHODS, STATUS, CONTRACT_STATUS, CONTRACT_KIND } from "../../../lib/contracts/statement.mjs";

/** Contracts and subcontracts, their items on the WBS, the design (PDMS) quantities, and payment statements. */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const statement = url.searchParams.get("statement");
      if (statement) {
        if (!/^[0-9a-f-]{36}$/i.test(statement)) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json({ statement: await statementDetail(db, { projectId, statementId: statement }) });
      }
      const [contracts, design] = await Promise.all([contractsBoard(db, { projectId }), designQuantities(db, { projectId })]);
      const { rows: accounts } = await db.query("SELECT id, code, title FROM control_account WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: contractors } = await db.query("SELECT id, code, name FROM contractor WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: companies } = await db.query("SELECT id, code, name FROM company ORDER BY code");
      const { rows: subsystems } = await db.query("SELECT id, code, name FROM subsystem WHERE project_id = $1 ORDER BY code", [projectId]);
      const { rows: [proj] } = await db.query("SELECT contract_currency FROM project WHERE id = $1", [projectId]);
      return Response.json({ contracts, design, accounts, contractors, companies, subsystems, currency: proj?.contract_currency || null,
        metrics: METRIC_FA, methods: METHODS, statuses: STATUS, contractStatuses: CONTRACT_STATUS, kinds: CONTRACT_KIND });
    });
  } catch (e) { return errorResponse(e); }
}

// Who does what: the contracts department keeps contracts and gives final
// approval; the site prepares; the engineer verifies (four eyes are
// lib/contracts/statement.mjs).
const NEEDS = {
  contract: ACTIONS.MANAGE_CONTRACTS, "contract-status": ACTIONS.MANAGE_CONTRACTS, line: ACTIONS.MANAGE_CONTRACTS,
  "design-import": ACTIONS.MANAGE_CONTRACTS,
  "statement-create": ACTIONS.PREPARE_STATEMENT, "statement-measure": ACTIONS.PREPARE_STATEMENT, "statement-set": ACTIONS.PREPARE_STATEMENT,
};
const TRANSITION_NEEDS = { submit: ACTIONS.PREPARE_STATEMENT, verify: ACTIONS.VERIFY_STATEMENT, approve: ACTIONS.APPROVE_STATEMENT };

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    if (kind === "statement-transition") {
      // A return is by whoever holds the step it is returned from.
      const need = body.action === "return" ? null : TRANSITION_NEEDS[body.action];
      if (need) assertCan(membership, need);
      else if (!can(membership, ACTIONS.VERIFY_STATEMENT) && !can(membership, ACTIONS.APPROVE_STATEMENT)) assertCan(membership, ACTIONS.VERIFY_STATEMENT);
    } else if (NEEDS[kind]) assertCan(membership, NEEDS[kind]);
    else return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "contract") return Response.json({ contract: await upsertContract(db, { ...args, kind: body.contractKind }) });
      if (kind === "contract-status") return Response.json({ contract: await setContractStatus(db, args) });
      if (kind === "line") return Response.json({ line: await upsertLine(db, args) });
      if (kind === "design-import") return Response.json({ report: await importDesignQuantities(db, args) });
      if (kind === "statement-create") return Response.json({ statement: await createStatement(db, args) });
      if (kind === "statement-measure") return Response.json({ statement: await remeasure(db, args) });
      if (kind === "statement-set") return Response.json({ statement: await setMeasured(db, args) });
      return Response.json({ statement: await statementTransition(db, args) });
    });
  } catch (e) { return errorResponse(e); }
}
