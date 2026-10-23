export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { getStore } from "../../../lib/storage/index.mjs";
import { listProjectUsers } from "../../../lib/db/repos/users.mjs";
import * as nt from "../../../lib/db/repos/notifications.mjs";

/**
 * Notifications (lib/db/repos/notifications.mjs): any member sends to other
 * members, reads what came to them, replies once. A viewer too: a reply to
 * a question asked of them is not an edit of the project.
 *
 *   GET ?projectId                 received, sent, the project's people
 *   GET ?projectId&file=ID         an attachment, to its sender or a recipient
 *   POST multipart {kind: send, recipients (JSON), title, body, replyDue, file…}
 *   POST {kind: read | reply, id, text}
 */
const MAX = 25 * 1024 * 1024;

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId"), file = url.searchParams.get("file");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    if (file) {
      if (!/^[0-9a-f-]{36}$/i.test(file)) return Response.json({ error: "not found" }, { status: 404 });
      const f = await withProject(db, projectId, async () => nt.readFile(db, { projectId, fileId: file, userId: user.id, store: await getStore() }));
      return new Response(f.bytes, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(f.bytes.length),
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` } });
    }
    return await withProject(db, projectId, async () => {
      const people = (await listProjectUsers(db, { projectId })).filter((u) => u.is_active !== false && u.user_id !== user.id)
        .map((u) => ({ id: u.user_id, name: u.display_name || u.email }));
      return Response.json({ ...(await nt.notificationsOf(db, { projectId, userId: user.id })), people, me: user.id });
    });
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    let body, files = [];
    if ((request.headers.get("content-type") || "").startsWith("multipart/form-data")) {
      const form = await request.formData();
      body = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
      let total = 0;
      for (const f of form.getAll("file")) {
        if (!f || typeof f !== "object" || !f.size) continue;
        total += f.size;
        if (total > MAX) return Response.json({ error: "حجم پیوست‌ها بیش از ۲۵ مگابایت است." }, { status: 400 });
        files.push({ name: f.name || "upload", bytes: Buffer.from(await f.arrayBuffer()), contentType: f.type || null });
      }
      try { body.recipients = JSON.parse(body.recipients || "[]"); } catch { body.recipients = []; }
    } else body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const a = { ...body, projectId, userId: user.id };
      const run = {
        send: async () => nt.sendNotification(db, { ...a, files, store: files.length ? await getStore() : null }),
        read: () => nt.markRead(db, a),
        reply: () => nt.reply(db, a),
      }[kind];
      if (!run) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      return Response.json({ ok: true, row: (await run()) ?? null });
    });
  } catch (e) { return errorResponse(e); }
}
