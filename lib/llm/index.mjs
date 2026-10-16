/**
 * Provider selection.
 *
 * The whole point of this seam is that migrating from a hosted API to a
 * self-hosted vLLM cluster is a configuration change, not a rewrite. Nothing
 * above this file mentions Anthropic or OpenAI; it asks for a completion and
 * gets text, usage and a stop reason back.
 *
 *   LLM_PROVIDER=anthropic          (default)
 *   LLM_PROVIDER=openai-compatible  + LLM_BASE_URL=http://vllm:8000/v1
 */
import { createAnthropicProvider } from "./anthropic.mjs";
import { createOpenAiCompatProvider } from "./openai-compat.mjs";

export const PROVIDERS = {
  anthropic: createAnthropicProvider,
  "openai-compatible": createOpenAiCompatProvider,
};

export function createLlmClient({ provider = process.env.LLM_PROVIDER || "anthropic", ...opts } = {}) {
  const make = PROVIDERS[provider];
  if (!make) {
    throw Object.assign(
      new Error(`LLM_PROVIDER «${provider}» شناخته نشد. یکی از: ${Object.keys(PROVIDERS).join("، ")}`),
      { status: 500, code: "LLM_UNKNOWN_PROVIDER" });
  }
  return make(opts);
}
