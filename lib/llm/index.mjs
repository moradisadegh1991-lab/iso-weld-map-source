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
 *   LLM_PROVIDER=gemini             + GEMINI_API_KEY=… (or the relay)
 *
 * Several at once (owner's request 2026-10-21): the model picker lists the
 * models of every provider, each marked with its provider and whether this
 * server is set up for it, and the model a person picks decides which
 * provider answers — Claude for the reading, Gemini for the repair pass, or
 * any mix. LLM_PROVIDER is then only the default: the provider whose default
 * model is preselected. LLM_PROVIDERS (comma separated) limits which are
 * offered; unset, Anthropic and Gemini always are, and the OpenAI-compatible
 * server when LLM_BASE_URL names one.
 *
 * `endpoints` (lib/db/repos/llm-endpoints.mjs `resolveEndpoints`): the address
 * and key a project registered, per provider — they replace the environment's
 * for that provider, and a provider with one is offered even when the
 * environment names none.
 */
import { createAnthropicProvider } from "./anthropic.mjs";
import { createOpenAiCompatProvider } from "./openai-compat.mjs";
import { createGeminiProvider } from "./gemini.mjs";

export const PROVIDERS = {
  anthropic: createAnthropicProvider,
  "openai-compatible": createOpenAiCompatProvider,
  gemini: createGeminiProvider,
};

export const PROVIDER_LABELS = {
  anthropic: "Anthropic (Claude)",
  gemini: "Google Gemini",
  "openai-compatible": "مدل داخلی (OpenAI-compatible / vLLM)",
};

const unknownProvider = (provider) => Object.assign(
  new Error(`LLM_PROVIDER «${provider}» شناخته نشد. یکی از: ${Object.keys(PROVIDERS).join("، ")}`),
  { status: 500, code: "LLM_UNKNOWN_PROVIDER" });

export function createLlmClient({ provider = process.env.LLM_PROVIDER || "anthropic", ...opts } = {}) {
  const make = PROVIDERS[provider];
  if (!make) throw unknownProvider(provider);
  return make(opts);
}

/** The providers this server offers, in order: the default first. A provider a project registered an endpoint for is offered whatever the environment says. */
function offered(env, endpoints = {}) {
  const def = env.LLM_PROVIDER || "anthropic";
  if (!PROVIDERS[def]) throw unknownProvider(def);
  const listed = env.LLM_PROVIDERS
    ? env.LLM_PROVIDERS.split(",").map((s) => s.trim()).filter(Boolean)
    : ["anthropic", "gemini", ...(env.LLM_BASE_URL ? ["openai-compatible"] : [])];
  for (const p of listed) if (!PROVIDERS[p]) throw unknownProvider(p);
  const own = Object.keys(endpoints).filter((p) => PROVIDERS[p] && !listed.includes(p) && p !== def);
  return [def, ...listed.filter((p) => p !== def), ...own];
}

/**
 * Every offered provider, built once per call. `clientFor(model)` is the one
 * that serves a model: the provider whose catalogue lists it, else the one
 * its name belongs to (claude-… / gemini-…), else the default — a vLLM
 * server serves whatever it was started with, so an unlisted name goes to
 * the default provider rather than being refused here.
 */
export function createLlmRouter({ env = process.env, endpoints = {} } = {}) {
  const ids = offered(env, endpoints);
  const clients = ids.map((id) => createLlmClient({ provider: id, ...(endpoints[id] || {}) }));
  const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
  const def = clients[0];
  const clientFor = (model) => {
    if (!model) return def;
    const listed = clients.find((c) => c.models.some((m) => m.id === model));
    if (listed) return listed;
    if (/^claude-/.test(model) && byId.anthropic) return byId.anthropic;
    if (/^gemini-/.test(model) && byId.gemini) return byId.gemini;
    return def;
  };
  // the preselected models: the default provider's, unless it is not set up
  // and another is — a picker preselecting a model that cannot run is a trap
  const ready = def.configured ? def : clients.find((c) => c.configured) || def;
  const catalogue = () => ({
    provider: ready.id,
    configured: ready.configured,
    defaultModel: ready.defaultModel,
    repairModel: ready.repairModel,
    providers: clients.map((c) => ({ id: c.id, label: PROVIDER_LABELS[c.id] || c.id, configured: c.configured, via: c.via || null, own: !!endpoints[c.id] })),
    models: clients.flatMap((c) => c.models.map((m) => ({ ...m, provider: c.id, configured: c.configured }))),
  });
  return { clients, default: def, clientFor, catalogue };
}
