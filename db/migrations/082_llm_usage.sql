-- ─────────────────────────────────────────────────────────────────────────
-- Model usage accounting (owner's request 2026-10-21): every call to a model
-- — each pass of an isometric reading, its repair pass — is written down
-- with the tokens it spent, who asked and for which project, so the tokens
-- (and, where a price is configured, the cost) can be counted and a monthly
-- allowance enforced.
--
-- Append-only: the application may add a row and read rows, never change or
-- remove one — usage that can be edited is not an account. Token counts the
-- provider did not report stay NULL (unknown), never 0.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE llm_usage (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES app_user(id),
  at             timestamptz NOT NULL DEFAULT now(),
  provider       text NOT NULL,
  via            text,
  model          text NOT NULL,
  pass           text NOT NULL,
  input_tokens   integer CHECK (input_tokens >= 0),
  output_tokens  integer CHECK (output_tokens >= 0),
  ok             boolean NOT NULL,
  error_code     text,
  stop_reason    text,
  ms             integer CHECK (ms >= 0)
);
CREATE INDEX llm_usage_project_at ON llm_usage (project_id, at);

ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON llm_usage USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
-- the default privileges of 001_core give app_rw every right on a new table;
-- an account takes UPDATE and DELETE back (the test that tries both caught it)
REVOKE UPDATE, DELETE, TRUNCATE ON llm_usage FROM app_rw;
GRANT SELECT, INSERT ON llm_usage TO app_rw;
GRANT SELECT ON llm_usage TO app_report;
