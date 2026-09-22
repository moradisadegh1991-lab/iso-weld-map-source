-- ─────────────────────────────────────────────────────────────────────────
-- Structural steel: pipe racks, platforms, shelters.
--
-- A structure is a TAG with discipline 'structural' and kind 'structure', for
-- the same reason a foundation is one: it lands on the spine the day it is
-- registered, and the foundations under it answer its first step through
-- tag.carries_tag_id exactly as they do for a machine.
--
-- What structural adds is what only structural has: the column survey and
-- the bolting records. Whether a column is plumb or a joint is properly
-- pretensioned is decided in lib/structural/steel.mjs, not stored here.
-- ─────────────────────────────────────────────────────────────────────────

-- The erection standard is the contract's choice, not this schema's: 1:500
-- and h/300 are both right, for different contracts.
ALTER TABLE project ADD COLUMN steel_erection_standard text;
ALTER TABLE project ADD CONSTRAINT steel_erection_standard_known
  CHECK (steel_erection_standard IS NULL OR steel_erection_standard IN ('AISC303', 'EN1090-2'));

CREATE TABLE structure_spec (
  tag_id                 uuid PRIMARY KEY REFERENCES tag(id) ON DELETE CASCADE,
  project_id             uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  structure_type         text NOT NULL,
  -- Counts from the erection drawings. Without them "every column surveyed"
  -- and "every joint bolted" cannot be said, and the steps stay in progress.
  columns                int,
  bolted_joints          int,
  -- NULL = not stated (the step stays a manual record); false = not
  -- required (the step does not apply); true = required.
  fireproofing_required  boolean,
  tonnage_t              numeric(9,2),
  drawing_ref            text
);
ALTER TABLE structure_spec ADD CONSTRAINT structure_type_known
  CHECK (structure_type IN ('pipe_rack', 'platform', 'shelter', 'structure'));
ALTER TABLE structure_spec ADD CONSTRAINT structure_counts_positive
  CHECK ((columns IS NULL OR columns > 0) AND (bolted_joints IS NULL OR bolted_joints > 0));

-- One row per column per survey. A re-shoot after correction is a new row;
-- the engine judges the latest, and the history shows the correction.
CREATE TABLE plumb_reading (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id       uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  column_mark  text NOT NULL,
  height_mm    numeric(8,1) NOT NULL,     -- between working points
  dx_mm        numeric(6,1) NOT NULL,     -- top relative to base, plant east
  dy_mm        numeric(6,1) NOT NULL,     -- top relative to base, plant north
  surveyed_on  date NOT NULL,
  surveyor     text,
  recorded_by  uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plumb_reading_tag_idx ON plumb_reading (tag_id);
ALTER TABLE plumb_reading ADD CONSTRAINT plumb_height_positive CHECK (height_mm > 0);

-- One row per batch of joints tightened the same way. The verification is
-- what the method reached on a tension calibrator before installation.
CREATE TABLE bolting_record (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id        uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  joint_type    text NOT NULL,
  bolt_grade    text NOT NULL,
  bolt_size     text NOT NULL,
  method        text,
  joints        int NOT NULL,
  verified_kn   numeric(7,1),
  lot_ref       text,
  inspected_on  date NOT NULL,
  inspector     text,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bolting_record_tag_idx ON bolting_record (tag_id);
ALTER TABLE bolting_record ADD CONSTRAINT bolting_joint_type_known
  CHECK (joint_type IN ('snug', 'pretensioned', 'slip_critical'));
ALTER TABLE bolting_record ADD CONSTRAINT bolting_grade_known
  CHECK (bolt_grade IN ('A325M', 'A490M', '8.8', '10.9'));
ALTER TABLE bolting_record ADD CONSTRAINT bolting_size_known
  CHECK (bolt_size IN ('M12', 'M16', 'M20', 'M22', 'M24', 'M27', 'M30', 'M36'));
ALTER TABLE bolting_record ADD CONSTRAINT bolting_method_known
  CHECK (method IS NULL OR method IN
    ('turn_of_nut', 'calibrated_wrench', 'twist_off', 'dti', 'torque', 'combined'));
ALTER TABLE bolting_record ADD CONSTRAINT bolting_joints_positive CHECK (joints > 0);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['structure_spec', 'plumb_reading', 'bolting_record'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON structure_spec, plumb_reading, bolting_record TO app_rw;
GRANT SELECT ON structure_spec, plumb_reading, bolting_record TO app_report;

-- ── reporting: raw facts, verdicts stay in the engine ────────────────────

CREATE VIEW reporting.fact_plumb_reading WITH (security_invoker = true) AS
SELECT r.id AS reading_key, r.project_id AS project_key, r.tag_id AS structure_key,
       t.tag_no AS structure_no, r.column_mark, r.height_mm, r.dx_mm, r.dy_mm, r.surveyed_on
  FROM plumb_reading r JOIN tag t ON t.id = r.tag_id;

CREATE VIEW reporting.fact_bolting WITH (security_invoker = true) AS
SELECT b.id AS bolting_key, b.project_id AS project_key, b.tag_id AS structure_key,
       t.tag_no AS structure_no, b.joint_type, b.bolt_grade, b.bolt_size, b.method,
       b.joints, b.verified_kn, b.inspected_on
  FROM bolting_record b JOIN tag t ON t.id = b.tag_id;

GRANT SELECT ON reporting.fact_plumb_reading, reporting.fact_bolting TO app_rw, app_report;
