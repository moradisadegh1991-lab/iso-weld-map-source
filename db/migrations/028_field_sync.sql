-- ─────────────────────────────────────────────────────────────────────────
-- Operations captured on site, possibly offline, and what became of them.
--
-- One row per operation id made on the phone. The id is the idempotency
-- key: a retried sync finds the row and returns the recorded outcome
-- instead of applying the operation again. An applied operation's row is
-- written in the same transaction as the record it made, so the two cannot
-- disagree; a refused one is kept with its reason, because "the site
-- entered it and the server said no" is itself something to follow up.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE field_op (
  op_id        uuid PRIMARY KEY,
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  payload      jsonb NOT NULL,
  captured_at  timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  user_id      uuid REFERENCES app_user(id),
  status       text NOT NULL,
  result       jsonb,
  error        text
);
ALTER TABLE field_op ADD CONSTRAINT field_op_status_known CHECK (status IN ('applied', 'rejected'));
ALTER TABLE field_op ADD CONSTRAINT field_op_rejection_says_why CHECK (status = 'applied' OR error IS NOT NULL);
CREATE INDEX field_op_project_received ON field_op (project_id, received_at DESC);

ALTER TABLE field_op ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_op FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON field_op USING (project_id = current_project_id())
  WITH CHECK (project_id = current_project_id());

REVOKE UPDATE, DELETE, TRUNCATE ON field_op FROM app_rw;
GRANT SELECT, INSERT ON field_op TO app_rw;
GRANT SELECT ON field_op TO app_report;
