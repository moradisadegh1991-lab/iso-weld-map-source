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
  apiKey = process.env.LLM_API_KEY || "not-needed",
  defaultModel = process.env.LLM_MODEL || "Qwen/Qwen2.5-VL-32B-Instruct",
  repairModel = process.env.LLM_REPAIR_MODEL || process.env.LLM_MODEL || "Qwen/Qwen2.5-VL-32B-Instruct",
  jsonMode = process.env.LLM_JSON_MODE !== "off",
  fetchImpl = fetch,
} = {}) {
  return {
    id: "openai-compatible",
    defaultModel,
    repairModel,
    configured: !!baseUrl,
    models: modelsFromEnv(defaultModel, repairModel),

    async complete({ model, maxTokens, temperature = 0, images = [], prompt, extraText, signal }) {
      if (!baseUrl) throw configError(
        "LLM_BASE_URL تنظیم نشده. آدرس سرویس vLLM را در متغیرهای محیطی سرور بگذارید.");

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
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
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
