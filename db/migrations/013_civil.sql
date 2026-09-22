-- ─────────────────────────────────────────────────────────────────────────
-- Civil: foundations, pours and the cylinders that judge them.
--
-- A foundation is a TAG with discipline 'civil', not a table of its own. That
-- puts it on the spine the day it exists — subsystem, contractor packages,
-- the readiness views and the precedence engine all work on it unchanged —
-- instead of civil growing a parallel system that has to be joined back.
--
-- What civil adds is what only civil has: the concrete that was specified,
-- the concrete that was poured, and the specimens a lab broke. Whether that
-- concrete is acceptable is decided in lib/civil/concrete.mjs (ACI 318), not
-- stored here: a stored "accepted" is wrong the moment the next test of the
-- same class lands and pulls the three-test average under f′c.
-- ─────────────────────────────────────────────────────────────────────────

-- The equipment a foundation carries. A big machine can stand on more than
-- one foundation, so this points from the foundation to the equipment and
-- the equipment is ready to set when ALL of them are handed over.
ALTER TABLE tag ADD COLUMN carries_tag_id uuid REFERENCES tag(id) ON DELETE SET NULL;
ALTER TABLE tag ADD CONSTRAINT carries_not_itself CHECK (carries_tag_id IS NULL OR carries_tag_id <> id);
CREATE INDEX tag_carries_idx ON tag (carries_tag_id);

-- The project's concrete specification. Curing period is NOT defaulted: it
-- decides when forms come off and when a foundation is loaded, and it is the
-- specification's number to state, not this schema's to assume.
ALTER TABLE project
  ADD COLUMN concrete_curing_days    int,
  ADD COLUMN concrete_sample_per_m3  numeric(8,1);   -- sampling volume, if the spec differs from ACI's

ALTER TABLE project ADD CONSTRAINT curing_days_sane
  CHECK (concrete_curing_days IS NULL OR concrete_curing_days BETWEEN 0 AND 90);

-- ── what was specified ───────────────────────────────────────────────────

CREATE TABLE foundation_spec (
  tag_id          uuid PRIMARY KEY REFERENCES tag(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  concrete_class  text NOT NULL,            -- as the drawing writes it: C30, C35/45, ...
  fc_mpa          numeric(5,1) NOT NULL,    -- specified cylinder strength
  fc_age_days     int NOT NULL DEFAULT 28,  -- the code's own default age for f′c
  volume_m3       numeric(8,2),
  drawing_ref     text,
  anchor_bolt_ref text                      -- the vendor's certified anchor-bolt drawing
);
ALTER TABLE foundation_spec ADD CONSTRAINT fc_positive CHECK (fc_mpa > 0);

-- ── what was poured ──────────────────────────────────────────────────────

CREATE TABLE concrete_pour (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id          uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  pour_no         text NOT NULL,            -- the pour card number
  poured_on       date NOT NULL,
  volume_m3       numeric(8,2),
  -- The class ACTUALLY delivered, from the batch ticket — compared against
  -- foundation_spec, never copied from it. A C25 truck on a C30 foundation
  -- is exactly what this comparison is for.
  concrete_class  text NOT NULL,
  fc_mpa          numeric(5,1) NOT NULL,
  fc_age_days     int NOT NULL DEFAULT 28,
  supplier        text,
  ticket_ref      text,
  contractor_id   uuid REFERENCES contractor(id) ON DELETE SET NULL,
  recorded_by     uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, pour_no)
);
CREATE INDEX concrete_pour_tag_idx ON concrete_pour (tag_id);

-- ── what the lab broke ───────────────────────────────────────────────────
--
-- One row per SPECIMEN, not per test. A strength test is the average of the
-- specimens of one sample at one age; holding the specimens is what lets the
-- engine refuse a "test" of one cylinder instead of trusting an average
-- somebody typed.

CREATE TABLE concrete_specimen (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  pour_id        uuid NOT NULL REFERENCES concrete_pour(id) ON DELETE CASCADE,
  sample_no      text NOT NULL,             -- specimens of one sample share this
  specimen_type  text NOT NULL,
  age_days       int NOT NULL,
  mpa            numeric(5,1) NOT NULL,
  tested_on      date,
  lab_ref        text,
  recorded_by    uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX concrete_specimen_pour_idx ON concrete_specimen (pour_id);

ALTER TABLE concrete_specimen ADD CONSTRAINT specimen_type_known
  CHECK (specimen_type IN ('cyl150', 'cyl100', 'cube150', 'cube100'));
ALTER TABLE concrete_specimen ADD CONSTRAINT specimen_mpa_sane CHECK (mpa > 0 AND mpa < 200);
ALTER TABLE concrete_specimen ADD CONSTRAINT specimen_age_sane CHECK (age_days BETWEEN 1 AND 365);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['foundation_spec', 'concrete_pour', 'concrete_specimen'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON foundation_spec, concrete_pour, concrete_specimen TO app_rw;
GRANT SELECT ON foundation_spec, concrete_pour, concrete_specimen TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────
--
-- Facts only. Acceptance is the engine's (a running three-test average is
-- awkward and easy to get subtly wrong in a BI tool), but the raw breaks are
-- here for anyone who wants to chart strength development.

CREATE VIEW reporting.fact_concrete_specimen WITH (security_invoker = true) AS
SELECT s.id AS specimen_key, s.project_id AS project_key, p.tag_id AS foundation_key,
       t.tag_no AS foundation_no, p.pour_no, p.poured_on, p.concrete_class, p.fc_mpa,
       s.sample_no, s.specimen_type, s.age_days, s.mpa, s.tested_on,
       (fs.concrete_class IS NOT NULL AND fs.concrete_class <> p.concrete_class) AS class_mismatch
  FROM concrete_specimen s
  JOIN concrete_pour p ON p.id = s.pour_id
  JOIN tag t ON t.id = p.tag_id
  LEFT JOIN foundation_spec fs ON fs.tag_id = p.tag_id;

GRANT SELECT ON reporting.fact_concrete_specimen TO app_rw, app_report;
