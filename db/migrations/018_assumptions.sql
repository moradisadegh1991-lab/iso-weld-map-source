-- ─────────────────────────────────────────────────────────────────────────
-- The project assumption register (Digitalization Master Plan §2.51–2.53).
--
-- An assumption is a statement the design depends on that is not yet a
-- verified project fact: "the plant is greenfield", "ethane is the only
-- feed". It is DATA, with an owner, a status and a history — not a comment in
-- a document nobody reopens. Changing one writes a revision; it is never
-- edited in place, because the decisions that referenced the old value have
-- to be findable.
--
-- The missing-information register (what is UNKNOWN and what it blocks) is
-- not stored: it is computed from what the engines refuse on, so it can
-- never disagree with them (lib/db/repos/assumptions.mjs).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE project_assumption (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code           text NOT NULL,                 -- A-001
  category       text NOT NULL,
  description    text NOT NULL,
  value          text,
  source         text,                          -- where it came from: a document, a meeting, the master plan
  owner          text,                          -- the discipline or role accountable for it
  status         text NOT NULL DEFAULT 'proposed',
  impact         text NOT NULL DEFAULT 'medium',
  risk           text,                          -- what goes wrong if it turns out false
  revision       int  NOT NULL DEFAULT 0,
  decided_by     uuid REFERENCES app_user(id),  -- who approved, rejected or superseded it
  decided_at     timestamptz,
  created_by     uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
ALTER TABLE project_assumption ADD CONSTRAINT assumption_status_known
  CHECK (status IN ('proposed', 'under_review', 'approved', 'rejected', 'superseded', 'unknown'));
ALTER TABLE project_assumption ADD CONSTRAINT assumption_impact_known
  CHECK (impact IN ('low', 'medium', 'high'));
-- A decision names who took it.
ALTER TABLE project_assumption ADD CONSTRAINT assumption_decision_signed
  CHECK (status NOT IN ('approved', 'rejected', 'superseded') OR decided_by IS NOT NULL);

-- Every earlier revision, as it stood.
CREATE TABLE project_assumption_revision (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  assumption_id  uuid NOT NULL REFERENCES project_assumption(id) ON DELETE CASCADE,
  revision       int  NOT NULL,
  snapshot       jsonb NOT NULL,
  reason         text,
  changed_by     uuid REFERENCES app_user(id),
  changed_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (assumption_id, revision)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_assumption', 'project_assumption_revision'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- Revisions are history: the application may add them, never change them.
-- 001 gives app_rw UPDATE and DELETE on every new table by default, so a
-- GRANT of SELECT, INSERT alone would still leave history editable; the
-- REVOKE is what makes it append-only (db/test/assumptions.mjs checks).
GRANT SELECT, INSERT, UPDATE, DELETE ON project_assumption TO app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON project_assumption_revision FROM app_rw;
GRANT SELECT, INSERT ON project_assumption_revision TO app_rw;
GRANT SELECT ON project_assumption, project_assumption_revision TO app_report;

CREATE VIEW reporting.dim_assumption WITH (security_invoker = true) AS
SELECT id AS assumption_key, project_id AS project_key, code, category, description, value,
       source, owner, status, impact, revision, decided_at
  FROM project_assumption;
GRANT SELECT ON reporting.dim_assumption TO app_rw, app_report;
