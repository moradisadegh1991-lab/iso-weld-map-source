-- Additive hardening of 120. A committed receipt always contains a complete result.
-- Existing incomplete receipts must be investigated before applying this migration.
ALTER TABLE web_spool_operation ALTER COLUMN result SET NOT NULL;
ALTER TABLE web_spool_operation ADD CONSTRAINT web_spool_operation_result_object
  CHECK (jsonb_typeof(result) = 'object' AND result ? 'id' AND result->>'id' IS NOT NULL);

CREATE FUNCTION web_spool_operation_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'web_spool_operation is append-only' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER web_spool_operation_no_change BEFORE UPDATE OR DELETE ON web_spool_operation
  FOR EACH ROW EXECUTE FUNCTION web_spool_operation_append_only();
CREATE TRIGGER web_spool_operation_no_truncate BEFORE TRUNCATE ON web_spool_operation
  FOR EACH STATEMENT EXECUTE FUNCTION web_spool_operation_append_only();
