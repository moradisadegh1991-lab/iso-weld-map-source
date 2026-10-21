/**
 * Anthropic relay — the same Vercel project as the Gemini relay, a second
 * function: the platform's server cannot reach api.anthropic.com from Iran.
 *
 *   platform server ──(x-relay-token)──▶ this relay ──(x-api-key)──▶ Anthropic
 *
 * The Anthropic key lives here, in this project's environment, and nowhere
 * else; the platform's server holds only RELAY_TOKEN (the one the Gemini
 * relay already uses). What passes:
 *
 *   POST /v1/messages        (the call the platform makes, streamed)
 *
 * nothing else of the Anthropic API (no batches, no files, no admin keys).
 * No request or answer body is logged or kept.
 *
 * Environment (Vercel → Settings → Environment Variables, marked Sensitive):
 *   ANTHROPIC_API_KEY  the key from console.anthropic.com
 *   RELAY_TOKEN        shared with the Gemini relay and the platform server
 */
import { timingSafeEqual } from "node:crypto";

export const config = { maxDuration: 300 };

// ANTHROPIC_UPSTREAM exists for the platform's own end-to-end drive (a stand-in); leave it unset
const upstreamBase = () => process.env.ANTHROPIC_UPSTREAM || "https://api.anthropic.com/v1";

const fail = (status, message) =>
  Response.json({ type: "error", error: { type: "relay_error", message } }, { status });

function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request) {
  const { ANTHROPIC_API_KEY: key, RELAY_TOKEN: token } = process.env;
  // fails closed: a relay deployed without its two secrets opens for nobody
  if (!key || !token) return fail(503, "relay not configured: set ANTHROPIC_API_KEY and RELAY_TOKEN on Vercel");
  if (!sameSecret(request.headers.get("x-relay-token"), token)) return fail(401, "relay token missing or wrong");

  const path = new URL(request.url).searchParams.get("path") || "";
  if (path !== "messages") return fail(404, "only /v1/messages passes this relay");

  const headers = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
  };
  const beta = request.headers.get("anthropic-beta");
  if (beta) headers["anthropic-beta"] = beta;

  const upstream = await fetch(`${upstreamBase()}/messages`, {
    method: "POST", headers, body: request.body, duplex: "half",
  });
  // passed through as it comes, streamed; Anthropic's own status and error body included
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" },
  });
}

export function GET() {
  return fail(405, "POST only");
}
