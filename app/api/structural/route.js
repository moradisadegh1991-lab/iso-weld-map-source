export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { tagStatus, recordActivity } from "../../../lib/db/repos/activities.mjs";
import {
  listStructures, deriveStructureSteps, upsertStructure, recordPlumbReading, recordBolting,
} from "../../../lib/db/repos/structural.mjs";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const tagId = url.searchParams.get("tagId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);

    return await withProject(db, projectId, async () => {
      if (tagId) {
        const steel = await deriveStructureSteps(db, { projectId, tagId });
        return Response.json({
          status: await tagStatus(db, { projectId, tagId }),
          survey: steel.survey, bolting: steel.bolting,
        });
      }
      const structures = [];
      for (const t of await listStructures(db, { projectId })) {
        const s = await tagStatus(db, { projectId, tagId: t.id });
        const pick = (code) => {
          const x = s.steps?.find((y) => y.code === code);
          return x ? { status: x.status, note: x.note, na: x.na } : null;
        };
        structures.push({
          ...t, pct: s.progress?.pct ?? 0, ready: !!s.why?.ready,
          next: (s.next || []).map(({ code, title }) => ({ code, title })),
          waitingOn: (s.why?.rootCauses || []).map(({ code, title, discipline }) => ({ code, title, discipline })),
          foundation: pick("foundation"), plumb: pick("plumb"), bolting: pick("bolting"),
          outOfOrder: (s.steps || []).filter((x) => x.outOfOrder).map((x) => x.title),
        });
      }
      const { rows: [p] } = await db.query(
        "SELECT steel_erection_standard FROM project WHERE id = $1", [projectId]);
      const { rows: subsystems } = await db.query(
        "SELECT id, code FROM subsystem WHERE project_id = $1 ORDER BY code", [projectId]);
      return Response.json({ structures, standard: p?.steel_erection_standard || null, subsystems });
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

    // Registering a structure and its counts is engineering; recording the
    // survey and the bolting is site QC — the same split as civil.
    assertCan(membership, kind === "structure" ? ACTIONS.EDIT_EXTRACTION : ACTIONS.ASSIGN_WELD);

    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "structure") return Response.json({ structure: await upsertStructure(db, args) });
      if (kind === "activity") return Response.json({ activity: await recordActivity(db, args) });
      if (kind === "plumb") return Response.json({ reading: await recordPlumbReading(db, args) });
      if (kind === "bolting") return Response.json({ bolting: await recordBolting(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
