-- ─────────────────────────────────────────────────────────────────────────
-- Where the plant is, what happens to a spool, and what holds it up.
-- ─────────────────────────────────────────────────────────────────────────

-- ── plant siting ─────────────────────────────────────────────────────────
--
-- Isometrics print coordinates in the PLANT grid — E, N and EL in mm —
-- not in latitude and longitude. The grid has an origin somewhere real, a
-- plant north that may not be true north, and an elevation datum. Those
-- three facts are what let a coordinate on a drawing be placed on the earth,
-- and they are what a surveyor asks for first.
--
-- The one that matters to piping every day is GRADE ELEVATION: the EL of
-- finished ground. A weld below it is buried, which changes its coating,
-- its cathodic protection, its test sequence (it must be tested before
-- backfill) and who digs the trench. Many Iranian projects set plant grade
-- ±0.00 at EL 100 000 mm precisely so that underground piping never has a
-- negative elevation — which is why the demo drawing's tie-in at EL 96 846
-- is 3.15 m underground, and nothing in the platform could say so until now.
--
-- It is NOT defaulted. A grade of 100 000 assumed where the project uses
-- 0.00 would classify every pipe rack in the plant as buried.

ALTER TABLE project
  ADD COLUMN origin_latitude     numeric(9,6),   -- WGS84, the plant grid's zero point
  ADD COLUMN origin_longitude    numeric(9,6),
  ADD COLUMN grid_origin_e_mm    numeric(14,1),  -- the grid value AT that point, usually 0
  ADD COLUMN grid_origin_n_mm    numeric(14,1),
  ADD COLUMN plant_north_deg     numeric(6,2),   -- plant north, clockwise from true north
  ADD COLUMN elevation_datum     text,           -- e.g. "MSL", "Plant grade ±0.00 = EL 100000"
  ADD COLUMN grade_elevation_mm  numeric(12,1),  -- EL of finished grade, in drawing units
  ADD COLUMN min_cover_mm        numeric(8,1);   -- burial cover the project specifies

ALTER TABLE project ADD CONSTRAINT origin_latitude_range
  CHECK (origin_latitude IS NULL OR origin_latitude BETWEEN -90 AND 90);
ALTER TABLE project ADD CONSTRAINT origin_longitude_range
  CHECK (origin_longitude IS NULL OR origin_longitude BETWEEN -180 AND 180);
-- Half a coordinate pair is not a location.
ALTER TABLE project ADD CONSTRAINT origin_is_a_pair
  CHECK ((origin_latitude IS NULL) = (origin_longitude IS NULL));
ALTER TABLE project ADD CONSTRAINT plant_north_range
  CHECK (plant_north_deg IS NULL OR plant_north_deg > -360 AND plant_north_deg < 360);

-- ── buried or above ground, computed ─────────────────────────────────────
--
-- `weld.pos_el` is already stored, so nothing new is written per weld: the
-- classification is a comparison made when it is read. When the project has
-- no grade elevation, SQL's three-valued logic makes `is_buried` NULL — no
-- verdict — which is exactly the behaviour wanted and costs nothing.
--
-- The same comparison is made in lib/engine.js for the preview before a
-- register is saved. Two implementations of one formula is unavoidable
-- across the browser and the database; db/test/execution.mjs checks they
-- agree on the same weld.
--
-- Columns are appended, never inserted, so the views built on this one
-- keep working unchanged.

CREATE OR REPLACE VIEW reporting.fact_weld WITH (security_invoker = true) AS
SELECT w.weld_uid,
       w.project_id  AS project_key,
       w.line_id     AS line_key,
       w.document_id AS document_key,
       w.spool_id    AS spool_key,
       e.welder_id   AS welder_key,
       w.weld_no, w.weld_kind, w.shop_field, w.joint_role,
       w.nps, w.elevation_mm, w.ndt_requirement,
       (w.shop_field = 'Field')          AS is_field_weld,
       (e.weld_uid IS NOT NULL)          AS is_welded,
       e.welded_at,
       e.process,
       (e.pwht_report_no IS NOT NULL)    AS pwht_done,
       (n.first_result IS NOT NULL)      AS is_examined,
       n.first_result                    AS ndt_first_result,
       COALESCE(n.shots, 0)              AS ndt_shots,
       (e.weld_uid IS NOT NULL AND n.first_result IS NULL) AS awaiting_ndt,
       w.pos_el,
       (w.pos_el < p.grade_elevation_mm) AS is_buried,
       (w.pos_el - p.grade_elevation_mm) AS height_above_grade_mm
  FROM weld w
  JOIN reporting.current_run cr ON cr.run_id = w.extraction_run_id
  JOIN project p ON p.id = w.project_id
  LEFT JOIN weld_execution e
         ON e.weld_uid = w.weld_uid AND e.project_id = w.project_id
  LEFT JOIN LATERAL (
        SELECT COUNT(*) AS shots,
               MAX(r.result::text) FILTER (WHERE r.repair_cycle = 0) AS first_result
          FROM ndt_record r
         WHERE r.weld_uid = w.weld_uid AND r.project_id = w.project_id
       ) n ON true;

-- Per line: how much of it is in the ground. `unknown` is its own column
-- rather than being folded into "above ground", because a project that has
-- not recorded its grade has not told anyone which of its welds are buried.
CREATE VIEW reporting.kpi_buried_exposure WITH (security_invoker = true) AS
SELECT f.project_key, f.line_key, l.line_no,
       COUNT(*)                                        AS welds,
       COUNT(*) FILTER (WHERE f.is_buried)             AS buried,
       COUNT(*) FILTER (WHERE f.is_buried = false)     AS above_ground,
       COUNT(*) FILTER (WHERE f.is_buried IS NULL)     AS unknown,
       MIN(f.height_above_grade_mm)                    AS deepest_mm
  FROM reporting.fact_weld f
  LEFT JOIN line l ON l.id = f.line_key
 GROUP BY f.project_key, f.line_key, l.line_no;

-- ── piping execution, step by step ───────────────────────────────────────
--
-- The same shape as tag_activity, for the same reasons: the ORDER lives in
-- lib/platform/precedence.mjs (the `piping_spool` chain), blocked is never
-- stored, and a step that has not started has no row.
--
-- Steps the weld register already answers — shop welding, shop NDT, field
-- welding — are derived and never recorded here; the repository refuses
-- them. Asking someone to tick a box the system can answer is the manual
-- entry this platform exists to remove.
--
-- NOTE: `spool.fab_status` (migration 002) is an older, single-value
-- headline status set freely. This chain is the governed sequence behind
-- it. They coexist for now; collapsing fab_status into a value derived from
-- this chain is recorded as the next step rather than done silently here,
-- because revisions.mjs and kpi_spool_status both read it.

CREATE TABLE spool_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  spool_id      uuid NOT NULL REFERENCES spool(id) ON DELETE CASCADE,
  code          text NOT NULL,
  status        activity_status NOT NULL,
  done_at       date,
  ref_no        text,          -- test package, fit-up report, erection report number
  note          text,
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  recorded_by   uuid REFERENCES app_user(id),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, spool_id, code)
);
CREATE INDEX spool_activity_spool_idx ON spool_activity (spool_id);

ALTER TABLE spool_activity ADD CONSTRAINT spool_done_is_dated
  CHECK (status <> 'done' OR done_at IS NOT NULL);

-- ── pipe supports ────────────────────────────────────────────────────────
--
-- A support schedule, one row per support mark. Installed and inspected are
-- DATES, not flags: the date is the evidence, and "installed = true" with no
-- date is how a support gets counted twice across two weekly reports.

CREATE TYPE support_kind AS ENUM (
  'shoe', 'guide', 'anchor', 'line_stop', 'spring_hanger',
  'rigid_hanger', 'trunnion', 'resting', 'other'
);

CREATE TABLE pipe_support (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  line_id       uuid REFERENCES line(id) ON DELETE CASCADE,
  spool_id      uuid REFERENCES spool(id) ON DELETE SET NULL,
  support_no    text NOT NULL,
  kind          support_kind NOT NULL,
  load_kn       numeric(10,2),
  elevation_mm  numeric(12,1),
  drawing_ref   text,          -- the standard support drawing or detail
  installed_at  date,
  installed_by  uuid REFERENCES app_user(id),
  inspected_at  date,
  inspected_by  uuid REFERENCES app_user(id),
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, support_no)
);
CREATE INDEX pipe_support_line_idx ON pipe_support (line_id);

-- The ordering rule a support has: nobody inspects what is not there.
ALTER TABLE pipe_support ADD CONSTRAINT inspected_after_installed
  CHECK (inspected_at IS NULL OR (installed_at IS NOT NULL AND inspected_at >= installed_at));

-- A spring hanger with no load is a hanger nobody can set. The cold and hot
-- loads are what the installer adjusts it to.
ALTER TABLE pipe_support ADD CONSTRAINT spring_has_load
  CHECK (kind <> 'spring_hanger' OR load_kn IS NOT NULL);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['spool_activity', 'pipe_support'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON spool_activity, pipe_support TO app_rw;
GRANT SELECT ON spool_activity, pipe_support TO app_report;

CREATE VIEW reporting.kpi_support_status WITH (security_invoker = true) AS
SELECT s.project_id AS project_key, s.line_id AS line_key, l.line_no, s.kind,
       COUNT(*)                                                       AS supports,
       COUNT(*) FILTER (WHERE s.installed_at IS NULL)                 AS planned,
       COUNT(*) FILTER (WHERE s.installed_at IS NOT NULL
                          AND s.inspected_at IS NULL)                 AS installed,
       COUNT(*) FILTER (WHERE s.inspected_at IS NOT NULL)             AS inspected
  FROM pipe_support s
  LEFT JOIN line l ON l.id = s.line_id
 GROUP BY s.project_id, s.line_id, l.line_no, s.kind;

GRANT SELECT ON reporting.kpi_buried_exposure, reporting.kpi_support_status
  TO app_rw, app_report;
