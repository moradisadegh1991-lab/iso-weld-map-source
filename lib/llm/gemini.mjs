/**
 * Google Gemini adapter — the Gemini API's REST endpoint, no SDK.
 *
 *   LLM_PROVIDER=gemini  + GEMINI_API_KEY=…   (Google AI Studio)
 *
 * The owner's scripts (google-genai, gemini-*-flash, response_mime_type
 * "application/json") are this same call; here it goes through the shared
 * interface, so the isometric reading, the repair pass and document intake
 * use Gemini with no change above this file.
 *
 * What this adapter hides from its callers:
 *
 *   - JSON is asked for with generationConfig.responseMimeType — Gemini's
 *     JSON mode — and the reply still goes through cleanJsonText/parseLoose
 *     like every other provider's.
 *   - the stream is `streamGenerateContent?alt=sse`; each event carries a
 *     slice of candidates[0].content.parts. A reasoning model's thought parts
 *     (`thought: true`) are not the answer and are left out.
 *   - usageMetadata arrives on the events; prompt and candidate counts map
 *     onto input/output tokens (thinking tokens, which a reasoning model also
 *     spends from maxOutputTokens, are added to output).
 *   - finishReason "MAX_TOKENS" maps onto the "max_tokens" the app already
 *     reads; SAFETY / RECITATION / PROHIBITED_CONTENT are a refusal and are
 *     reported as an error, not as an empty drawing.
 *
 * GEMINI_BASE_URL exists for a relay: the Gemini API is not served to every
 * country, and a server that Google refuses (400 "User location is not
 * supported") can reach it through one.
 */
import { readSse } from "./sse.mjs";

// The catalogue as Google lists it in October 2026 (ai.google.dev/gemini-api/docs/models):
// the 2.5 family is limited to earlier users and 1.5 / 2.0 are shut down.
// GEMINI_MODELS replaces it, `id|label|note` entries separated by commas.
const CATALOGUE = [
  { id: "gemini-4-argon", label: "Gemini 4 Argon", note: "دقیق‌ترین — برای نقشه‌های شلوغ و پاس ترمیم" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "پیش‌فرض — تعادل دقت و سرعت" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "سریع و ارزان — فقط برای نقشه‌های ساده" },
];

const REFUSED = new Set(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

export function createGeminiProvider({
  apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
  defaultModel = process.env.GEMINI_MODEL || "gemini-3.8-flash",
  repairModel = process.env.GEMINI_REPAIR_MODEL || "gemini-4-argon",
  fetchImpl = fetch,
} = {}) {
  return {
    id: "gemini",
    defaultModel,
    repairModel,
    configured: !!apiKey,
    models: modelsFromEnv() || CATALOGUE,

    async complete({ model, maxTokens, temperature = 0, images = [], prompt, extraText, signal }) {
      if (!apiKey) throw configError(
        "GEMINI_API_KEY تنظیم نشده. کلید Google AI Studio را در متغیرهای محیطی سرور بگذارید.");
      const id = model || defaultModel;

      const parts = [];
      for (const im of images) {
        parts.push({ text: `--- ${im.label || "IMAGE"} ---` });
        parts.push({ inline_data: { mime_type: im.mediaType || "image/jpeg", data: im.data } });
      }
      parts.push({ text: prompt });
      if (extraText) parts.push({ text: extraText });

      const res = await fetchImpl(`${trim(baseUrl)}/models/${encodeURIComponent(id)}:streamGenerateContent?alt=sse`, {
        method: "POST",
        signal,
        // the key in a header, never in the URL, so it stays out of access logs
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature,
            responseMimeType: "application/json",
          },
        }),
      });

      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw upstreamError(`Gemini API ${res.status}: ${t.slice(0, 250)}`, res.status, t, id);
      }

      let text = "", usage = {}, finish = null, blocked = null;
      await readSse(res.body, (ev) => {
        if (ev.error) throw upstreamError("Gemini stream error: " + JSON.stringify(ev.error).slice(0, 250), 502, "", id);
        if (ev.promptFeedback?.blockReason) blocked = ev.promptFeedback.blockReason;
        const c = ev.candidates?.[0];
        for (const p of c?.content?.parts || []) if (typeof p.text === "string" && !p.thought) text += p.text;
        if (c?.finishReason) finish = c.finishReason;
        const u = ev.usageMetadata;
        if (u) {
          if (u.promptTokenCount != null) usage.input_tokens = u.promptTokenCount;
          if (u.candidatesTokenCount != null || u.thoughtsTokenCount != null) {
            usage.output_tokens = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
          }
        }
      });
      if (blocked || REFUSED.has(finish)) {
        throw upstreamError(`Gemini پاسخ را رد کرد (${blocked || finish}).`, 502, "", id);
      }

      return {
        text,
        usage,
        stopReason: finish === "MAX_TOKENS" ? "max_tokens" : finish === "STOP" ? "end_turn" : finish,
        model: id,
      };
    },
  };
}

function modelsFromEnv() {
  const raw = process.env.GEMINI_MODELS;
  if (!raw) return null;
  return raw.split(",").map((entry) => {
    const [id, label, note] = entry.split("|").map((x) => (x || "").trim());
    return { id, label: label || id, note: note || "" };
  }).filter((m) => m.id);
}

const trim = (u) => String(u).replace(/\/+$/, "");
const configError = (msg) => Object.assign(new Error(msg), { status: 400, code: "LLM_NOT_CONFIGURED" });
const upstreamError = (msg, status = 502, raw = "", model = "") =>
  Object.assign(new Error(msg), { status: 502, code: "LLM_UPSTREAM", upstreamStatus: status, raw, model });
