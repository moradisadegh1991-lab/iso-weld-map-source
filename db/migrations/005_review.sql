-- ─────────────────────────────────────────────────────────────────────────
-- EPIC-5 · human in the loop
--
-- Two things live here. A record of every correction an engineer made to what
-- the model read, field by field — which is the most useful dataset this
-- programme produces, because it says exactly where extraction is weak. And
-- the lock that stops an approved register drifting: once someone has signed
-- it, the next change is a new revision, not an edit.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE extraction_edit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  extraction_run_id uuid NOT NULL REFERENCES extraction_run(id) ON DELETE CASCADE,
  document_id       uuid REFERENCES document(id) ON DELETE SET NULL,
  -- "nodes[2].E" — fine-grained on purpose. "the engineer changed the nodes"
  -- is not actionable; a path and two values are.
  path              text NOT NULL,
  field             text NOT NULL,
  kind              text NOT NULL,          -- changed | added | removed
  before_value      jsonb,
  after_value       jsonb,
  reason            text,
  edited_by         uuid REFERENCES app_user(id) ON DELETE SET NULL,
  edited_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX extraction_edit_run_idx ON extraction_edit (project_id, extraction_run_id);
CREATE INDEX extraction_edit_field_idx ON extraction_edit (project_id, field);

-- A run is where a register lives, so the lock belongs on the run. `locked_at`
-- is set when it is approved and is what every write path checks.
ALTER TABLE extraction_run
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN superseded_by_run uuid REFERENCES extraction_run(id) ON DELETE SET NULL;

-- Approving locks. Doing it in the database rather than only in application
-- code means a second service, a script or a future route cannot forget.
CREATE OR REPLACE FUNCTION lock_on_approval() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    NEW.locked_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER extraction_run_lock
  BEFORE UPDATE ON extraction_run
  FOR EACH ROW EXECUTE FUNCTION lock_on_approval();

-- And refuse to change the substance of a locked run. The status may still
-- move to 'superseded' when a later revision takes over, which is the one
-- legitimate change to a signed record.
CREATE OR REPLACE FUNCTION refuse_locked_edit() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL
     AND (NEW.payload IS DISTINCT FROM OLD.payload
          OR NEW.validation_checks IS DISTINCT FROM OLD.validation_checks) THEN
    RAISE EXCEPTION 'extraction run % is approved and locked; issue a new revision instead', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER extraction_run_locked_guard
  BEFORE UPDATE ON extraction_run
  FOR EACH ROW EXECUTE FUNCTION refuse_locked_edit();

ALTER TABLE extraction_edit ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_edit FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON extraction_edit
  USING (project_id = current_project_id())
  WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON extraction_edit TO app_rw;
