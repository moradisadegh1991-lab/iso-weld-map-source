/**
 * A project's LLM endpoints (migration 093; the rules are lib/llm/endpoints.mjs):
 * the address and key a project admin registers for a provider. The secret is
 * sealed (lib/server/secret-box.mjs) and comes out of here only through
 * `resolveEndpoints`, for the server to call the provider with — `listEndpoints`
 * and `saveEndpoint` return the hint, never the secret. Call inside `withProject`.
 */
import { seal, open } from "../../server/secret-box.mjs";
import { ENDPOINT_PROVIDERS, checkBaseUrl, parseModels, hintOf, providerOptions } from "../../llm/endpoints.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (x) => Object.assign(new Error(`${x} not found`), { status: 404 });
const aadOf = (projectId, provider) => `${projectId}:${provider}`;
const LOG = (db, projectId, label, comment, userId) => logEvent(db, { projectId, section: "piping", entityType: "llm_endpoint", entityId: null, label, action: "updated", comment, userId });

/** What a row shows: the address, the kind, the hint and whether the secret can still be read — never the secret. */
function view(r, projectId) {
  let readable = true;
  if (r.secret_enc) { try { open(r.secret_enc, { aad: aadOf(projectId, r.provider) }); } catch { readable = false; } }
  return { provider: r.provider, baseUrl: r.base_url, secretKind: r.secret_kind, hasSecret: !!r.secret_enc, hint: r.secret_hint || null,
    models: r.models || [], readable, updatedAt: r.updated_at, updatedBy: r.updated_by_name || null };
}

export async function listEndpoints(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT e.*, u.display_name AS updated_by_name FROM llm_endpoint e LEFT JOIN app_user u ON u.id = e.updated_by
      WHERE e.project_id = $1 ORDER BY e.provider`, [projectId]);
  return rows.map((r) => view(r, projectId));
}

/**
 * An endpoint registered, or changed. A secret left out (empty) keeps the one
 * stored, so the address can change without typing the key again; the first
 * save of an Anthropic or Gemini endpoint needs one (an OpenAI-compatible
 * server inside the plant may take none).
 */
export async function saveEndpoint(db, { projectId, provider, baseUrl, secretKind, secret, models, userId }) {
  const P = ENDPOINT_PROVIDERS[provider];
  if (!P) throw bad("ارائه‌دهنده نامعتبر است.");
  const u = checkBaseUrl(baseUrl);
  if (u.problem) throw bad(u.problem);
  const kind = secretKind || P.kinds[0];
  if (!P.kinds.includes(kind)) throw bad(`${P.label}: نوع کلید «${kind}» پذیرفته نمی‌شود.`);
  const typed = String(secret ?? "").trim();
  if (typed && (typed.length < 8 || typed.length > 2000 || /\s/.test(typed))) throw bad("کلید نامعتبر است (کوتاه، بلند یا دارای فاصله).");
  const { rows: [old] } = await db.query("SELECT * FROM llm_endpoint WHERE project_id = $1 AND provider = $2", [projectId, provider]);
  if (!typed && !old?.secret_enc && provider !== "openai-compatible") throw bad(`${P.label}: کلید یا توکن لازم است.`);
  if (!typed && old && old.secret_kind !== kind && old.secret_enc) throw bad("نوع کلید را عوض کرده‌اید؛ کلید تازه را هم بنویسید.");
  const list = provider === "openai-compatible" ? parseModels(models) : [];
  const enc = typed ? seal(typed, { aad: aadOf(projectId, provider) }) : old?.secret_enc || null;
  const hint = typed ? hintOf(typed) : old?.secret_hint || null;
  const { rows: [r] } = await db.query(
    `INSERT INTO llm_endpoint (project_id, provider, base_url, secret_kind, secret_enc, secret_hint, models, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (project_id, provider) DO UPDATE SET base_url = EXCLUDED.base_url, secret_kind = EXCLUDED.secret_kind, secret_enc = EXCLUDED.secret_enc,
       secret_hint = EXCLUDED.secret_hint, models = EXCLUDED.models, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`, [projectId, provider, u.url, kind, enc, hint, list, userId]);
  // the log names the endpoint, never what it holds
  await LOG(db, projectId, `نقطهٔ ${P.label}`, `${old ? "ویرایش" : "ثبت"} شد: ${u.url}${typed ? " (کلید تازه)" : ""}`, userId);
  return view(r, projectId);
}

export async function removeEndpoint(db, { projectId, provider, userId }) {
  const { rowCount } = await db.query("DELETE FROM llm_endpoint WHERE project_id = $1 AND provider = $2", [projectId, provider]);
  if (!rowCount) throw notFound("endpoint");
  await LOG(db, projectId, `نقطهٔ ${ENDPOINT_PROVIDERS[provider]?.label || provider}`, "حذف شد", userId);
}

/**
 * The endpoints as the router takes them — `{ provider: options for its factory }` —
 * with the secrets opened. Server side only: nothing returned here goes to a
 * response. One whose secret cannot be opened (the server's key changed) is
 * left out and named in `unreadable`, so the provider falls back to the
 * environment rather than being called with a wrong key.
 */
export async function resolveEndpoints(db, { projectId }) {
  const { rows } = await db.query("SELECT * FROM llm_endpoint WHERE project_id = $1", [projectId]);
  const endpoints = {}, unreadable = [];
  for (const r of rows) {
    try {
      const secret = r.secret_enc ? open(r.secret_enc, { aad: aadOf(projectId, r.provider) }) : null;
      endpoints[r.provider] = providerOptions(r.provider, { baseUrl: r.base_url, secretKind: r.secret_kind, secret, models: r.models || [] });
    } catch { unreadable.push(r.provider); }
  }
  return { endpoints, unreadable };
}
