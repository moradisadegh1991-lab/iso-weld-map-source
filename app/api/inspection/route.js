export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import * as insp from "../../../lib/db/repos/inspection.mjs";
import { raiseNcr } from "../../../lib/db/repos/quality.mjs";
import { updateProjectProfile } from "../../../lib/db/repos/projects.mjs";
import { PARTIES, POINTS, OUTCOMES, SCOPES } from "../../../lib/inspection/itp.mjs";
import { CHAINS } from "../../../lib/platform/precedence.mjs";

/**
 * GET ?projectId=                              ITPs, the request board, and what the page needs to write them
 * GET ?projectId=&scope=                       items of a kind of work, to raise a request for
 * GET ?projectId=&itemKind=&itemId=            one item's inspections: every approved activity, where it stands
 * POST { projectId, kind, … }                  see below
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const scope = url.searchParams.get("scope");
      if (scope) return Response.json({ items: await insp.itemsForScope(db, { projectId, scope }) });
      const itemKind = url.searchParams.get("itemKind");
      if (itemKind) return Response.json(await insp.itemInspections(db, { projectId, itemKind, itemId: url.searchParams.get("itemId") }));
      const { rows: [p] } = await db.query("SELECT inspection_notice_hours FROM project WHERE id = $1", [projectId]);
      return Response.json({
        itps: await insp.listItps(db, { projectId }),
        board: await insp.irBoard(db, { projectId }),
        noticeHours: p?.inspection_notice_hours ?? null,
        myParty: membership.inspection_party || null,
        scopes: Object.fromEntries(Object.entries(SCOPES).map(([k, v]) => [k, { ...v,
          steps: CHAINS[k].map((s) => ({ code: s.code, title: s.title, derived: !!s.derive })) }])),
        parties: PARTIES, points: POINTS, outcomes: OUTCOMES,
      }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (e) { return errorResponse(e); }
}

/**
 * itp · activity · activity-remove · approve · notice   (ITP: engineering's)
 * raise · result · cancel                              (requests: QC and the inspectors)
 * ncr                                                  (an NCR from a rejected request)
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    const need = { itp: ACTIONS.MANAGE_ITP, activity: ACTIONS.MANAGE_ITP, "activity-remove": ACTIONS.MANAGE_ITP,
      approve: ACTIONS.MANAGE_ITP, notice: ACTIONS.MANAGE_ITP, raise: ACTIONS.RECORD_INSPECTION,
      result: ACTIONS.RECORD_INSPECTION, cancel: ACTIONS.RECORD_INSPECTION, ncr: ACTIONS.RECORD_QUALITY }[kind];
    if (!need) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    assertCan(membership, need);
    return await withProject(db, projectId, async () => {
      const a = { ...body, projectId, userId: user.id, membership };
      if (kind === "itp") return Response.json({ itp: await insp.createItp(db, a) });
      if (kind === "activity") return Response.json({ activity: await insp.saveActivity(db, a) });
      if (kind === "activity-remove") { await insp.removeActivity(db, a); return Response.json({ ok: true }); }
      if (kind === "approve") return Response.json({ itp: await insp.approveItp(db, a) });
      if (kind === "notice") {
        const h = body.hours === "" || body.hours === null ? null : Number(body.hours);
        if (h !== null && !(Number.isInteger(h) && h > 0)) return Response.json({ error: "ساعت اطلاع‌رسانی باید عدد صحیح مثبت باشد" }, { status: 400 });
        await updateProjectProfile(db, { projectId, patch: { inspection_notice_hours: h } });
        return Response.json({ noticeHours: h });
      }
      if (kind === "raise") return Response.json({ ir: await insp.raiseIr(db, a) });
      if (kind === "result") return Response.json(await insp.recordResult(db, a));
      if (kind === "cancel") return Response.json(await insp.cancelIr(db, a));
      return Response.json({ ncr: await insp.ncrFromIr(db, { ...a, raiseNcr }) });
    });
  } catch (e) { return errorResponse(e); }
}
