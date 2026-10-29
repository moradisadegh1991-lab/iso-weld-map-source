export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import * as le from "../../../lib/db/repos/llm-endpoints.mjs";
import { ENDPOINT_PROVIDERS } from "../../../lib/llm/endpoints.mjs";

/**
 * The project's own LLM endpoints (owner's request 2026-10-29): the address
 * and key registered for Claude, Gemini or an OpenAI-compatible service
 * (Liara, vLLM …). Every member sees what is registered — the address, the
 * kind of key and its last four characters; only a project admin registers,
 * changes or removes one. The key travels one way: it is sent here once,
 * sealed (lib/server/secret-box.mjs) and never returned — not in this
 * response, not in any other.
 *
 *   GET  ?projectId                                   { endpoints, providers, may: { write } }
 *   POST {projectId, kind: save, provider, baseUrl, secretKind?, secret?, models?}
 *   POST {projectId, kind: remove, provider}
 */
export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => Response.json({
      endpoints: await le.listEndpoints(db, { projectId }),
      providers: Object.fromEntries(Object.entries(ENDPOINT_PROVIDERS).map(([id, p]) => [id, { label: p.label, kinds: p.kinds, hint: p.hint }])),
      may: { write: can(membership, ACTIONS.MANAGE_MEMBERS) },
    }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    const { projectId, kind } = b;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => {
      if (kind === "save") {
        const row = await le.saveEndpoint(db, { projectId, provider: b.provider, baseUrl: b.baseUrl, secretKind: b.secretKind, secret: b.secret, models: b.models, userId: user.id });
        return Response.json({ ok: true, row });
      }
      if (kind === "remove") { await le.removeEndpoint(db, { projectId, provider: b.provider, userId: user.id }); return Response.json({ ok: true, row: null }); }
      return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    });
  } catch (e) { return errorResponse(e); }
}
