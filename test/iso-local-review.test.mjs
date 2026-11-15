import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { localReviewUrl, reviewIsoLocally } from "../lib/llm/iso-local-review.mjs";

const image = "YQ==", marks = [{ no: "12", shape: "circle", at: [0.2, 0.3], project: "SECRET-PROJECT" }];
test("only an explicit numeric loopback address is accepted", () => {
  for (const url of ["", "https://provider.example/v1", "http://localhost:8080/v1", "http://192.168.1.1/v1", "http://127.0.0.1:8080/v1?x=1", "http://u:p@127.0.0.1:8080/v1"]) {
    assert.throws(() => localReviewUrl(url), /LOCAL_MODEL_UNCONFIGURED/);
  }
  assert.equal(localReviewUrl("http://127.0.0.1:8090/v1/"), "http://127.0.0.1:8090/v1/chat/completions");
});
test("real loopback review sends only allowed OCR fields and refuses redirects", async (t) => {
  let received, redirected = false;
  const target = http.createServer((req, res) => { redirected = true; res.end("unexpected"); });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    received = JSON.parse(raw);
    if (req.url.startsWith("/redirect/")) { res.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/` }); res.end(); return; }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ notes: ["Review marker 12"], welds: [{ no: "12", x: 0.2, y: 0.3, reason: "inspect" }] }) } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); target.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await reviewIsoLocally({ url: `${base}/v1`, model: "test", image, marks }), { notes: ["Review marker 12"], welds: [{ no: "12", x: 0.2, y: 0.3, reason: "inspect" }] });
  assert(!JSON.stringify(received).includes("SECRET-PROJECT"));
  assert(JSON.stringify(received).includes("data:image/jpeg;base64,YQ=="));
  await assert.rejects(reviewIsoLocally({ url: `${base}/redirect`, model: "test", image, marks }));
  assert.equal(redirected, false);
});
test("missing model and invalid or oversized inputs fail before network", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  for (const opts of [{ model: "", image, marks }, { model: "x", image: "bad!", marks }, { model: "x", image, marks: Array(501).fill({}) }]) {
    await assert.rejects(reviewIsoLocally({ url: "http://127.0.0.1:1/v1", fetchImpl, ...opts }));
  }
  assert.equal(called, false);
});

test("all legacy provider transports refuse HTTP redirects", async () => {
  const { createAnthropicProvider } = await import("../lib/llm/anthropic.mjs");
  const { createGeminiProvider } = await import("../lib/llm/gemini.mjs");
  const { createOpenAiCompatProvider } = await import("../lib/llm/openai-compat.mjs");
  const options = [];
  const fetchImpl = async (_url, init) => { options.push(init.redirect); throw new Error("stop before response"); };
  const providers = [createAnthropicProvider({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "a", fetchImpl }),
    createGeminiProvider({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "g", fetchImpl }),
    createOpenAiCompatProvider({ baseUrl: "http://127.0.0.1:1/v1", fetchImpl })];
  for (const provider of providers) await assert.rejects(provider.complete({ prompt: "x", maxTokens: 10 }));
  assert.deepEqual(options, ["error", "error", "error"]);
});

test("invalid model output or unbounded coordinates are never shown as proposals", async () => {
  for (const content of ["not JSON", JSON.stringify({ notes: [], welds: [{ no: "1", x: 1.1, y: 0.3, reason: "x" }] }),
    JSON.stringify({ notes: [], welds: [{ no: "1", x: "0.3", y: 0.3, reason: "x" }] })]) {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
    await assert.rejects(reviewIsoLocally({ url: "http://127.0.0.1:1/v1", model: "test", image, marks, fetchImpl }), /LOCAL_MODEL_RESPONSE/);
  }
});
