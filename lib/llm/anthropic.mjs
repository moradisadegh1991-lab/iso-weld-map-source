/**
 * Anthropic adapter.
 *
 * Streams on purpose: a long generation on a slow drawing would otherwise sit
 * behind an idle connection long enough for the platform to cut it.
 */
import { readSse } from "./sse.mjs";

export function createAnthropicProvider({
  apiKey = process.env.ANTHROPIC_API_KEY,
  baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
  defaultModel = process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
  repairModel = process.env.ANTHROPIC_REPAIR_MODEL || "claude-opus-5",
  fetchImpl = fetch,
} = {}) {
  return {
    id: "anthropic",
    defaultModel,
    repairModel,
    configured: !!apiKey,
    models: [
      { id: "claude-opus-5", label: "Opus 5", note: "دقیق‌ترین — برای نقشه‌های شلوغ" },
      { id: "claude-sonnet-5", label: "Sonnet 5", note: "پیش‌فرض — تعادل دقت و سرعت" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", note: "سریع — فقط برای نقشه‌های ساده" },
    ],

    async complete({ model, maxTokens, temperature = 0, images = [], prompt, extraText, signal }) {
      if (!apiKey) throw configError(
        "ANTHROPIC_API_KEY تنظیم نشده. آن را در متغیرهای محیطی سرور بگذارید.");

      const content = [];
      for (const im of images) {
        content.push({ type: "text", text: `--- ${im.label || "IMAGE"} ---` });
        content.push({ type: "image", source: {
          type: "base64", media_type: im.mediaType || "image/jpeg", data: im.data } });
      }
      content.push({ type: "text", text: prompt });
      if (extraText) content.push({ type: "text", text: extraText });

      const res = await fetchImpl(`${baseUrl}/messages`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-api-key": apiKey,
                   "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: model || defaultModel,
          max_tokens: maxTokens,
          temperature,
          stream: true,
          messages: [
            { role: "user", content },
            // Prefilling the assistant turn with "{" makes prose physically
            // impossible: the model can only continue the JSON object.
            { role: "assistant", content: "{" },
          ],
        }),
      });

      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw upstreamError(`Anthropic API ${res.status}: ${t.slice(0, 250)}`, res.status, t, model || defaultModel);
      }

      let text = "", usage = {}, stopReason = null, streamError = null;
      await readSse(res.body, (ev) => {
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text += ev.delta.text;
        // Read each number only from the event that actually carries it:
        // merging the two usage objects blindly used to swap them around.
        if (ev.type === "message_start" && ev.message?.usage?.input_tokens != null) {
          usage.input_tokens = ev.message.usage.input_tokens;
        }
        if (ev.type === "message_delta") {
          if (ev.usage?.output_tokens != null) usage.output_tokens = ev.usage.output_tokens;
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        }
        if (ev.type === "error") {
          streamError = JSON.stringify(ev.error).slice(0, 250);
          return false;
        }
      });
      if (streamError) throw upstreamError("Anthropic stream error: " + streamError, 502);

      // The assistant turn was prefilled with "{", so put it back.
      return { text: text ? "{" + text : "", usage, stopReason, model: model || defaultModel };
    },
  };
}

const configError = (msg) => Object.assign(new Error(msg), { status: 400, code: "LLM_NOT_CONFIGURED" });
const upstreamError = (msg, status = 502, raw = "", model = "") =>
  Object.assign(new Error(msg), { status: 502, code: "LLM_UPSTREAM", upstreamStatus: status, raw, model });
