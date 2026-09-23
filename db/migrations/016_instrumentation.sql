-- ─────────────────────────────────────────────────────────────────────────
-- Instrumentation: the instrument index, calibrations and loop checks.
--
-- Instruments are items, like cables and welds: thousands of them, each
-- tied to the equipment it serves (eq_tag_id), which is how a machine's
-- "instrument" step comes to be answered by its instruments.
--
-- A loop check is recorded ONCE PER LOOP, not per instrument: the check is of
-- the loop — field device, wiring, marshalling, DCS point, alarm — and every
-- instrument in it takes its loop_check step from that one signature.
-- ─────────────────────────────────────────────────────────────────────────

-- The project's calibration tolerance (% of span), when an instrument's own
-- datasheet does not state one. Not defaulted.
ALTER TABLE project ADD COLUMN calibration_tolerance_pct numeric(6,3);

CREATE TABLE instrument (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_no          text NOT NULL,
  service         text,
  type_text       text,
  category        text,             -- from the ISA 5.1 letters; NULL when unreadable
  variable        text,
  loop_no         text,
  loop_derived    boolean NOT NULL DEFAULT false,
  eq_tag_id       uuid REFERENCES tag(id) ON DELETE SET NULL,
  subsystem_id    uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  range_lo        numeric(14,4),
  range_hi        numeric(14,4),
  range_unit      text,
  tolerance_pct   numeric(6,3),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, tag_no)
);
CREATE INDEX instrument_eq_idx ON instrument (eq_tag_id);
CREATE INDEX instrument_loop_idx ON instrument (project_id, loop_no);
ALTER TABLE instrument ADD CONSTRAINT instrument_category_known CHECK (category IS NULL OR category IN
  ('transmitter', 'gauge', 'switch', 'valve', 'safety_valve', 'element', 'controller', 'other'));

CREATE TABLE instrument_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  instrument_id uuid NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
  code          text NOT NULL,
  status        activity_status NOT NULL,
  done_at       date,
  ref_no        text,
  note          text,
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  recorded_by   uuid REFERENCES app_user(id),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, instrument_id, code)
);
CREATE INDEX instrument_activity_idx ON instrument_activity (instrument_id);
ALTER TABLE instrument_activity ADD CONSTRAINT instrument_done_is_dated
  CHECK (status <> 'done' OR done_at IS NOT NULL);

-- Points as measured; the verdict is the engine's. A re-calibration is a new
-- row and the latest decides — by date, then by entry time, which is
-- clock_timestamp(): now() is fixed for a whole transaction, so two records
-- entered in one request would tie and "latest" would be arbitrary.
CREATE TABLE calibration (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  instrument_id   uuid NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
  points          jsonb NOT NULL,
  calibrated_on   date NOT NULL,
  calibrator_ref  text,             -- the reference standard and its certificate
  certificate_ref text,
  recorded_by     uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX calibration_instrument_idx ON calibration (instrument_id);

CREATE TABLE loop_check (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  loop_no       text NOT NULL,
  checked_on    date NOT NULL,
  ref_no        text,
  witnessed_by  text,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, loop_no)
);

-- The same tie, fixed where "latest decides" already ships: IR re-tests,
-- column re-shoots, bolting re-verifications.
ALTER TABLE ir_test       ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE plumb_reading ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE bolting_record ALTER COLUMN created_at SET DEFAULT clock_timestamp();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['instrument', 'instrument_activity', 'calibration', 'loop_check'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON instrument, instrument_activity, calibration, loop_check TO app_rw;
GRANT SELECT ON instrument, instrument_activity, calibration, loop_check TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_instrument WITH (security_invoker = true) AS
SELECT i.id AS instrument_key, i.project_id AS project_key, i.subsystem_id AS subsystem_key,
       i.eq_tag_id AS tag_key, i.tag_no, i.category, i.loop_no, i.range_lo, i.range_hi, i.range_unit,
       EXISTS (SELECT 1 FROM instrument_activity a WHERE a.instrument_id = i.id
                 AND a.code = 'installed' AND a.status = 'done') AS is_installed,
       EXISTS (SELECT 1 FROM loop_check l WHERE l.project_id = i.project_id
                 AND l.loop_no = i.loop_no) AS is_loop_checked,
       -- `ready` is refused while anything before it is open, so it stands
       -- for "calibrated, installed, connected and loop-checked".
       EXISTS (SELECT 1 FROM instrument_activity a WHERE a.instrument_id = i.id
                 AND a.code = 'ready' AND a.status = 'done') AS is_ready
  FROM instrument i;

-- Third branch of the cross-discipline grain (007, 008, 015).
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
  FROM reporting.fact_cable c
UNION ALL
SELECT 'instrumentation'::discipline, i.project_key, i.subsystem_key,
       i.instrument_key::text, i.tag_no, i.is_installed, i.is_ready, i.tag_key
  FROM reporting.fact_instrument i;

GRANT SELECT ON reporting.fact_instrument TO app_rw, app_report;
