/**
 * Run deploy/gemini-relay on this machine the way Vercel serves it — the
 * vercel.json rewrite /v1beta/:path → /api/relay?path=:path, then the
 * function — for the end-to-end drive (tools/drive-llm-accounting.mjs).
 * With FAKE_GEMINI_PORT it also starts a stand-in Gemini that answers every
 * generateContent with an empty JSON object and a known token count.
 *   RELAY_TOKEN=... GEMINI_API_KEY=... PORT=8787 [FAKE_GEMINI_PORT=8788] node tools/relay-local.mjs
 */
import http from "node:http";
import { Readable } from "node:stream";
const relay = await import("../deploy/gemini-relay/api/relay.js");
const PORT = Number(process.env.PORT || 8787);

if (process.env.FAKE_GEMINI_PORT) {
  const fp = Number(process.env.FAKE_GEMINI_PORT);
  process.env.GEMINI_UPSTREAM = `http://127.0.0.1:${fp}/v1beta`;
  http.createServer((req, res) => {
    let n = 0; req.on("data", (c) => { n += c.length; }); req.on("end", () => {
      const ok = req.headers["x-goog-api-key"] === process.env.GEMINI_API_KEY;
      if (!ok) { res.writeHead(400, { "content-type": "application/json" }); return res.end('{"error":{"message":"API key not valid"}}'); }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 34 } })}\r\n\r\n`);
      res.end();
    });
  }).listen(fp, "127.0.0.1");
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const m = /^\/v1beta\/(.+)$/.exec(u.pathname);
  if (!m) { res.writeHead(404); return res.end(); }
  const target = new URL(`http://localhost:${PORT}/api/relay`);
  target.searchParams.set("path", decodeURIComponent(m[1]));
  for (const [k, v] of u.searchParams) target.searchParams.set(k, v);
  const out = await relay.POST(new Request(target, { method: req.method, headers: req.headers,
    body: Readable.toWeb(req), duplex: "half" }));
  res.writeHead(out.status, Object.fromEntries(out.headers));
  if (out.body) for await (const c of out.body) res.write(c);
  res.end();
}).listen(PORT, "127.0.0.1", () => console.log(`relay on http://127.0.0.1:${PORT}/v1beta`));
