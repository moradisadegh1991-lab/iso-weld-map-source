-- ─────────────────────────────────────────────────────────────────────────
-- Electrical: the cable schedule and what is done to each cable.
--
-- Cables are not tags. A plant has thousands, and each one is an item worked
-- on — pulled, terminated, tested — exactly as a weld is. What ties a cable
-- to the spine is the TAG it feeds (to_tag_id): that is how a motor's
-- "electrical" step comes to be answered by its cables instead of a tick.
--
-- Whether an IR test passes is decided in lib/electrical/cable.mjs, not
-- stored here: the minimum depends on the circuit voltage and the project's
-- spec, both of which can be corrected after the test was recorded.
-- ─────────────────────────────────────────────────────────────────────────

-- The project's electrical spec. None of these is defaulted: IEC 60364-6
-- keys the LV test on the circuit's nominal voltage, and MV acceptance is
-- the commissioning spec's number, not this schema's.
ALTER TABLE project
  ADD COLUMN lv_system_voltage_v  int,
  ADD COLUMN mv_ir_test_voltage_v int,
  ADD COLUMN mv_ir_min_mohm       numeric(10,1);

CREATE TABLE cable (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  cable_no         text NOT NULL,
  from_ref         text,
  to_ref           text,
  to_tag_id        uuid REFERENCES tag(id) ON DELETE SET NULL,
  subsystem_id     uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  cable_spec       text,             -- as the schedule wrote it
  cores            int,
  size_mm2         numeric(7,2),
  rating           text,             -- normalised, e.g. "0.6/1 kV"
  u_kv             numeric(6,3),
  voltage_class    text,
  system_voltage_v int,              -- the circuit's nominal voltage, if the schedule gives it
  length_m         numeric(9,1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, cable_no)
);
CREATE INDEX cable_to_tag_idx ON cable (to_tag_id);
ALTER TABLE cable ADD CONSTRAINT cable_voltage_class_known
  CHECK (voltage_class IS NULL OR voltage_class IN ('LV', 'MV'));

CREATE TABLE cable_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  cable_id      uuid NOT NULL REFERENCES cable(id) ON DELETE CASCADE,
  code          text NOT NULL,
  status        activity_status NOT NULL,
  done_at       date,
  ref_no        text,
  note          text,
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  recorded_by   uuid REFERENCES app_user(id),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, cable_id, code)
);
CREATE INDEX cable_activity_cable_idx ON cable_activity (cable_id);
ALTER TABLE cable_activity ADD CONSTRAINT cable_done_is_dated
  CHECK (status <> 'done' OR done_at IS NOT NULL);

-- One row per test, readings as the instrument showed them (">2000" kept
-- as written). A re-test after a repair is a new row; the latest decides.
CREATE TABLE ir_test (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  cable_id        uuid NOT NULL REFERENCES cable(id) ON DELETE CASCADE,
  test_voltage_v  int NOT NULL,
  readings        jsonb NOT NULL,
  tested_on       date NOT NULL,
  instrument_ref  text,
  tester          text,
  recorded_by     uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ir_test_cable_idx ON ir_test (cable_id);
ALTER TABLE ir_test ADD CONSTRAINT ir_test_voltage_positive CHECK (test_voltage_v > 0);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cable', 'cable_activity', 'ir_test'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON cable, cable_activity, ir_test TO app_rw;
GRANT SELECT ON cable, cable_activity, ir_test TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_cable WITH (security_invoker = true) AS
SELECT c.id AS cable_key, c.project_id AS project_key, c.subsystem_id AS subsystem_key,
       c.to_tag_id AS tag_key, c.cable_no, c.from_ref, c.to_ref, c.cores, c.size_mm2,
       c.rating, c.voltage_class, c.length_m,
       EXISTS (SELECT 1 FROM cable_activity a WHERE a.cable_id = c.id
                 AND a.code = 'pulled' AND a.status = 'done') AS is_pulled,
       -- `ready` cannot be recorded while any earlier step is open (the
       -- repository refuses it), so it stands for "tested and accepted".
       EXISTS (SELECT 1 FROM cable_activity a WHERE a.cable_id = c.id
                 AND a.code = 'ready' AND a.status = 'done') AS is_ready
  FROM cable c;

-- The second branch of the cross-discipline grain declared in 007: cables
-- count in subsystem readiness beside welds, and nothing above changes.
-- Columns as 008 left them, tag_key last. Anything reading this view by
-- tag_key alone now sees cables too — derivePiping filters on discipline.
CREATE OR REPLACE VIEW reporting.fact_progress WITH (security_invoker = true) AS
SELECT 'piping'::discipline AS discipline,
       f.project_key,
       COALESCE(l.subsystem_id, d.subsystem_id) AS subsystem_key,
       f.weld_uid::text  AS item_uid,
       f.weld_no         AS item_no,
       f.is_welded       AS is_installed,
       f.is_examined     AS is_tested,
       l.tag_id          AS tag_key
  FROM reporting.fact_weld f
  LEFT JOIN line     l ON l.id = f.line_key
  LEFT JOIN document d ON d.id = f.document_key
UNION ALL
SELECT 'electrical'::discipline, c.project_key, c.subsystem_key,
       c.cable_key::text, c.cable_no, c.is_pulled, c.is_ready, c.tag_key
  FROM reporting.fact_cable c;

GRANT SELECT ON reporting.fact_cable TO app_rw, app_report;
