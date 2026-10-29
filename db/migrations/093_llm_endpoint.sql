-- ─────────────────────────────────────────────────────────────────────────
-- A project's own LLM endpoints (owner's request of 2026-10-29: a place in
-- the piping page to register the key and the server address — an
-- OpenAI-compatible service such as Liara's, or the relay that holds the
-- Claude / Gemini key — instead of the server's environment).
--
--   llm_endpoint   one per project and provider. The address, which kind of
--                  secret it takes (an API key, or the relay's token), the
--                  secret itself SEALED (lib/server/secret-box.mjs: AES-256-GCM
--                  bound to project and provider — the plaintext is never
--                  stored and never sent back to a browser), its last four
--                  characters as a hint, and for an OpenAI-compatible
--                  endpoint the model ids it serves (first = extraction,
--                  second = repair pass).
--
-- Written by a project admin only (the route, app/api/llm-endpoints); read
-- back without the secret. Where an endpoint is registered it takes the place
-- of the environment's setting for that provider in that project.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE llm_endpoint (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('anthropic', 'gemini', 'openai-compatible')),
  base_url     text NOT NULL CHECK (length(base_url) BETWEEN 8 AND 300),
  secret_kind  text NOT NULL CHECK (secret_kind IN ('api_key', 'relay_token')),
  secret_enc   text,
  secret_hint  text,
  models       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(models) <= 12),
  updated_by   uuid REFERENCES app_user(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, provider),
  CHECK (secret_enc IS NULL OR secret_enc LIKE 'v1.%'),
  CHECK (secret_enc IS NOT NULL OR provider = 'openai-compatible')
);

ALTER TABLE llm_endpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_endpoint FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON llm_endpoint USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON llm_endpoint TO app_rw;
-- the reporting role never reads a secret, sealed or not
