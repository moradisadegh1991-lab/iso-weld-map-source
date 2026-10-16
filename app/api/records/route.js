export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan } from "../../../lib/authz.mjs";
import { entityOf, removalBlocker, removeRecord } from "../../../lib/db/repos/removal.mjs";

/**
 * Deleting a register row entered by mistake (lib/db/repos/removal.mjs).
 *
 *   GET    ?projectId&entity&id  → { blocker: null | "why not" }   — asked before the confirmation
 *   DELETE { projectId, entity, id }                                 — refused, with the reason, while anything uses it
 *
 * Each entity carries the action a person needs; a viewer is refused before
 * the database is asked anything.
 */
async function scope(request, { projectId, entity }) {
  if (!projectId) throw Object.assign(new Error("projectId is required"), { status: 400 });
  const e = entityOf(entity);
  if (!e) throw Object.assign(new Error("این نوع رکورد حذف‌شدنی نیست."), { status: 400, code: "INVALID_INPUT" });
  const { db, membership } = await authenticate(request, { projectId });
  if (!membership) throw Object.assign(new Error("not found"), { status: 404 });
  assertCan(membership, e.need);
  return db;
}

export async function GET(request) {
  try {
    const q = Object.fromEntries(new URL(request.url).searchParams);
    const db = await scope(request, q);
    return await withProject(db, q.projectId, async () => Response.json({ blocker: await removalBlocker(db, q) }));
  } catch (e) { return errorResponse(e); }
}

export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const db = await scope(request, body);
    return await withProject(db, body.projectId, async () => Response.json({ removed: await removeRecord(db, body) }));
  } catch (e) { return errorResponse(e); }
}
