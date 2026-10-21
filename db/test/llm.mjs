#!/usr/bin/env node
/**
 * Provider layer tests (EPIC-6).
 *
 * Both adapters are driven against a fake transport that replays a real SSE
 * stream, so the parsing, the usage accounting and the stop-reason mapping
 * are all covered without a model, a key or a network.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { parseLoose, cleanJsonText } from "../../lib/llm/parse.mjs";
import { createAnthropicProvider } from "../../lib/llm/anthropic.mjs";
import { createOpenAiCompatProvider } from "../../lib/llm/openai-compat.mjs";
import { createGeminiProvider } from "../../lib/llm/gemini.mjs";
import { createLlmClient, createLlmRouter } from "../../lib/llm/index.mjs";
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
  { type: "content_block_delta", delta: { type: "text_delta", text: '{"meta":{"nps":36}' } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "}" } },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3900 } },
];

test("the request carries neither of the two things that are 400s now", async () => {
  // Both were in this request and both are rejected outright — not ignored —
  // by the models it actually runs on (Sonnet 5 by default, Opus 5 to repair):
  // the sampling parameters were removed, and so was assistant prefill. Either
  // one fails the call before a single drawing is read, which is why the
  // caller still passing `temperature: 0` must not reach the wire.
  const fetchImpl = fakeSse(anthropicStream);
  const p = createAnthropicProvider({ apiKey: "k", fetchImpl });
  const out = await p.complete({
    maxTokens: 4000, temperature: 0, prompt: "P", images: [{ label: "FULL", data: "AAA" }],
  });
  const body = fetchImpl.calls[0].body;

  assert(!("temperature" in body), "temperature must not be sent to Anthropic");
  assert(!("top_p" in body) && !("top_k" in body), "nor any other sampling parameter");
  equal(body.messages.length, 1, "one user turn, and no assistant turn to prefill");
  equal(body.messages[0].role, "user");

  // And the model's own braces are kept: nothing is prepended any more.
  equal(parseLoose(out.text), { meta: { nps: 36 } });
});

test("a fenced or chatty reply still parses, which is why the prefill is not missed", async () => {
  // What the prefill used to guarantee, cleanJsonText + parseLoose already do.
  const chatty = [
    { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: "content_block_delta", delta: { type: "text_delta",
      text: 'Here is the extraction:\n```json\n{"meta":{"nps":36}}\n```\nLet me know.' } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
  ];
  const p = createAnthropicProvider({ apiKey: "k", fetchImpl: fakeSse(chatty) });
  const out = await p.complete({ maxTokens: 4000, prompt: "P", images: [{ data: "A" }] });
  equal(parseLoose(cleanJsonText(out.text)), { meta: { nps: 36 } });
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

// ── Gemini adapter ───────────────────────────────────────────────────────

const geminiStream = [
  { candidates: [{ content: { role: "model", parts: [{ text: "checking the BOM first", thought: true }] } }] },
  { candidates: [{ content: { role: "model", parts: [{ text: '{"meta":{"nps":36}' }] } }],
    usageMetadata: { promptTokenCount: 18000, candidatesTokenCount: 5 } },
  { candidates: [{ content: { role: "model", parts: [{ text: "}" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 18000, candidatesTokenCount: 3100, thoughtsTokenCount: 900 } },
];

test("gemini: the answer is the text parts, not the model's thoughts, and parses whole", async () => {
  const fetchImpl = fakeSse(geminiStream);
  const out = await createGeminiProvider({ apiKey: "g", fetchImpl }).complete({ maxTokens: 8000, prompt: "p" });
  equal(out.text, '{"meta":{"nps":36}}');
  equal(parseLoose(out.text), { meta: { nps: 36 } });
  equal(out.stopReason, "end_turn");
  equal(out.usage, { input_tokens: 18000, output_tokens: 4000 }, "thinking tokens are spent from the same ceiling, so they count");
});

test("gemini: JSON mode, the token ceiling and the streaming endpoint; the key in a header, never in the URL", async () => {
  const fetchImpl = fakeSse(geminiStream);
  await createGeminiProvider({ apiKey: "secret-key", fetchImpl, baseUrl: "https://relay.example/v1beta/" })
    .complete({ model: "gemini-3.8-flash", maxTokens: 12000, prompt: "p" });
  const c = fetchImpl.calls[0];
  equal(c.url, "https://relay.example/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
  assert(!c.url.includes("secret-key"), "the key does not travel in the URL");
  equal(c.init.headers["x-goog-api-key"], "secret-key");
  equal(c.body.generationConfig.responseMimeType, "application/json");
  equal(c.body.generationConfig.maxOutputTokens, 12000);
});

test("gemini: images travel as inline data with their media type, labelled, before the prompt", async () => {
  const fetchImpl = fakeSse(geminiStream);
  await createGeminiProvider({ apiKey: "g", fetchImpl }).complete({ maxTokens: 100, prompt: "read it",
    images: [{ label: "OVERVIEW", mediaType: "image/png", data: "AAAA" }] });
  const parts = fetchImpl.calls[0].body.contents[0].parts;
  equal(parts[0], { text: "--- OVERVIEW ---" });
  equal(parts[1], { inline_data: { mime_type: "image/png", data: "AAAA" } });
  equal(parts[2], { text: "read it" });
});

test("gemini: MAX_TOKENS maps onto max_tokens, so a cut-off drawing is reported as truncated", async () => {
  const fetchImpl = fakeSse([{ candidates: [{ content: { parts: [{ text: '{"nodes":[' }] }, finishReason: "MAX_TOKENS" }] }]);
  equal((await createGeminiProvider({ apiKey: "g", fetchImpl }).complete({ maxTokens: 10, prompt: "p" })).stopReason, "max_tokens");
});

test("gemini: a safety refusal is an error, not an empty drawing", async () => {
  const fetchImpl = fakeSse([{ candidates: [{ finishReason: "SAFETY" }] }]);
  const e = await throws(() => createGeminiProvider({ apiKey: "g", fetchImpl }).complete({ maxTokens: 10, prompt: "p" }), "LLM_UPSTREAM");
  assert(e.message.includes("SAFETY"), e.message);
});

test("gemini: unconfigured says so without calling out; an upstream refusal keeps its status and body", async () => {
  const fetchImpl = fakeSse([]);
  await throws(() => createGeminiProvider({ apiKey: "", fetchImpl }).complete({ maxTokens: 10, prompt: "p" }), "LLM_NOT_CONFIGURED");
  equal(fetchImpl.calls.length, 0);
  const denied = fakeSse([], { ok: false, status: 400, text: '{"error":{"message":"User location is not supported for the API use."}}' });
  const e = await throws(() => createGeminiProvider({ apiKey: "g", fetchImpl: denied }).complete({ maxTokens: 10, prompt: "p" }), "LLM_UPSTREAM");
  equal(e.upstreamStatus, 400);
  assert(e.message.includes("User location is not supported"), "the reason Google gave reaches the person");
});

test("gemini: the model list is Google's current catalogue, or GEMINI_MODELS when set", async () => {
  const before = process.env.GEMINI_MODELS;
  delete process.env.GEMINI_MODELS;
  const p = createGeminiProvider({ apiKey: "g" });
  assert(p.models.some((m) => m.id === p.defaultModel), "the default is in the list a person picks from");
  assert(!p.models.some((m) => /^gemini-(1\.5|2\.0)/.test(m.id)), "no model Google has shut down");
  process.env.GEMINI_MODELS = "gemini-x|X|test";
  equal(createGeminiProvider({ apiKey: "g" }).models, [{ id: "gemini-x", label: "X", note: "test" }]);
  if (before === undefined) delete process.env.GEMINI_MODELS; else process.env.GEMINI_MODELS = before;
});

// ── provider selection ───────────────────────────────────────────────────

test("the provider is chosen by configuration alone", async () => {
  equal(createLlmClient({ provider: "anthropic", apiKey: "k" }).id, "anthropic");
  equal(createLlmClient({ provider: "openai-compatible", baseUrl: "http://v/v1" }).id, "openai-compatible");
  equal(createLlmClient({ provider: "gemini", apiKey: "g" }).id, "gemini");
});

test("an unknown provider fails loudly at startup, not on the first drawing", async () => {
  const e = await throws(() => createLlmClient({ provider: "telepathy" }), "LLM_UNKNOWN_PROVIDER");
  assert(e.message.includes("anthropic"), "and lists what it does know");
});

// ── the route ────────────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("llm-db-");
const extractRoute = await import("../../app/api/extract/route.js");
const modelsRoute = await import("../../app/api/models/route.js");
const usageRoute = await import("../../app/api/llm-usage/route.js");
const { getDb } = await import("../../lib/server/db.mjs");
const { ensureUser, createProject, addMember } = await import("../../lib/db/repos/projects.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const { pricesFromEnv, costOf, monthlyLimit, recordUsage, usageReport } = await import("../../lib/llm/accounting.mjs");
const relay = await import("../../deploy/gemini-relay/api/relay.js");

// the reading is accounted to a project: alice runs it there, bob only views
const db = await getDb();
const alice = await ensureUser(db, { subject: "kc|alice", email: "alice@x" });
const bob = await ensureUser(db, { subject: "kc|bob", email: "bob@x" });
const project = await createProject(db, { code: "LLM", name: "accounting", ownerUserId: alice.id });
await addMember(db, { projectId: project.id, userId: bob.id, role: "viewer" });
const projectId = project.id;

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
  const res = await extractRoute.POST(post({ projectId, pass: "meta", images: [{ data: "A" }], apiKey: "sk-ant-smuggled" }));
  const body = await res.json();
  equal(res.status, 400);
  equal(body.code, "LLM_NOT_CONFIGURED", "a key from the browser cannot configure the server");
  if (before !== undefined) process.env.ANTHROPIC_API_KEY = before;
});

test("an empty image list is refused before any model is called", async () => {
  const res = await extractRoute.POST(post({ projectId, pass: "meta", images: [] }));
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

// ── accounting (lib/llm/accounting.mjs, migration 082) ───────────────────

/** Run the route against a Gemini that answers with these SSE events (or this status). */
async function withGemini(events, fn, { status = 200, text = "", env = {} } = {}) {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  Object.assign(process.env, { LLM_PROVIDER: "gemini", GEMINI_API_KEY: "g" }, env);
  const fake = fakeSse(events, { ok: status === 200, status, text });
  globalThis.fetch = fake;
  try { return await fn(fake); } finally {
    globalThis.fetch = saved.fetch;
    for (const k of Object.keys(process.env)) if (!(k in saved.env)) delete process.env[k];
    Object.assign(process.env, saved.env);
  }
}
const usageRows = () => withProject(db, projectId, async () => (await db.query(
  "SELECT * FROM llm_usage WHERE project_id = $1 ORDER BY at", [projectId])).rows);

test("a reading names its project: none, or one the caller is not in, is refused before the model", async () => {
  await withGemini(geminiStream, async (fake) => {
    equal((await extractRoute.POST(post({ pass: "meta", images: [{ data: "A" }] }))).status, 400);
    equal((await extractRoute.POST(post({ projectId, pass: "meta", images: [{ data: "A" }] }, "kc|bob"))).status, 403, "a viewer may not spend tokens");
    equal(fake.calls.length, 0);
  });
});

test("every call is written down: who, which model and pass, the tokens spent", async () => {
  const before = (await usageRows()).length;
  await withGemini(geminiStream, async () => {
    const res = await extractRoute.POST(post({ projectId, pass: "meta", images: [{ data: "A" }] }));
    equal(res.status, 200);
  });
  const rows = await usageRows();
  equal(rows.length, before + 1);
  const r = rows.at(-1);
  equal([r.user_id, r.provider, r.via, r.model, r.pass, r.input_tokens, r.output_tokens, r.ok],
    [alice.id, "gemini", "direct", "gemini-3.8-flash", "meta", 18000, 4000, true]);
});

test("a failed call is a call: written down, its tokens unknown rather than zero", async () => {
  await withGemini([], async () => {
    const res = await extractRoute.POST(post({ projectId, pass: "nodes", images: [{ data: "A" }] }));
    equal(res.status, 502);
  }, { status: 400, text: '{"error":{"message":"User location is not supported for the API use."}}' });
  const r = (await usageRows()).at(-1);
  equal([r.pass, r.ok, r.error_code, r.input_tokens, r.output_tokens], ["nodes", false, "LLM_UPSTREAM", null, null]);
});

test("a project past its monthly allowance is refused before the model is called", async () => {
  await withGemini(geminiStream, async (fake) => {
    const res = await extractRoute.POST(post({ projectId, pass: "meta", images: [{ data: "A" }] }));
    equal(res.status, 429);
    equal((await res.json()).code, "LLM_MONTHLY_LIMIT");
    equal(fake.calls.length, 0, "nothing spent past the allowance");
  }, { env: { LLM_MONTHLY_TOKENS: "22000" } });   // 22000 spent so far this month
  await withGemini(geminiStream, async (fake) => {
    equal((await extractRoute.POST(post({ projectId, pass: "meta", images: [{ data: "A" }] }))).status, 200);
    equal(fake.calls.length, 1);
  }, { env: { LLM_MONTHLY_TOKENS: "22001" } });
});

test("prices: parsed from LLM_PRICES; no price, no cost — never a guessed one", async () => {
  const p = pricesFromEnv("gemini-3.8-flash|0.30|2.50, bad|x|1 ,gemini-4-argon|2|12");
  equal(p, { "gemini-3.8-flash": { input: 0.3, output: 2.5 }, "gemini-4-argon": { input: 2, output: 12 } });
  equal(costOf({ model: "gemini-3.8-flash", input: 1_000_000, output: 200_000 }, p), 0.8);
  equal(costOf({ model: "gemini-3.5-flash-lite", input: 10, output: 10 }, p), null);
  equal(costOf({ model: "gemini-3.8-flash", input: null, output: 10 }, p), null, "unknown tokens have no cost");
  equal(monthlyLimit(""), null); equal(monthlyLimit("abc"), null); equal(monthlyLimit("5e6"), 5_000_000);
});

test("the account: totals by month, model, person and pass; unknown calls counted apart; cost only where priced", async () => {
  await withProject(db, projectId, () => recordUsage(db, { projectId, userId: bob.id, provider: "gemini", via: "relay",
    model: "gemini-3.5-flash-lite", pass: "repair", usage: { input_tokens: 1000, output_tokens: 500 }, ok: true }));
  const r = await withProject(db, projectId, () => usageReport(db, { projectId, prices: pricesFromEnv("gemini-3.8-flash|1|10"), limit: 100000 }));
  equal(r.total.calls, 4, "two readings, one failed call, bob's repair pass; the refused one never reached a model");
  equal(r.total.unknown, 1, "the failed call");
  equal(r.total.tokens, 18000 * 2 + 4000 * 2 + 1500);
  equal(r.byModel.find((m) => m.key === "gemini-3.8-flash").cost, (36000 * 1 + 8000 * 10) / 1e6);
  equal(r.byModel.find((m) => m.key === "gemini-3.5-flash-lite").cost, null, "an unpriced model shows no cost");
  equal(r.byUser.map((u) => u.key).sort(), ["alice@x", "bob@x"]);
  equal(r.month, { tokens: 45500, limit: 100000, left: 54500 });
  equal(r.recent[0].via, "relay");
});

test("the account is the project administrator's to read; usage rows cannot be changed or removed", async () => {
  const get = (as) => usageRoute.GET(new Request(`http://x/api/llm-usage?projectId=${projectId}`, { headers: { authorization: `Bearer ${as}` } }));
  equal((await get("kc|alice")).status, 200);
  equal((await get("kc|bob")).status, 403);
  const e = await withProject(db, projectId, () => db.query("UPDATE llm_usage SET input_tokens = 0 WHERE project_id = $1", [projectId])).catch((x) => x);
  assert(e instanceof Error && /permission denied/i.test(e.message), `an UPDATE is refused: ${e?.message}`);
  const d = await withProject(db, projectId, () => db.query("DELETE FROM llm_usage WHERE project_id = $1", [projectId])).catch((x) => x);
  assert(d instanceof Error && /permission denied/i.test(d.message), `a DELETE is refused: ${d?.message}`);
});

// ── several providers at once: the model picked decides who answers ──────

/** Run fn with these environment variables (undefined removes one), then put them back. */
async function withEnv(env, fn) {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}
const claudeUnsetGeminiSet = { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: undefined, GEMINI_API_KEY: "g",
  GEMINI_RELAY_TOKEN: undefined, LLM_PROVIDERS: undefined, LLM_BASE_URL: undefined };

test("the catalogue lists Claude and Gemini together, each model with its provider and whether it can run", async () => {
  await withEnv(claudeUnsetGeminiSet, async () => {
    const body = await (await modelsRoute.GET(new Request("http://x/api/models", {
      headers: { authorization: "Bearer kc|alice" } }))).json();
    equal(body.providers.map((p) => [p.id, p.configured]), [["anthropic", false], ["gemini", true]]);
    const of = (id) => body.models.find((m) => m.id === id);
    equal([of("claude-sonnet-5").provider, of("claude-sonnet-5").configured], ["anthropic", false]);
    equal([of("gemini-3.8-flash").provider, of("gemini-3.8-flash").configured], ["gemini", true]);
    equal([body.provider, body.defaultModel, body.repairModel], ["gemini", "gemini-3.8-flash", "gemini-4-argon"],
      "an unconfigured default provider does not preselect a model that cannot run");
  });
  await withEnv({ ...claudeUnsetGeminiSet, LLM_PROVIDERS: "anthropic" }, async () => {
    equal(createLlmRouter().catalogue().providers.map((p) => p.id), ["anthropic"], "LLM_PROVIDERS limits what is offered");
  });
  await withEnv({ ...claudeUnsetGeminiSet, LLM_PROVIDERS: "anthropic,telepathy" }, async () => {
    await throws(() => createLlmRouter(), "LLM_UNKNOWN_PROVIDER");
  });
});

test("routing: a Gemini model goes to Gemini, a Claude model to Anthropic, whatever LLM_PROVIDER says", async () => {
  await withEnv({ ...claudeUnsetGeminiSet, ANTHROPIC_API_KEY: "a" }, async () => {
    const r = createLlmRouter();
    equal(r.clientFor("gemini-4-argon").id, "gemini");
    equal(r.clientFor("gemini-9-unlisted").id, "gemini", "by name when the catalogue does not list it");
    equal(r.clientFor("claude-opus-5").id, "anthropic");
    equal(r.clientFor(undefined).id, "anthropic", "no model: the default provider");
    equal(r.clientFor("Qwen/Qwen2.5-VL").id, "anthropic", "an unknown name: the default provider");
  });
});

test("a reading with a Gemini model is answered by Gemini and written down as Gemini's, with Claude the default", async () => {
  const before = (await usageRows()).length;
  await withGemini(geminiStream, async (fake) => {
    const res = await extractRoute.POST(post({ projectId, pass: "meta", model: "gemini-4-argon", images: [{ data: "A" }] }));
    equal(res.status, 200);
    equal(fake.calls.length, 1);
    assert(fake.calls[0].url.includes("/models/gemini-4-argon:streamGenerateContent"), fake.calls[0].url);
  }, { env: { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "" } });
  const rows = await usageRows();
  equal(rows.length, before + 1);
  equal([rows.at(-1).provider, rows.at(-1).model], ["gemini", "gemini-4-argon"]);
});

test("a model whose provider is not set up is refused before any call, naming that provider", async () => {
  await withGemini(geminiStream, async (fake) => {
    const res = await extractRoute.POST(post({ projectId, pass: "meta", model: "claude-opus-5", images: [{ data: "A" }] }));
    equal(res.status, 400);
    equal((await res.json()).code, "LLM_NOT_CONFIGURED");
    equal(fake.calls.length, 0, "a Claude model is not quietly sent to Gemini");
  }, { env: { LLM_PROVIDER: "gemini", ANTHROPIC_API_KEY: "" } });
});

// ── the relay (deploy/gemini-relay) and the provider's relay mode ─────────

test("relay mode: the server sends the relay token, never the Gemini key", async () => {
  const fetchImpl = fakeSse(geminiStream);
  const p = createGeminiProvider({ apiKey: "real-key", relayToken: "relay-secret", baseUrl: "https://r.vercel.app/v1beta", fetchImpl });
  equal([p.configured, p.via], [true, "relay"]);
  await p.complete({ maxTokens: 10, prompt: "p" });
  const h = fetchImpl.calls[0].init.headers;
  equal(h["x-relay-token"], "relay-secret");
  assert(!("x-goog-api-key" in h), "the key, if one is set here too, does not travel to the relay");
  equal(createGeminiProvider({ relayToken: "t", apiKey: "" }).configured, true, "a relay token alone configures it");
});

async function relayCall({ token = "relay-secret", path = "models/gemini-3.8-flash:streamGenerateContent", alt = "sse", env = {}, upstream } = {}) {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  Object.assign(process.env, { GEMINI_API_KEY: "real-key", RELAY_TOKEN: "relay-secret" }, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return upstream || new Response('data: {"candidates":[]}\n\n', { status: 200, headers: { "content-type": "text/event-stream" } }); };
  try {
    const qs = new URLSearchParams({ path, ...(alt ? { alt } : {}) });
    const res = await relay.POST(new Request(`https://r.vercel.app/api/relay?${qs}`, {
      method: "POST", headers: token ? { "x-relay-token": token, "content-type": "application/json" } : { "content-type": "application/json" },
      body: '{"contents":[]}' }));
    return { res, seen };
  } finally {
    globalThis.fetch = saved.fetch;
    for (const k of Object.keys(process.env)) if (!(k in saved.env)) delete process.env[k];
    Object.assign(process.env, saved.env);
  }
}

test("relay: closed without its secrets, to a wrong or missing token, and to anything but generateContent", async () => {
  equal((await relayCall({ env: { RELAY_TOKEN: undefined } })).res.status, 503);
  equal((await relayCall({ env: { GEMINI_API_KEY: undefined } })).res.status, 503);
  const wrong = await relayCall({ token: "guess" });
  equal(wrong.res.status, 401); equal(wrong.seen.length, 0, "Google is not called");
  equal((await relayCall({ token: null })).res.status, 401);
  for (const path of ["files", "models", "models/gemini-3.8-flash:countTokens", "models/../tunedModels:list", "cachedContents"]) {
    equal((await relayCall({ path })).res.status, 404, path);
  }
  equal((await relayCall({ env: { ALLOWED_MODELS: "gemini-4-argon" } })).res.status, 403);
});

test("relay: adds the Gemini key, keeps the stream flag, drops the relay token, passes Google's answer through", async () => {
  const { res, seen } = await relayCall();
  equal(res.status, 200);
  equal(seen[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
  equal(seen[0].init.headers["x-goog-api-key"], "real-key");
  assert(!("x-relay-token" in seen[0].init.headers), "the relay token goes no further");
  assert((await res.text()).includes("candidates"));
  const refused = await relayCall({ upstream: new Response('{"error":{"code":400,"message":"API key not valid"}}', { status: 400 }) });
  equal(refused.res.status, 400);
  assert((await refused.res.text()).includes("API key not valid"), "Google's own reason comes back");
});

await run();

