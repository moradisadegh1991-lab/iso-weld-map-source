export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { createLlmClient } from "../../../lib/llm/index.mjs";

/**
 * What the server can actually run.
 *
 * The model list belongs here, not in the page: a self-hosted deployment
 * serves whatever vLLM was started with, and a UI that hard-codes three
 * Anthropic model ids would be lying the moment the provider changes.
 */
export async function GET(request) {
  try {
    await authenticate(request);
    const client = createLlmClient();
    return Response.json({
      provider: client.id,
      configured: client.configured,
      models: client.models,
      defaultModel: client.defaultModel,
      repairModel: client.repairModel,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
