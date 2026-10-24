export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { can, assertCan } from "../../../lib/authz.mjs";
import { entityOf } from "../../../lib/db/repos/removal.mjs";
import { listTrash, trashItem, restoreItem, purgeItem, TRASH_DAYS } from "../../../lib/db/repos/trash.mjs";

/**
 * The project's trash (lib/db/repos/trash.mjs).
 *
 *   GET  ?projectId                        → { days, items: [{ …, entity, mayRestore }] }
 *   POST { projectId, kind: "restore" | "purge", id }
 *
 * Restoring or letting go of an item needs what deleting its kind needed
 * (lib/db/repos/removal.mjs ENTITIES); any member sees what is there.
 */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    return await withProject(db, projectId, async () => {
      const items = (await listTrash(db)).map((t) => {
        const e = entityOf(t.entity);
        return { ...t, mayRestore: Boolean(e && can(membership, e.need)) };
      });
      return Response.json({ days: TRASH_DAYS, items });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const { projectId, kind, id } = await request.json().catch(() => ({}));
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    if (kind !== "restore" && kind !== "purge") return Response.json({ error: "kind must be restore or purge" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    return await withProject(db, projectId, async () => {
      const item = await trashItem(db, { id });
      const e = entityOf(item.entity);
      if (!e) return Response.json({ error: "این نوع رکورد دیگر بازگرداندنی نیست." }, { status: 400 });
      assertCan(membership, e.need);
      return Response.json({ [kind === "restore" ? "restored" : "purged"]: kind === "restore" ? await restoreItem(db, { id }) : await purgeItem(db, { id }) });
    });
  } catch (e) { return errorResponse(e); }
}
