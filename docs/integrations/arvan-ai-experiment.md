# Arvan AI adapter — experimental, no production activation

Operator tests on Liara VPS (2026-11-18):
- `GET https://api.arvancloudai.ir/v1/models`: HTTP 200, 97 models.
- Non-streaming chat using `Qwen-3.8-Flash`: HTTP 200, 55 prompt tokens, 4 completion tokens, 6.36 seconds.
- JSON mode: valid synthetic `{"weld_no":"W-001","nps":6,"weld_type":"BW"}` (107 + 23 tokens).
- **Streaming JSON + SSE**: HTTP 200, `text/event-stream`, 9 events, JSON valid, `finish_reason=stop`, 108 prompt + 28 completion tokens, 11.25 seconds. Response had both `prompt_tokens`/`completion_tokens` and zero-valued `input_tokens`/`output_tokens`; use the former for accounting.
- No vision request, engineering extraction accuracy evaluation, or image privacy approval has yet been completed.

This branch extends `createOpenAiCompatProvider` with **opt-in** `authScheme: "arvan-apikey"`; it accepts the full machine-user API key in the exact format `apikey <token>`, and only sends it to `https://api.arvancloudai.ir/v1`. Existing callers keep **Bearer** behavior. No database migrations, server config or EPC production deployment are included.

## Security controls

1. Existing `app/api/extract/route.js` / `lib/llm/README.md` restrict piping image extraction to trusted local endpoints. **Do not bypass this policy by setting LLM_BASE_URL to Arvan or pointing a loopback proxy at the cloud.** External engineering drawing transfer requires separate privacy review, redaction and explicit authorization.
2. Use a server-held least-privileged machine-user key, not a client-side key. Never commit `/etc/moradi-infra/arvan-ai.key`, print it, or copy it into `/etc/epc/epc.env` before the integration is explicitly approved.
3. The approved model display ID `Qwen-3.8-Flash` was accepted in the small text test; response canonical model `qwen/qwen3.8-flash`. No claim about image support, price or model quality.
4. No changes to `LLM_PROVIDER`, `LLM_PROVIDERS`, `/etc/epc/epc.env`, Caddy, systemd EPC, or production DB.
5. The authentication mode is deliberately passed via an **explicit parameter only**, preventing a global environment variable from silently switching production authentication.

## Unit verification on a separate checkout

```bash
git checkout feat/arvan-ai-adapter-safe
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./tools/register.mjs db/test/llm.mjs
```

The regression suite includes Arvan header, endpoint pinning, SSE/JSON/token accounting and legacy Bearer authentication. Unit tests use a mocked fetch and **do not spend Arvan tokens**.

Next: evaluate a **synthetic image** in a standalone controlled experiment; obtain written authorization and approved data handling/egress requirements before any engineering drawings are transmitted. Then design a dedicated opt-in provider and usage/price guardrails if the business case justifies it.

## Rollback

This is a draft branch only. Do not merge or deploy before tests and review. Production remains on `master`.
