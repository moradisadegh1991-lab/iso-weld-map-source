/**
 * The project's own LLM endpoints (owner's request 2026-10-29): an address
 * and a key a project admin registers in the app instead of the server's
 * environment — an OpenAI-compatible service such as Liara's, or the relay
 * that holds the Claude / Gemini key. Pure: lib/db/repos/llm-endpoints.mjs
 * stores them, lib/llm/index.mjs `createLlmRouter({ endpoints })` uses them.
 */

/** The providers an endpoint may be set for, and which secrets each takes. */
export const ENDPOINT_PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", kinds: ["api_key", "relay_token"], hint: "https://<رله>/v1" },
  gemini: { label: "Google Gemini", kinds: ["api_key", "relay_token"], hint: "https://<رله>/v1beta" },
  "openai-compatible": { label: "سازگار با OpenAI (لیارا، vLLM، …)", kinds: ["api_key"], hint: "https://…/v1" },
};
export const SECRET_KIND_FA = { api_key: "کلید API", relay_token: "توکن رله" };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * An address as it may be stored: `{ url }` without a trailing slash, or
 * `{ problem }`. https only — a key must not cross the network in the clear —
 * except to this machine itself (a relay on localhost). No credentials in
 * the address, no query, and never the cloud metadata addresses
 * (169.254.0.0/16, metadata.google.internal): the server will call this
 * address with the key attached, so it is not an address to be taken as
 * typed.
 */
export function checkBaseUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { problem: "آدرس سرور لازم است." };
  if (s.length > 300 || /\s/.test(s)) return { problem: "آدرس نامعتبر است (فاصله یا بیش از ۳۰۰ نویسه)." };
  let u;
  try { u = new URL(s); } catch { return { problem: "آدرس نامعتبر است؛ مثل https://example.com/v1 بنویسید." }; }
  const host = u.hostname.toLowerCase();
  if (u.username || u.password) return { problem: "آدرس نباید نام کاربری یا گذرواژه داشته باشد؛ کلید را در فیلد کلید بگذارید." };
  if (u.search || u.hash) return { problem: "آدرس نباید پارامتر (؟…) یا # داشته باشد؛ کلید را در آدرس نگذارید." };
  if (!(u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(host)))) {
    return { problem: "آدرس باید با https:// شروع شود (http فقط برای localhost)." };
  }
  if (/^169\.254\./.test(host) || host === "metadata.google.internal" || host === "[fd00:ec2::254]") {
    return { problem: "این آدرس مجاز نیست (آدرس metadata ابر)." };
  }
  return { url: u.href.replace(/\/+$/, "") };
}

/** Model ids typed one per line or comma separated: trimmed, unique, at most 12. */
export function parseModels(raw) {
  const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(/[,\n،]/)).map((x) => String(x).trim()).filter(Boolean);
  return [...new Set(list)].slice(0, 12);
}

/** The last four characters of a secret, enough to tell two keys apart and no more. */
export const hintOf = (secret) => (String(secret).length >= 12 ? `••••${String(secret).slice(-4)}` : "••••");

/**
 * What a provider's factory is given for a stored endpoint. A relay token and
 * an API key are never both sent: the one not chosen is passed as null so an
 * environment variable of the other kind cannot be picked up beside it.
 */
export function providerOptions(provider, { baseUrl, secretKind, secret, models = [] }) {
  const o = baseUrl ? { baseUrl } : {};
  if (provider === "openai-compatible") {
    return { ...o, ...(secret ? { apiKey: secret } : {}),
      ...(models[0] ? { defaultModel: models[0], repairModel: models[1] || models[0], models: models.map((id) => ({ id, label: id.split("/").pop(), note: "از تنظیمات پروژه" })) } : {}) };
  }
  return { ...o, apiKey: secretKind === "api_key" ? secret : null, relayToken: secretKind === "relay_token" ? secret : null };
}
