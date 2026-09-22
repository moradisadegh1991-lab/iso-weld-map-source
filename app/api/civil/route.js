export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { tagStatus, recordActivity } from "../../../lib/db/repos/activities.mjs";
import {
  listFoundations, concreteClasses, poursOf, upsertFoundation, recordPour, recordSpecimens,
} from "../../../lib/db/repos/civil.mjs";

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
        return Response.json({
          status: await tagStatus(db, { projectId, tagId }),
          pours: await poursOf(db, { projectId, tagId }),
        });
      }
      const foundations = [];
      for (const f of await listFoundations(db, { projectId })) {
        const s = await tagStatus(db, { projectId, tagId: f.id });
        const strength = s.steps?.find((x) => x.code === "strength");
        foundations.push({
          ...f, pct: s.progress?.pct ?? 0, ready: !!s.why?.ready,
          next: (s.next || []).map(({ code, title }) => ({ code, title })),
          waitingOn: (s.why?.rootCauses || []).map(({ code, title }) => ({ code, title })),
          strength: strength ? { status: strength.status, note: strength.note } : null,
          outOfOrder: (s.steps || []).filter((x) => x.outOfOrder).map((x) => x.title),
        });
      }
      const { rows: [spec] } = await db.query(
        "SELECT concrete_curing_days, concrete_sample_per_m3 FROM project WHERE id = $1", [projectId]);
      const { rows: equipment } = await db.query(
        `SELECT id, tag_no, description FROM tag
          WHERE project_id = $1 AND discipline = 'equipment' ORDER BY tag_no`, [projectId]);
      return Response.json({
        foundations,
        classes: await concreteClasses(db, { projectId }),
        spec: { curingDays: spec?.concrete_curing_days ?? null,
                samplePerM3: spec?.concrete_sample_per_m3 == null ? null : Number(spec.concrete_sample_per_m3) },
        equipment,
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

    // Registering a foundation and its specified concrete is an engineering
    // act; recording what happened on site is the grant that already means
    // that — engineers and QC hold it, viewers do not.
    assertCan(membership, kind === "foundation" ? ACTIONS.EDIT_EXTRACTION : ACTIONS.ASSIGN_WELD);

    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      if (kind === "foundation") return Response.json({ foundation: await upsertFoundation(db, args) });
      if (kind === "activity") return Response.json({ activity: await recordActivity(db, args) });
      if (kind === "pour") return Response.json({ pour: await recordPour(db, args) });
      if (kind === "specimens") return Response.json({ specimens: await recordSpecimens(db, args) });
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
