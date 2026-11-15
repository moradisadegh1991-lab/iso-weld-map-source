import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatProvider } from "../lib/llm/openai-compat.mjs";

test("the official OpenAI endpoint requires a key and a caller cannot silently use a placeholder", async () => {
  const saved = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  try {
    const p = createOpenAiCompatProvider({ baseUrl: "https://api.openai.com/v1", apiKey: "" });
    assert.equal(p.configured, false);
    await assert.rejects(p.complete({ prompt: "test", maxTokens: 10 }), (e) => e.code === "LLM_NOT_CONFIGURED");
  } finally { if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved; }
});

test("the OpenAI environment key is scoped to the official host, never another compatible endpoint", async () => {
  const saved = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-only-private-key";
  const headers = [];
  const fetchImpl = async (_url, init) => { headers.push(init.headers.authorization); throw Error("stop"); };
  try {
    for (const baseUrl of ["https://api.openai.com/v1", "https://model.example/v1", "http://127.0.0.1:8888/v1"]) {
      const p = createOpenAiCompatProvider({ baseUrl, fetchImpl });
      await assert.rejects(p.complete({ prompt: "test", maxTokens: 10 }));
    }
    assert.deepEqual(headers, ["Bearer test-only-private-key", "Bearer not-needed", "Bearer not-needed"]);
  } finally { if (saved === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved; }
});

test("project endpoint with no stored key does not inherit server credentials", async () => {
  const { providerOptions } = await import("../lib/llm/endpoints.mjs");
  const saved = { generic: process.env.LLM_API_KEY, openai: process.env.OPENAI_API_KEY };
  process.env.LLM_API_KEY = "server-generic-secret"; process.env.OPENAI_API_KEY = "server-openai-secret";
  const headers = [];
  try {
    for (const baseUrl of ["https://api.openai.com/v1", "https://model.example/v1"]) {
      const opts = providerOptions("openai-compatible", { baseUrl, secret: null });
      const p = createOpenAiCompatProvider({ ...opts, fetchImpl: async (_url, init) => { headers.push(init.headers.authorization); throw Error("stop"); } });
      if (baseUrl.includes("api.openai.com")) { assert.equal(p.configured, false); continue; }
      await assert.rejects(p.complete({ prompt: "test", maxTokens: 10 }));
    }
    assert.deepEqual(headers, ["Bearer not-needed"]);
  } finally {
    if (saved.generic === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = saved.generic;
    if (saved.openai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.openai;
  }
});
