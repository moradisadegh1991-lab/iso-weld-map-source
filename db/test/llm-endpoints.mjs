#!/usr/bin/env node
/**
 * A project's own LLM endpoints (owner's request 2026-10-29; migration 093):
 * the address and key a project admin registers in the piping page — an
 * OpenAI-compatible service such as Liara's, or the relay that holds the
 * Claude / Gemini key — kept sealed, never returned, and standing over the
 * server's environment in that project only.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { seal, open } from "../../lib/server/secret-box.mjs";
import { checkBaseUrl, parseModels, hintOf, providerOptions } from "../../lib/llm/endpoints.mjs";

const KEY = "x".repeat(40);

// ── the rules ────────────────────────────────────────────────────────────

test("a sealed secret opens only with its key and its row: another key, another row, a changed byte — all refused, never a wrong plaintext", () => {
  const env = { SESSION_SECRET: KEY };
  const box = seal("sk-live-1234567890", { aad: "p1:gemini", env });
  assert(box.startsWith("v1.") && !box.includes("sk-live"), "sealed");
  equal(open(box, { aad: "p1:gemini", env }), "sk-live-1234567890");
  equal(seal("sk-live-1234567890", { aad: "p1:gemini", env }) !== box, true, "a new nonce every time");
  for (const [what, fn] of [
    ["another row", () => open(box, { aad: "p2:gemini", env })],
    ["another provider", () => open(box, { aad: "p1:anthropic", env })],
    ["another key", () => open(box, { aad: "p1:gemini", env: { SESSION_SECRET: "y".repeat(40) } })],
    ["a changed byte", () => open(box.slice(0, -2) + (box.endsWith("A") ? "B" : "A") + box.slice(-1), { aad: "p1:gemini", env })],
    ["not a box", () => open("plain text", { aad: "p1:gemini", env })],
  ]) { let c; try { fn(); } catch (e) { c = e.code; } equal(c, "SECRET_UNREADABLE", what); }
  equal(open(seal("k-1234567890", { aad: "a", env: { SECRETS_KEY: "z".repeat(40), SESSION_SECRET: "q".repeat(40) } }), { aad: "a", env: { SECRETS_KEY: "z".repeat(40) } }),
    "k-1234567890", "SECRETS_KEY stands over SESSION_SECRET, so the session secret can change without losing the keys");
});

test("a server without a stable key of its own refuses to seal — it does not lose what it was given", () => {
  for (const env of [{}, { SESSION_SECRET: "short" }]) {
    let c; try { seal("sk-1234567890", { env }); } catch (e) { c = e.code; }
    equal(c, "NO_SECRETS_KEY");
  }
});

test("an address: https, or this machine; no credentials, no query, no cloud metadata; a trailing slash dropped", () => {
  equal(checkBaseUrl("https://ai.example.com/api/v1/abc/").url, "https://ai.example.com/api/v1/abc");
  equal(checkBaseUrl("http://localhost:8787/v1beta").url, "http://localhost:8787/v1beta", "a relay on this machine may be http");
  for (const [bad, why] of [["", "empty"], ["http://example.com/v1", "http to the network"], ["ftp://x.com", "another scheme"], ["https://u:p@x.com/v1", "credentials in it"],
    ["https://x.com/v1?key=abc", "a key in the query"], ["https://x.com/v1#k", "a fragment"], ["https://169.254.169.254/latest", "cloud metadata"],
    ["https://metadata.google.internal/x", "cloud metadata by name"], ["https://x .com", "a space"], ["not a url", "not an address"]])
    assert(checkBaseUrl(bad).problem, why);
});

test("what a provider's factory is given: the kind chosen only — the other is null so the environment's cannot be picked up beside it", () => {
  equal(providerOptions("anthropic", { baseUrl: "https://r.example/v1", secretKind: "relay_token", secret: "tok-12345678" }),
    { baseUrl: "https://r.example/v1", apiKey: null, relayToken: "tok-12345678" });
  equal(providerOptions("gemini", { baseUrl: "", secretKind: "api_key", secret: "key-12345678" }), { apiKey: "key-12345678", relayToken: null });
  const o = providerOptions("openai-compatible", { baseUrl: "https://ai.example/v1", secretKind: "api_key", secret: "k-12345678", models: ["vl-72b", "vl-7b"] });
  equal([o.apiKey, o.defaultModel, o.repairModel, o.models.map((m) => m.id)], ["k-12345678", "vl-72b", "vl-7b", ["vl-72b", "vl-7b"]]);
  equal(providerOptions("openai-compatible", { baseUrl: "https://ai.example/v1", secret: null, models: [] }), { baseUrl: "https://ai.example/v1" }, "no key: none sent");
  equal(parseModels("a, b\nb،c"), ["a", "b", "c"]);
  equal([hintOf("sk-abcdefghijkl"), hintOf("short")], ["••••ijkl", "••••"], "a short secret shows nothing of itself");
});

// ── in the database ──────────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.SESSION_SECRET = KEY;
process.env.PGLITE_DIR = await scratchDir("llm-ep-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const le = await import("../../lib/db/repos/llm-endpoints.mjs");
const { createLlmRouter, createLlmClient } = await import("../../lib/llm/index.mjs");
const db = await getDb();
const U = {};
for (const k of ["admin", "eng", "view", "other"]) U[k] = await projects.ensureUser(db, { subject: `kc|le-${k}`, displayName: k });
const P = (await projects.createProject(db, { code: "LE1", name: "A", ownerUserId: U.admin.id })).id;
const P2 = (await projects.createProject(db, { code: "LE2", name: "B", ownerUserId: U.other.id })).id;
await projects.addMember(db, { projectId: P, userId: U.eng.id, role: "engineer" });
await projects.addMember(db, { projectId: P, userId: U.view.id, role: "viewer" });
const inP = (fn) => withProject(db, P, fn);
const SECRET = "lk-SECRET-0123456789";

test("an endpoint is registered; the list shows the address and a hint, never the secret; the table holds it sealed", async () => {
  await inP(async () => {
    const r = await le.saveEndpoint(db, { projectId: P, provider: "openai-compatible", baseUrl: "https://ai.example.ir/api/v1/proj/", secret: SECRET,
      models: "qwen-vl-max\nqwen-vl-plus", userId: U.admin.id });
    equal([r.baseUrl, r.secretKind, r.hasSecret, r.hint, r.models, r.readable], ["https://ai.example.ir/api/v1/proj", "api_key", true, "••••6789", ["qwen-vl-max", "qwen-vl-plus"], true]);
    const shown = JSON.stringify(await le.listEndpoints(db, { projectId: P })) + JSON.stringify(r);
    assert(!shown.includes(SECRET) && !shown.includes("SECRET-0123"), "not in the list nor in the saved row");
    const { rows: [raw] } = await db.query("SELECT * FROM llm_endpoint WHERE project_id = $1", [P]);
    assert(raw.secret_enc.startsWith("v1.") && !JSON.stringify(raw).includes("SECRET-0123"), "sealed at rest");
    const { rows: ev } = await db.query("SELECT entity_label, comment FROM workflow_event WHERE project_id = $1 AND entity_type = 'llm_endpoint'", [P]);
    assert(ev.length === 1 && !JSON.stringify(ev).includes("SECRET-0123") && ev[0].comment.includes("ai.example.ir"), "the log names the endpoint, not the key");
  });
});

test("saving again without a key keeps the stored one; a new endpoint of Claude or Gemini needs a key; changing the kind needs the new key", async () => {
  await inP(async () => {
    const r = await le.saveEndpoint(db, { projectId: P, provider: "openai-compatible", baseUrl: "https://ai.example.ir/api/v2", secret: "", models: "qwen-vl-max", userId: U.admin.id });
    equal([r.baseUrl, r.hint, r.models], ["https://ai.example.ir/api/v2", "••••6789", ["qwen-vl-max"]], "address and models changed, key kept");
    const { endpoints } = await le.resolveEndpoints(db, { projectId: P });
    equal(endpoints["openai-compatible"].apiKey, SECRET, "the server opens it to call the provider");
    await throws(() => le.saveEndpoint(db, { projectId: P, provider: "anthropic", baseUrl: "https://relay.example/v1", userId: U.admin.id }), "کلید یا توکن لازم");
    await le.saveEndpoint(db, { projectId: P, provider: "anthropic", baseUrl: "https://relay.example/v1", secretKind: "relay_token", secret: "relay-token-123", userId: U.admin.id });
    await throws(() => le.saveEndpoint(db, { projectId: P, provider: "anthropic", baseUrl: "https://relay.example/v1", secretKind: "api_key", userId: U.admin.id }), "نوع کلید");
    await throws(() => le.saveEndpoint(db, { projectId: P, provider: "openai-compatible", baseUrl: "https://ai.example.ir/v1", secretKind: "relay_token", userId: U.admin.id }), "پذیرفته نمی‌شود");
    await throws(() => le.saveEndpoint(db, { projectId: P, provider: "gemini", baseUrl: "http://relay.example/v1beta", secret: "k-12345678", userId: U.admin.id }), "https");
    await throws(() => le.saveEndpoint(db, { projectId: P, provider: "gemini", baseUrl: "https://r.example/v1beta", secret: "has space 12345", userId: U.admin.id }), "کلید نامعتبر");
    await throws(() => le.saveEndpoint(db, { projectId: P, provider: "other", baseUrl: "https://r.example", secret: "k-12345678", userId: U.admin.id }), "ارائه‌دهنده");
  });
});

test("a project's endpoints are its own: another project sees none, and a sealed value copied into another project does not open", async () => {
  equal((await withProject(db, P2, () => le.listEndpoints(db, { projectId: P2 }))).length, 0);
  const { rows: [mine] } = await inP(() => db.query("SELECT secret_enc FROM llm_endpoint WHERE provider = 'openai-compatible'"));
  await withProject(db, P2, async () => {
    await db.query("INSERT INTO llm_endpoint (project_id, provider, base_url, secret_kind, secret_enc, secret_hint) VALUES ($1,'openai-compatible','https://evil.example/v1','api_key',$2,'••••')", [P2, mine.secret_enc]);
    const r = await le.resolveEndpoints(db, { projectId: P2 });
    equal([Object.keys(r.endpoints), r.unreadable], [[], ["openai-compatible"]], "the copy does not open: left out, named");
    equal((await le.listEndpoints(db, { projectId: P2 }))[0].readable, false);
  });
});

test("the router: a registered endpoint is offered and configured, replaces the environment's key for that provider, and never sends both kinds of secret", async () => {
  const keep = { a: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_RELAY_TOKEN, b: process.env.LLM_BASE_URL };
  process.env.ANTHROPIC_API_KEY = "env-anthropic-key"; process.env.ANTHROPIC_RELAY_TOKEN = "env-relay-token"; delete process.env.LLM_BASE_URL;
  try {
    const none = createLlmRouter({ endpoints: {} }).catalogue();
    equal(none.providers.map((p) => p.id), ["anthropic", "gemini"], "no registered endpoint: the environment decides");
    const { endpoints } = await inP(() => le.resolveEndpoints(db, { projectId: P }));
    const cat = createLlmRouter({ endpoints }).catalogue();
    const own = cat.providers.find((p) => p.id === "openai-compatible");
    equal([own.configured, own.own, cat.providers.find((p) => p.id === "anthropic").own], [true, true, true]);
    equal(cat.models.filter((m) => m.provider === "openai-compatible").map((m) => m.id), ["qwen-vl-max"], "the models the endpoint serves");
    // the Anthropic endpoint is a relay: its token and its address, not the environment's key or token
    const calls = [];
    const fake = async (url, init) => { calls.push({ url, h: init.headers }); return { ok: true, status: 200, body: new Response("data: " + JSON.stringify({ type: "message_stop" }) + "\n\n").body, text: async () => "" }; };
    const c = createLlmClient({ provider: "anthropic", ...endpoints.anthropic, fetchImpl: fake });
    await c.complete({ model: "claude-sonnet-5", maxTokens: 10, prompt: "x" }).catch(() => {});
    equal([calls[0].url, calls[0].h["x-relay-token"], calls[0].h["x-api-key"]], ["https://relay.example/v1/messages", "relay-token-123", undefined]);
    // an API key endpoint is sent as the key, though the environment holds a relay token
    const k = createLlmClient({ provider: "anthropic", ...providerOptions("anthropic", { baseUrl: "", secretKind: "api_key", secret: "own-api-key-123" }), fetchImpl: fake });
    await k.complete({ model: "claude-sonnet-5", maxTokens: 10, prompt: "x" }).catch(() => {});
    equal([calls[1].h["x-api-key"], calls[1].h["x-relay-token"]], ["own-api-key-123", undefined]);
    // the OpenAI-compatible endpoint is called with its key as a bearer
    const o = createLlmClient({ provider: "openai-compatible", ...endpoints["openai-compatible"], fetchImpl: fake });
    await o.complete({ maxTokens: 10, prompt: "x" }).catch(() => {});
    equal([calls[2].url, calls[2].h.authorization], ["https://ai.example.ir/api/v2/chat/completions", `Bearer ${SECRET}`]);
  } finally {
    for (const [k, v] of [["ANTHROPIC_API_KEY", keep.a], ["ANTHROPIC_RELAY_TOKEN", keep.t], ["LLM_BASE_URL", keep.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("a server whose key changed leaves the endpoint out rather than calling the provider with a wrong key", async () => {
  const was = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "n".repeat(40);
  try {
    const r = await inP(() => le.resolveEndpoints(db, { projectId: P }));
    equal([Object.keys(r.endpoints), r.unreadable.sort()], [[], ["anthropic", "openai-compatible"]]);
    assert((await inP(() => le.listEndpoints(db, { projectId: P }))).every((e) => e.readable === false), "and the list says to register them again");
  } finally { process.env.SESSION_SECRET = was; }
});

test("an endpoint is removed; removing one that is not there is a 404", async () => {
  await inP(async () => {
    await le.removeEndpoint(db, { projectId: P, provider: "anthropic", userId: U.admin.id });
    equal((await le.listEndpoints(db, { projectId: P })).map((e) => e.provider), ["openai-compatible"]);
    await throws(() => le.removeEndpoint(db, { projectId: P, provider: "anthropic", userId: U.admin.id }), "not found");
  });
});

test("through the routes: only a project admin writes; a member reads without the secret; the models list carries the project's endpoint", async () => {
  const route = await import("../../app/api/llm-endpoints/route.js");
  const models = await import("../../app/api/models/route.js");
  const req = (url, as, body) => new Request(`http://x${url}`, { method: body ? "POST" : "GET",
    headers: { authorization: `Bearer kc|le-${as}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const body = { projectId: P, kind: "save", provider: "gemini", baseUrl: "https://relay.example/v1beta", secretKind: "relay_token", secret: "route-secret-4242" };
  equal((await route.POST(req("/api/llm-endpoints", "eng", body))).status, 403, "an engineer may not");
  equal((await route.POST(req("/api/llm-endpoints", "view", body))).status, 403, "a viewer may not");
  equal((await route.POST(req("/api/llm-endpoints", "other", body))).status, 404, "not on the project: not there");
  const ok = await route.POST(req("/api/llm-endpoints", "admin", body));
  const okText = await ok.text();
  equal(ok.status, 200);
  assert(!okText.includes("route-secret-4242"), "the save does not echo the key");
  for (const who of ["admin", "eng", "view"]) {
    const g = await route.GET(req(`/api/llm-endpoints?projectId=${P}`, who));
    const t = await g.text();
    equal(g.status, 200, who);
    assert(!t.includes("route-secret-4242") && !t.includes("SECRET-0123") && !t.includes("secret_enc") && !t.includes("v1."), `${who} never gets a secret, sealed or not`);
    equal(JSON.parse(t).may.write, who === "admin", `${who}: may.write`);
  }
  equal((await route.GET(req(`/api/llm-endpoints?projectId=${P}`, "other"))).status, 404);
  equal((await route.POST(req("/api/llm-endpoints", "admin", { projectId: P, kind: "save", provider: "gemini", baseUrl: "https://169.254.169.254/x", secret: "k-12345678" }))).status, 400, "metadata address refused");
  const cat = await (await models.GET(req(`/api/models?projectId=${P}`, "eng"))).json();
  const g = cat.providers.find((p) => p.id === "gemini");
  equal([g.own, g.configured, g.via], [true, true, "relay"], "listed as registered in this project, through a relay");
  const without = await (await models.GET(req("/api/models", "eng"))).json();
  assert(!without.providers.some((p) => p.own), "without a project the environment alone decides");
  equal((await route.POST(req("/api/llm-endpoints", "admin", { projectId: P, kind: "remove", provider: "gemini" }))).status, 200);
});

await run();
