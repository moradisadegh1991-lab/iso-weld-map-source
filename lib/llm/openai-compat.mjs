/**
 * OpenAI-compatible adapter — vLLM, SGLang, and anything else that speaks
 * `/v1/chat/completions`.
 *
 * This is the path the reference architecture actually deploys on: an
 * open-weight vision model served inside the plant network, because the
 * hosted APIs are not reliably reachable and the drawings are not ours to
 * send abroad. Everything above this file is written against the shared
 * interface, so switching is one environment variable.
 *
 * Two differences from Anthropic that this adapter hides from its callers:
 *
 *   - no assistant prefill. Most OpenAI-compatible servers ignore a trailing
 *     assistant message, so instead we ask for JSON mode, which vLLM
 *     implements with guided decoding. The caller gets a complete JSON
 *     string either way and never has to know which trick was used.
 *   - usage arrives only if you ask for it, via stream_options.
 */
import { readSse } from "./sse.mjs";

export function createOpenAiCompatProvider({
  baseUrl = process.env.LLM_BASE_URL,
  apiKey,
  authScheme = "bearer",
  defaultModel = process.env.LLM_MODEL || "Qwen/Qwen2.5-VL-32B-Instruct",
  repairModel = process.env.LLM_REPAIR_MODEL || process.env.LLM_MODEL || "Qwen/Qwen2.5-VL-32B-Instruct",
  jsonMode = process.env.LLM_JSON_MODE !== "off",
  // the models this endpoint serves, when a project registered them (lib/llm/endpoints.mjs); else the environment's
  models = modelsFromEnv(defaultModel, repairModel),
  fetchImpl = fetch,
} = {}) {
  // OPENAI_API_KEY is only sent to the official API host; compatible endpoints
  // need their own explicit LLM_API_KEY, or no key for a local model.
  let officialOpenAI = false;
  try { const url = new URL(baseUrl); officialOpenAI = url.protocol === "https:" && url.hostname === "api.openai.com"; } catch { /* unconfigured */ }
  const key = apiKey !== undefined ? (apiKey || "") : (process.env.LLM_API_KEY || (officialOpenAI ? process.env.OPENAI_API_KEY : "") || "");
  // Opt-in Arvan authentication. Never send a machine-user key to an arbitrary host.
  // The full value from Arvan IAM has the form "apikey <token>".
  const arvan = authScheme === "arvan-apikey";
  if (!["bearer", "arvan-apikey"].includes(authScheme)) throw configError("Unsupported LLM authentication scheme");
  if (arvan) {
    let target;
    try { target = new URL(baseUrl); } catch { throw configError("Invalid Arvan API URL"); }
    if (target.protocol !== "https:" || target.hostname !== "api.arvancloudai.ir" ||
        target.port || target.pathname.replace(/\\/+$/, "") !== "/v1" ||
        target.search || target.hash) {
      throw configError("Arvan API authentication requires the verified https://api.arvancloudai.ir/v1 endpoint");
    }
    if (!/^apikey [^\\s]+$/.test(key)) {
      throw configError("Arvan IAM key must include the 'apikey ' prefix and contain no whitespace");
    }
  }
  const configured = !!baseUrl && (!officialOpenAI || !!key) && (!arvan || !!key);
  return {
    id: "openai-compatible",
    baseUrl,
    defaultModel,
    repairModel,
    configured,
    models,

    async complete({ model, maxTokens, temperature = 0, images = [], prompt, extraText, signal }) {
      if (!configured) throw configError(
        "آدرس مدل تنظیم نشده یا کلید API سرویس OpenAI موجود نیست.");

      const content = [];
      for (const im of images) {
        content.push({ type: "text", text: `--- ${im.label || "IMAGE"} ---` });
        content.push({ type: "image_url", image_url: {
          url: `data:${im.mediaType || "image/jpeg"};base64,${im.data}` } });
      }
      content.push({ type: "text", text: prompt });
      if (extraText) content.push({ type: "text", text: extraText });

      const res = await fetchImpl(`${trim(baseUrl)}/chat/completions`, {
        method: "POST",
        redirect: "error",
        signal,
        headers: { "content-type": "application/json", authorization: arvan ? key : `Bearer ${key || "not-needed"}` },
        body: JSON.stringify({
          model: model || defaultModel,
          max_tokens: maxTokens,
          temperature,
          stream: true,
          stream_options: { include_usage: true },
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          messages: [{ role: "user", content }],
        }),
      });

      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw upstreamError(`LLM ${res.status}: ${t.slice(0, 250)}`, res.status, t, model || defaultModel);
      }

      let text = "", usage = {}, finish = null;
      await readSse(res.body, (ev) => {
        const choice = ev.choices?.[0];
        if (choice?.delta?.content) text += choice.delta.content;
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (ev.usage) {
          if (ev.usage.prompt_tokens != null) usage.input_tokens = ev.usage.prompt_tokens;
          if (ev.usage.completion_tokens != null) usage.output_tokens = ev.usage.completion_tokens;
        }
        if (ev.error) throw upstreamError("LLM stream error: " + JSON.stringify(ev.error).slice(0, 250));
      });

      return {
        text,
        usage,
        // "length" is this API's way of saying the token ceiling was hit; the
        // rest of the app only knows Anthropic's vocabulary for it.
        stopReason: finish === "length" ? "max_tokens" : finish,
        model: model || defaultModel,
      };
    },
  };
}

/**
 * A self-hosted deployment serves whatever it was started with, so the model
 * list is configuration rather than a fixed catalogue. LLM_MODELS holds
 * `id|label|note` entries separated by commas.
 */
function modelsFromEnv(defaultModel, repairModel) {
  const raw = process.env.LLM_MODELS;
  if (raw) {
    return raw.split(",").map((entry) => {
      const [id, label, note] = entry.split("|").map((x) => (x || "").trim());
      return { id, label: label || id, note: note || "" };
    }).filter((m) => m.id);
  }
  const uniq = [...new Set([defaultModel, repairModel].filter(Boolean))];
  return uniq.map((id) => ({ id, label: id.split("/").pop(), note: "از LLM_MODEL" }));
}

const trim = (u) => String(u).replace(/\/+$/, "");
const configError = (msg) => Object.assign(new Error(msg), { status: 400, code: "LLM_NOT_CONFIGURED" });
const upstreamError = (msg, status = 502, raw = "", model = "") =>
  Object.assign(new Error(msg), { status: 502, code: "LLM_UPSTREAM", upstreamStatus: status, raw, model });
