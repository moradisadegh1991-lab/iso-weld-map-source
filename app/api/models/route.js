export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { createLlmRouter } from "../../../lib/llm/index.mjs";

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
    // every offered provider's models, each with its provider and whether this server is set up for it
    return Response.json(createLlmRouter().catalogue());
  } catch (e) {
    return errorResponse(e);
  }
}
