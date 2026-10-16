-- Form numbers: every record the platform itself issues (a permit, a pour
-- card, an NCR, a PO, a work order…) takes its number from its form's code
-- and the next number of that form in the project — PTW-0001, PTW-0002 —
-- instead of a number somebody types and somebody else types again.
--
-- A number printed on a document from outside (the designer's transmittal,
-- a heat number, a tag or line number from the drawings) is not a form
-- number and stays as written.
--
-- form_counter holds the last number handed out, per form (and per scope,
-- such as a punch list per subsystem). The next number is taken with one
-- UPSERT, so two people saving at once never get the same one; a number
-- someone typed by hand is skipped rather than issued twice.
--
-- form_code lets a project name its forms its own way (DMW-PTW, HW…);
-- without a row the platform's default code is used.

CREATE TABLE form_counter (
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  form       text NOT NULL,
  last_no    integer NOT NULL DEFAULT 0 CHECK (last_no >= 0),
  PRIMARY KEY (project_id, form)
);

CREATE TABLE form_code (
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  form       text NOT NULL,
  code       text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,15}$'),
  set_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  set_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, form)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['form_counter', 'form_code'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT ON form_counter, form_code TO app_report;
