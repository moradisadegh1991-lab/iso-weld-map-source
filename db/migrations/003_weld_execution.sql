-- ─────────────────────────────────────────────────────────────────────────
-- EPIC-3 · welder qualification, weld execution, NDT
--
-- Everything here keys on `weld_uid`, NOT on a weld row id. Weld rows belong
-- to an extraction run and are rewritten on every revision; the execution
-- record — who welded it, to which procedure, what the radiograph said — must
-- outlive that. This is what the stable identity built in EPIC-2 was for, and
-- it is the difference between a traceable register and a pile of orphaned
-- ITRs at handover.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE welding_process AS ENUM ('SMAW', 'GTAW', 'GMAW', 'FCAW', 'SAW');
CREATE TYPE ndt_method AS ENUM ('RT', 'UT', 'PT', 'MT', 'VT');
CREATE TYPE ndt_result AS ENUM ('accept', 'reject', 'pending');

CREATE TABLE welder (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  stamp_no    text NOT NULL,             -- the mark struck next to the weld
  name        text NOT NULL,
  employer    text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, stamp_no)
);

-- One row per performance qualification test. A welder normally holds
-- several: a 6G on pipe, maybe a separate process.
CREATE TABLE welder_qualification (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  welder_id               uuid NOT NULL REFERENCES welder(id) ON DELETE CASCADE,
  process                 welding_process NOT NULL,
  qw_position             text[] NOT NULL DEFAULT '{}',   -- 6G, 5G, 2G...
  coupon_od_mm            numeric(8,2),
  coupon_thickness_mm     numeric(8,2),
  deposited_thickness_mm  numeric(8,2),
  backing                 text,
  f_number                text,
  p_number                text,
  certificate_no          text,
  qualified_on            date,
  -- An administrative expiry, when the project records one. The rule that
  -- actually governs is QW-322.1 continuity, computed from weld history.
  expires_on              date,
  revoked_at              timestamptz,
  revoked_reason          text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX welder_qual_idx ON welder_qualification (project_id, welder_id, process);

CREATE TABLE wps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  wps_no            text NOT NULL,
  pqr_no            text,
  process           welding_process NOT NULL,
  p_number_from     text,
  p_number_to       text,
  thickness_min_mm  numeric(8,2),
  thickness_max_mm  numeric(8,2),
  positions         text[] NOT NULL DEFAULT '{}',
  preheat_min_c     numeric(6,1),
  pwht_required     boolean NOT NULL DEFAULT false,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, wps_no)
);

-- One execution per weld identity. Re-welding after a rejected NDT is a
-- repair cycle on the NDT record, not a second execution.
CREATE TABLE weld_execution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  weld_uid        text NOT NULL,
  line_id         uuid REFERENCES line(id) ON DELETE SET NULL,
  welder_id       uuid REFERENCES welder(id) ON DELETE RESTRICT,
  wps_id          uuid REFERENCES wps(id) ON DELETE RESTRICT,
  process         welding_process,
  position        text,
  welded_at       date NOT NULL,
  visual_result   ndt_result NOT NULL DEFAULT 'pending',
  -- The qualification verdict as it stood when the weld was assigned, kept
  -- verbatim: an auditor months later asks what was known at the time, not
  -- what the rules would say today.
  qualification_verdict jsonb NOT NULL DEFAULT '{}'::jsonb,
  pwht_required   boolean NOT NULL DEFAULT false,
  pwht_report_no  text,
  pwht_at         date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  UNIQUE (project_id, weld_uid)
);

CREATE INDEX weld_execution_welder_idx ON weld_execution (project_id, welder_id, welded_at);

CREATE TABLE ndt_record (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  weld_uid      text NOT NULL,
  method        ndt_method NOT NULL,
  report_no     text,
  result        ndt_result NOT NULL DEFAULT 'pending',
  -- 0 is the first shot; 1 and up are re-shots after a repair. Repair rate
  -- per welder is the number that gets a welder retested or sent home.
  repair_cycle  integer NOT NULL DEFAULT 0,
  defect_type   text,
  inspected_at  date,
  inspector     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  UNIQUE (project_id, weld_uid, method, repair_cycle)
);

CREATE INDEX ndt_weld_idx ON ndt_record (project_id, weld_uid);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['welder', 'welder_qualification', 'wps', 'weld_execution', 'ndt_record'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
  END LOOP;
END $$;
