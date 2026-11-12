-- Phase 2e: transactional idempotency for web spool activity commands.
-- Store the immutable operation request and result in the same transaction as
-- spool_activity/material_override. An identical retry returns the first result.
-- A reused operation UUID with a different request or actor is refused.
CREATE TABLE web_spool_operation (
  op_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id),
  request_hash char(64) NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT web_spool_operation_hash CHECK (request_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX web_spool_operation_project_at ON web_spool_operation (project_id, created_at DESC);
ALTER TABLE web_spool_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_spool_operation FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON web_spool_operation
  USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
REVOKE UPDATE, DELETE, TRUNCATE ON web_spool_operation FROM app_rw;
GRANT SELECT, INSERT ON web_spool_operation TO app_rw;
GRANT SELECT ON web_spool_operation TO app_report;
