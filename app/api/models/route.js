export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { createLlmRouter } from "../../../lib/llm/index.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { resolveEndpoints } from "../../../lib/db/repos/llm-endpoints.mjs";

/**
 * What the server can actually run.
 *
 * The model list belongs here, not in the page: a self-hosted deployment
 * serves whatever vLLM was started with, and a UI that hard-codes three
 * Anthropic model ids would be lying the moment the provider changes.
 */
export async function GET(request) {
  try {
    // with a project, the endpoints its admin registered stand over the environment's (lib/llm/endpoints.mjs)
    const projectId = new URL(request.url).searchParams.get("projectId") || undefined;
    const { db, membership } = await authenticate(request, { projectId });
    let endpoints = {};
    if (projectId && membership) endpoints = (await withProject(db, projectId, () => resolveEndpoints(db, { projectId }))).endpoints;
    // every offered provider's models, each with its provider and whether this server is set up for it
    return Response.json(createLlmRouter({ endpoints }).catalogue());
  } catch (e) {
    return errorResponse(e);
  }
}
