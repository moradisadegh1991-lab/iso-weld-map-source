#!/usr/bin/env node
/**
 * Provider layer tests (EPIC-6).
 *
 * Both adapters are driven against a fake transport that replays a real SSE
 * stream, so the parsing, the usage accounting and the stop-reason mapping
 * are all covered without a model, a key or a network.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { parseLoose, cleanJsonText } from "../../lib/llm/parse.mjs";
import { createAnthropicProvider } from "../../lib/llm/anthropic.mjs";
import { createOpenAiCompatProvider } from "../../lib/llm/openai-compat.mjs";
import { createLlmClient } from "../../lib/llm/index.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** A fetch that replays the given SSE events and records what it was sent. */
function fakeSse(events, { ok = true, status = 200, text = "" } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    if (!ok) return { ok: false, status, body: null, text: async () => text };
    const payload = events.map((e) => `data: ${JSON.stringify(e)}\n`).join("\n") + "\ndata: [DONE]\n\n";
    const bytes = new TextEncoder().encode(payload);
    let sent = false;
    return {
      ok: true,
      status: 200,
      body: { getReader: () => ({
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
      }) },
    };
  };
  impl.calls = calls;
  return impl;
}

// ── parsing ──────────────────────────────────────────────────────────────

test("a complete object parses", async () => {
  equal(parseLoose('{"a":1,"b":[1,2]}'), { a: 1, b: [1, 2] });
});

test("an object cut off mid-array is closed and salvaged", async () => {
  const out = parseLoose('{"nodes":[{"id":"N1"},{"id":"N2"}');
  equal(out.nodes.map((n) => n.id), ["N1", "N2"], "incomplete beats nothing at all");
});

test("a generation cut mid-string drops the half-written value", async () => {
  const out = parseLoose('{"meta":{"drawingNo":"SW 2650');
  assert(out && out.meta, "the outer structure survives");
});

test("a dangling key with no value is discarded", async () => {
  const out = parseLoose('{"a":1,"b":');
  equal(out, { a: 1 });
});

test("irrecoverable output returns null rather than throwing", async () => {
  equal(parseLoose("not json at all"), null);
});

test("code fences and preamble are stripped", async () => {
  equal(cleanJsonText('```json\n{"a":1}\n```'), '{"a":1}');
  equal(cleanJsonText('here you go: {"a":1} hope that helps'), '{"a":1}');
});

// ── Anthropic adapter ────────────────────────────────────────────────────

const anthropicStream = [
  { type: "message_start", message: { usage: { input_tokens: 24000, output_tokens: 1 } } },
  { type: "content_block_delta", delta: { type: "text_delta", text: '"meta":{"nps":36}' } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "}" } },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3900 } },
];

test("the assistant prefill is put back, so the text is a whole object", async () => {
  const fetchImpl = fakeSse(anthropicStream);
  const p = createAnthropicProvider({ apiKey: "k", fetchImpl });
  const out = await p.complete({ maxTokens: 4000, prompt: "P", images: [{ label: "FULL", data: "AAA" }] });
  equal(parseLoose(out.text), { meta: { nps: 36 } });
  assert(fetchImpl.calls[0].body.messages[1].content === "{", "the assistant turn is prefilled with a brace");
});

test("token counts are read only from the event that carries them", async () => {
  // Merging the two usage objects blindly used to swap the numbers around.
  const p = createAnthropicProvider({ apiKey: "k", fetchImpl: fakeSse(anthropicStream) });
  const out = await p.complete({ maxTokens: 4000, prompt: "P", images: [{ data: "A" }] });
  equal(out.usage, { input_tokens: 24000, output_tokens: 3900 });
});

test("hitting the token ceiling is reported as max_tokens", async () => {
  const p = createAnthropicProvider({ apiKey: "k", fetchImpl: fakeSse([
    { type: "content_block_delta", delta: { type: "text_delta", text: '"a":1' } },
    { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 4000 } },
  ]) });
  equal((await p.complete({ maxTokens: 4000, prompt: "P", images: [{ data: "A" }] })).stopReason, "max_tokens");
});

test("images are sent as base64 blocks with their media type", async () => {
  const fetchImpl = fakeSse(anthropicStream);
  const p = createAnthropicProvider({ apiKey: "k", fetchImpl });
  await p.complete({ maxTokens: 10, prompt: "P",
    images: [{ label: "TOP-LEFT TILE", data: "XYZ", mediaType: "image/png" }] });
  const blocks = fetchImpl.calls[0].body.messages[0].content;
  equal(blocks[0].text, "--- TOP-LEFT TILE ---");
  equal(blocks[1].source, { type: "base64", media_type: "image/png", data: "XYZ" });
});

test("an error event aborts rather than returning half an answer", async () => {
  const p = createAnthropicProvider({ apiKey: "k", fetchImpl: fakeSse([
    { type: "content_block_delta", delta: { type: "text_delta", text: '"a":1' } },
    { type: "error", error: { type: "overloaded_error" } },
  ]) });
  await throws(() => p.complete({ maxTokens: 10, prompt: "P", images: [{ data: "A" }] }), "LLM_UPSTREAM");
});

test("an unconfigured provider says so instead of calling out", async () => {
  const p = createAnthropicProvider({ apiKey: "", fetchImpl: fakeSse([]) });
  equal(p.configured, false);
  const e = await throws(() => p.complete({ maxTokens: 10, prompt: "P", images: [{ data: "A" }] }),
    "LLM_NOT_CONFIGURED");
  equal(e.status, 400, "a missing key is a configuration problem, not an upstream failure");
});

test("an upstream rejection carries its status and body for diagnosis", async () => {
  const p = createAnthropicProvider({ apiKey: "k",
    fetchImpl: fakeSse([], { ok: false, status: 401, text: "invalid x-api-key" }) });
  const e = await throws(() => p.complete({ maxTokens: 10, prompt: "P", images: [{ data: "A" }] }));
  equal(e.upstreamStatus, 401);
  assert(e.message.includes("401"));
});

// ── OpenAI-compatible adapter (vLLM) ─────────────────────────────────────

const vllmStream = [
  { choices: [{ delta: { content: '{"meta":' } }] },
  { choices: [{ delta: { content: '{"nps":36}}' } }] },
  { choices: [{ delta: {}, finish_reason: "stop" }] },
  { usage: { prompt_tokens: 18000, completion_tokens: 2200 } },
];

test("vLLM output needs no prefill and still yields a whole object", async () => {
  const fetchImpl = fakeSse(vllmStream);
  const p = createOpenAiCompatProvider({ baseUrl: "http://vllm:8000/v1", fetchImpl });
  const out = await p.complete({ maxTokens: 4000, prompt: "P", images: [{ data: "A" }] });
  equal(parseLoose(out.text), { meta: { nps: 36 } });
  equal(out.usage, { input_tokens: 18000, output_tokens: 2200 });
  equal(out.stopReason, "stop");
});

test("JSON mode is requested, since the prefill trick does not travel", async () => {
  const fetchImpl = fakeSse(vllmStream);
  const p = createOpenAiCompatProvider({ baseUrl: "http://vllm:8000/v1", fetchImpl });
  await p.complete({ maxTokens: 10, prompt: "P", images: [{ data: "A" }] });
  const body = fetchImpl.calls[0].body;
  equal(body.response_format, { type: "json_object" });
  equal(body.stream_options, { include_usage: true }, "usage only arrives if you ask");
  equal(body.messages.length, 1, "no assistant turn to prefill");
});

test("images travel as data URIs", async () => {
  const fetchImpl = fakeSse(vllmStream);
  const p = createOpenAiCompatProvider({ baseUrl: "http://vllm:8000/v1", fetchImpl });
  await p.complete({ maxTokens: 10, prompt: "P", images: [{ data: "XYZ", mediaType: "image/png" }] });
  const parts = fetchImpl.calls[0].body.messages[0].content;
  equal(parts[1].image_url.url, "data:image/png;base64,XYZ");
});

test("finish_reason 'length' maps onto the vocabulary the app already speaks", async () => {
  const p = createOpenAiCompatProvider({ baseUrl: "http://v/v1", fetchImpl: fakeSse([
    { choices: [{ delta: { content: '{"a":1' } }] },
    { choices: [{ delta: {}, finish_reason: "length" }] },
  ]) });
  equal((await p.complete({ maxTokens: 10, prompt: "P", images: [{ data: "A" }] })).stopReason, "max_tokens");
});

test("a trailing slash on the base url does not produce a double slash", async () => {
  const fetchImpl = fakeSse(vllmStream);
  const p = createOpenAiCompatProvider({ baseUrl: "http://vllm:8000/v1/", fetchImpl });
  await p.complete({ maxTokens: 10, prompt: "P", images: [{ data: "A" }] });
  equal(fetchImpl.calls[0].url, "http://vllm:8000/v1/chat/completions");
});

test("the served model list is configuration, not a fixed catalogue", async () => {
  const before = process.env.LLM_MODELS;
  process.env.LLM_MODELS = "Qwen/Qwen3-32B|Qwen3 32B|متنی, Qwen/Qwen2.5-VL-32B|Qwen VL|بینایی";
  const p = createOpenAiCompatProvider({ baseUrl: "http://v/v1" });
  equal(p.models.map((m) => m.label), ["Qwen3 32B", "Qwen VL"]);
  equal(p.models[1].note, "بینایی");
  if (before === undefined) delete process.env.LLM_MODELS; else process.env.LLM_MODELS = before;
});

// ── provider selection ───────────────────────────────────────────────────

test("the provider is chosen by configuration alone", async () => {
  equal(createLlmClient({ provider: "anthropic", apiKey: "k" }).id, "anthropic");
  equal(createLlmClient({ provider: "openai-compatible", baseUrl: "http://v/v1" }).id, "openai-compatible");
});

test("an unknown provider fails loudly at startup, not on the first drawing", async () => {
  const e = await throws(() => createLlmClient({ provider: "telepathy" }), "LLM_UNKNOWN_PROVIDER");
  assert(e.message.includes("anthropic"), "and lists what it does know");
});

// ── the route ────────────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "llm-db-"));
const extractRoute = await import("../../app/api/extract/route.js");
const modelsRoute = await import("../../app/api/models/route.js");

const post = (body, as = "kc|alice") => new Request("http://x/api/extract", {
  method: "POST",
  headers: { authorization: `Bearer ${as}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("extraction requires an identity, now that the key is the server's", async () => {
  const res = await extractRoute.POST(new Request("http://x/api/extract", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pass: "meta", images: [{ data: "A" }] }),
  }));
  equal(res.status, 401, "an open endpoint would let anyone spend the server's key");
});

test("an apiKey in the request body is simply not read any more", async () => {
  const before = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const res = await extractRoute.POST(post({ pass: "meta", images: [{ data: "A" }], apiKey: "sk-ant-smuggled" }));
  const body = await res.json();
  equal(res.status, 400);
  equal(body.code, "LLM_NOT_CONFIGURED", "a key from the browser cannot configure the server");
  if (before !== undefined) process.env.ANTHROPIC_API_KEY = before;
});

test("an empty image list is refused before any model is called", async () => {
  const res = await extractRoute.POST(post({ pass: "meta", images: [] }));
  equal(res.status, 400);
});

test("the model catalogue comes from the configured provider", async () => {
  const before = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "openai-compatible";
  process.env.LLM_BASE_URL = "http://vllm:8000/v1";
  process.env.LLM_MODEL = "Qwen/Qwen2.5-VL-32B-Instruct";
  const res = await modelsRoute.GET(new Request("http://x/api/models", {
    headers: { authorization: "Bearer kc|alice" } }));
  const body = await res.json();
  equal(body.provider, "openai-compatible");
  equal(body.configured, true);
  equal(body.defaultModel, "Qwen/Qwen2.5-VL-32B-Instruct");
  if (before === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = before;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
});

await run();
