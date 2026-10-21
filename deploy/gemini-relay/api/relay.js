/**
 * Gemini relay — a Vercel function between the platform's server and the
 * Gemini API, for a server that Google does not serve (Iran answers "User
 * location is not supported").
 *
 *   platform server ──(x-relay-token)──▶ this relay ──(x-goog-api-key)──▶ Google
 *
 * The Gemini key lives here, in this project's environment, and nowhere
 * else: the platform's server holds only RELAY_TOKEN, which opens this relay
 * and nothing more. What passes:
 *
 *   POST /v1beta/models/<model>:generateContent
 *   POST /v1beta/models/<model>:streamGenerateContent[?alt=sse]
 *
 * — the two calls the platform makes, nothing else of the Gemini API (no
 * file uploads, no tuning, no key management). ALLOWED_MODELS narrows the
 * models further. The answer streams back as Google sends it; no request or
 * answer body is logged or kept.
 *
 * Environment (Vercel → Settings → Environment Variables, marked Sensitive):
 *   GEMINI_API_KEY   the Google AI Studio key
 *   RELAY_TOKEN      a long random secret; the same value goes into the
 *                    platform server's GEMINI_RELAY_TOKEN
 *   ALLOWED_MODELS   optional, comma separated, e.g. gemini-3.8-flash,gemini-4-argon
 */
import { timingSafeEqual } from "node:crypto";

export const config = { maxDuration: 300 };

// GEMINI_UPSTREAM exists for the platform's own end-to-end drive (a stand-in Gemini); leave it unset
const upstreamBase = () => process.env.GEMINI_UPSTREAM || "https://generativelanguage.googleapis.com/v1beta";
const PATH = /^models\/([a-z0-9][a-z0-9.\-]{0,80}):(generateContent|streamGenerateContent)$/;

const fail = (status, message) => Response.json({ error: { code: status, message, status: "RELAY" } }, { status });

function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request) {
  const { GEMINI_API_KEY: key, RELAY_TOKEN: token, ALLOWED_MODELS: allowed } = process.env;
  // fails closed: a relay deployed without its two secrets opens for nobody
  if (!key || !token) return fail(503, "relay not configured: set GEMINI_API_KEY and RELAY_TOKEN on Vercel");
  if (!sameSecret(request.headers.get("x-relay-token"), token)) return fail(401, "relay token missing or wrong");

  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "";
  const m = PATH.exec(path);
  if (!m) return fail(404, "only models/<model>:generateContent and :streamGenerateContent pass this relay");
  const list = (allowed || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length && !list.includes(m[1])) return fail(403, `model ${m[1]} is not allowed on this relay`);

  const qs = url.searchParams.get("alt") === "sse" ? "?alt=sse" : "";
  const upstream = await fetch(`${upstreamBase()}/${path}${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: request.body,
    duplex: "half",
  });
  // passed through as it comes, streamed; Google's own status and error body included
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" },
  });
}

export function GET() {
  return fail(405, "POST only");
}
