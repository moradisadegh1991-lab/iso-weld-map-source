-- ─────────────────────────────────────────────────────────────────────────
-- HSE: man-hours, incidents (facts, not classes), permits to work with gas
-- tests, and observations.
--
-- The incident class is derived from the facts (lib/hse/hse.mjs). The
-- reporting view repeats the same rule in SQL for Power BI, and a test holds
-- the two to the same answer on every case.
-- ─────────────────────────────────────────────────────────────────────────

-- Gas-test limits and permit duration: stated by the project, no defaults.
ALTER TABLE project
  ADD COLUMN hse_o2_min_pct            numeric(5,2),
  ADD COLUMN hse_o2_max_pct            numeric(5,2),
  ADD COLUMN hse_lel_max_pct           numeric(5,2),
  ADD COLUMN hse_h2s_max_ppm           numeric(7,2),
  ADD COLUMN hse_co_max_ppm            numeric(7,2),
  ADD COLUMN hse_gas_test_validity_min integer,
  ADD COLUMN hse_permit_max_hours      numeric(5,2);
ALTER TABLE project ADD CONSTRAINT hse_o2_band CHECK (
  hse_o2_min_pct IS NULL OR hse_o2_max_pct IS NULL OR (hse_o2_min_pct > 0 AND hse_o2_min_pct < hse_o2_max_pct AND hse_o2_max_pct <= 100));
ALTER TABLE project ADD CONSTRAINT hse_limits_positive CHECK (
  COALESCE(hse_lel_max_pct, 0) >= 0 AND COALESCE(hse_h2s_max_ppm, 0) >= 0 AND COALESCE(hse_co_max_ppm, 0) >= 0
  AND COALESCE(hse_gas_test_validity_min, 1) > 0 AND COALESCE(hse_permit_max_hours, 1) > 0);

CREATE TABLE hse_manhours (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contractor_id uuid REFERENCES contractor(id) ON DELETE CASCADE,  -- NULL = the EPC's own staff
  work_date     date NOT NULL,
  hours         numeric(10,1) NOT NULL,
  headcount     integer,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hse_manhours_day ON hse_manhours
  (project_id, COALESCE(contractor_id, '00000000-0000-0000-0000-000000000000'::uuid), work_date);
ALTER TABLE hse_manhours ADD CONSTRAINT manhours_positive CHECK (hours >= 0 AND (headcount IS NULL OR headcount >= 0));

CREATE TABLE hse_incident (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  ref_no          text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  area            text,
  contractor_id   uuid REFERENCES contractor(id) ON DELETE SET NULL,
  description     text NOT NULL,
  injured         boolean,                 -- NULL = not yet known
  fatal           boolean,
  days_away       integer,
  restricted_days integer,
  treatment       text,
  reported_by     uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, ref_no)
);
ALTER TABLE hse_incident ADD CONSTRAINT incident_days_nonneg CHECK (
  COALESCE(days_away, 0) >= 0 AND COALESCE(restricted_days, 0) >= 0);
ALTER TABLE hse_incident ADD CONSTRAINT incident_treatment_known CHECK (
  treatment IS NULL OR treatment IN ('none', 'first_aid', 'medical'));

-- Every change to an incident's facts, with its reason. Statistics that can
-- be edited silently are not statistics.
CREATE TABLE hse_incident_revision (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES hse_incident(id) ON DELETE CASCADE,
  before      jsonb NOT NULL,
  after       jsonb NOT NULL,
  reason      text NOT NULL,
  changed_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE hse_permit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  permit_no      text NOT NULL,
  type           text NOT NULL,
  area           text NOT NULL,
  description    text NOT NULL,
  contractor_id  uuid REFERENCES contractor(id) ON DELETE SET NULL,
  requested_by   uuid REFERENCES app_user(id),
  requester_name text,                     -- the performing authority on site
  valid_from     timestamptz NOT NULL,
  valid_to       timestamptz NOT NULL,
  attendant      text,
  isolation_ref  text,
  status         text NOT NULL DEFAULT 'requested',
  issued_by      uuid REFERENCES app_user(id),
  issued_at      timestamptz,
  closed_by      uuid REFERENCES app_user(id),
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, permit_no)
);
ALTER TABLE hse_permit ADD CONSTRAINT permit_type_known CHECK (type IN
  ('cold', 'hot', 'confined_space', 'electrical_isolation', 'excavation', 'work_at_height', 'lifting', 'radiography'));
ALTER TABLE hse_permit ADD CONSTRAINT permit_status_known CHECK (status IN ('requested', 'active', 'closed', 'cancelled'));
ALTER TABLE hse_permit ADD CONSTRAINT permit_window CHECK (valid_to > valid_from);
ALTER TABLE hse_permit ADD CONSTRAINT permit_active_is_signed CHECK (status <> 'active' OR issued_by IS NOT NULL);

CREATE TABLE hse_gas_test (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  permit_id   uuid NOT NULL REFERENCES hse_permit(id) ON DELETE CASCADE,
  tested_at   timestamptz NOT NULL,
  o2_pct      numeric(5,2),
  lel_pct     numeric(5,2),
  h2s_ppm     numeric(7,2),
  co_ppm      numeric(7,2),
  tester_name text,
  instrument  text,                        -- detector id and its bump-test / calibration date
  recorded_by uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX hse_gas_test_permit_idx ON hse_gas_test (permit_id, tested_at);

CREATE TABLE hse_observation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  observed_on   date NOT NULL,
  kind          text NOT NULL,
  severity      text,
  area          text,
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  description   text NOT NULL,
  action        text,
  due_on        date,
  closed_on     date,
  closed_note   text,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hse_observation ADD CONSTRAINT observation_kind_known CHECK (kind IN ('unsafe_act', 'unsafe_condition', 'good_practice'));
ALTER TABLE hse_observation ADD CONSTRAINT observation_severity_known CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high'));
ALTER TABLE hse_observation ADD CONSTRAINT observation_hazard_has_action CHECK (
  kind = 'good_practice' OR (action IS NOT NULL AND due_on IS NOT NULL AND severity IS NOT NULL));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hse_manhours', 'hse_incident', 'hse_incident_revision', 'hse_permit',
                           'hse_gas_test', 'hse_observation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- Revisions and gas tests are records of what happened: append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON hse_incident_revision, hse_gas_test FROM app_rw;
GRANT SELECT, INSERT ON hse_incident_revision, hse_gas_test TO app_rw;
-- An incident is corrected through its revision trail, never deleted.
REVOKE DELETE, TRUNCATE ON hse_incident FROM app_rw;
GRANT SELECT ON hse_manhours, hse_incident, hse_incident_revision, hse_permit, hse_gas_test, hse_observation TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

-- Same rule as classifyIncident() in lib/hse/hse.mjs; db/test/hse.mjs holds
-- them to the same answer.
CREATE VIEW reporting.fact_hse_incident WITH (security_invoker = true) AS
SELECT i.id AS incident_key, i.project_id AS project_key, i.ref_no, i.occurred_at,
       (i.occurred_at AT TIME ZONE 'UTC')::date AS occurred_on, i.area, i.contractor_id AS contractor_key,
       i.injured, i.fatal, i.days_away, i.restricted_days, i.treatment,
       c.cls AS incident_class,
       c.cls IN ('FAT', 'LWC') AS is_lti,
       c.cls IN ('FAT', 'LWC', 'RWC', 'MTC') AS is_recordable
  FROM hse_incident i
  CROSS JOIN LATERAL (SELECT CASE
    WHEN i.injured IS FALSE THEN
      CASE WHEN i.fatal IS TRUE OR COALESCE(i.days_away, 0) > 0 OR COALESCE(i.restricted_days, 0) > 0
                OR COALESCE(i.treatment, 'none') <> 'none' THEN NULL ELSE 'NM' END
    WHEN i.injured IS NULL THEN NULL
    WHEN i.fatal IS TRUE THEN 'FAT'
    WHEN i.fatal IS FALSE AND i.days_away > 0 THEN 'LWC'
    WHEN i.fatal IS NULL OR i.days_away IS NULL OR i.restricted_days IS NULL OR i.treatment IS NULL THEN NULL
    WHEN i.restricted_days > 0 THEN 'RWC'
    WHEN i.treatment = 'medical' THEN 'MTC'
    WHEN i.treatment = 'first_aid' THEN 'FAC'
    ELSE NULL END AS cls) c;

CREATE VIEW reporting.fact_hse_manhours WITH (security_invoker = true) AS
SELECT m.project_id AS project_key, m.contractor_id AS contractor_key, m.work_date, m.hours, m.headcount
  FROM hse_manhours m;

CREATE VIEW reporting.fact_hse_permit WITH (security_invoker = true) AS
SELECT p.id AS permit_key, p.project_id AS project_key, p.permit_no, p.type, p.area, p.contractor_id AS contractor_key,
       p.status, p.valid_from, p.valid_to, p.issued_at, p.closed_at,
       (SELECT count(*) FROM hse_gas_test g WHERE g.permit_id = p.id) AS gas_tests
  FROM hse_permit p;

CREATE VIEW reporting.fact_hse_observation WITH (security_invoker = true) AS
SELECT o.id AS observation_key, o.project_id AS project_key, o.observed_on, o.kind, o.severity, o.area,
       o.contractor_id AS contractor_key, o.due_on, o.closed_on
  FROM hse_observation o;

GRANT SELECT ON reporting.fact_hse_incident, reporting.fact_hse_manhours, reporting.fact_hse_permit,
                reporting.fact_hse_observation TO app_rw, app_report;
