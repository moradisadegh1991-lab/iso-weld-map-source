-- ─────────────────────────────────────────────────────────────────────────
-- EPS round 2 (owner's request 2026-10-16, «PMS» document): the activity
-- view after Primavera P6, and progress from the daily report.
--
-- eps_pms.pms_type, description   a PMS's type and description
-- eps_version.master              the version that is the PMS's master plan
--                                 (one at most); the baseline a delay is
--                                 measured against
-- wbs_activity dates and volumes  typed only when the activity's own differ
--                                 from its WBS node's; otherwise read from
--                                 the node (lib/eps/wbs.mjs)
-- activity_relation               predecessor → successor (FS, SS, FF, SF)
--                                 with a lag in days, within one version
-- activity_code                   the contract's activity codes: code, the
--                                 activity type it names, categories A–H,
--                                 unit; activities are given codes
--                                 (wbs_activity_code)
-- activity_role                   a contract resource booked on an activity:
--                                 units per day and rate; the cost is worked
--                                 out from the activity's duration
-- activity_delay                  the activity's lines in the delay claim
--                                 (لایحهٔ تأخیرات): delay code, description,
--                                 accepted start / finish, critical. The
--                                 baseline and the delays are read from the
--                                 master plan, not stored
--
-- The quantity done each day is not a table: it is a section of the
-- contract's daily report (lib/reports/contract-daily.mjs, «activities»),
-- so it goes through the report's workflow and signatures like the rest.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE eps_pms ADD COLUMN pms_type text;
ALTER TABLE eps_pms ADD COLUMN description text;

ALTER TABLE eps_version ADD COLUMN master boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX eps_version_one_master ON eps_version (pms_id) WHERE master;

ALTER TABLE wbs_activity ADD COLUMN plan_start date;
ALTER TABLE wbs_activity ADD COLUMN plan_end date;
ALTER TABLE wbs_activity ADD COLUMN actual_start date;
ALTER TABLE wbs_activity ADD COLUMN actual_end date;
ALTER TABLE wbs_activity ADD COLUMN volume_plan numeric(16,3) CHECK (volume_plan IS NULL OR volume_plan >= 0);
ALTER TABLE wbs_activity ADD COLUMN volume_actual numeric(16,3) CHECK (volume_actual IS NULL OR volume_actual >= 0);
ALTER TABLE wbs_activity ADD CONSTRAINT wbs_activity_plan_span CHECK (plan_end IS NULL OR plan_start IS NULL OR plan_end >= plan_start);
ALTER TABLE wbs_activity ADD CONSTRAINT wbs_activity_actual_span CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start);

CREATE TABLE activity_relation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  pred_id     uuid NOT NULL REFERENCES wbs_activity(id) ON DELETE CASCADE,
  succ_id     uuid NOT NULL REFERENCES wbs_activity(id) ON DELETE CASCADE,
  rel_type    text NOT NULL DEFAULT 'FS' CHECK (rel_type IN ('FS', 'SS', 'FF', 'SF')),
  lag         int NOT NULL DEFAULT 0 CHECK (lag BETWEEN -3650 AND 3650),
  UNIQUE (pred_id, succ_id),
  CHECK (pred_id <> succ_id)
);
CREATE INDEX activity_relation_succ ON activity_relation (succ_id);

CREATE TABLE activity_code (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  code        text NOT NULL CHECK (length(btrim(code)) > 0),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  categories  text[] NOT NULL DEFAULT '{}' CHECK (cardinality(categories) <= 8),
  unit        text,
  valid       boolean NOT NULL DEFAULT true,
  remark      text,
  seq         int NOT NULL DEFAULT 1,
  UNIQUE (contract_id, code)
);

CREATE TABLE wbs_activity_code (
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES wbs_activity(id) ON DELETE CASCADE,
  code_id     uuid NOT NULL REFERENCES activity_code(id) ON DELETE RESTRICT,
  PRIMARY KEY (activity_id, code_id)
);
CREATE INDEX wbs_activity_code_code ON wbs_activity_code (code_id);

CREATE TABLE activity_role (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  activity_id   uuid NOT NULL REFERENCES wbs_activity(id) ON DELETE CASCADE,
  resource_id   uuid NOT NULL REFERENCES contract_resource(id) ON DELETE RESTRICT,
  budget_unit   text NOT NULL DEFAULT 'hour' CHECK (budget_unit IN ('hour', 'day', 'unit')),
  per_day       numeric(12,3) CHECK (per_day IS NULL OR per_day >= 0),
  rate          numeric(18,2) CHECK (rate IS NULL OR rate >= 0),
  actual_time   numeric(14,3) CHECK (actual_time IS NULL OR actual_time >= 0),
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'done')),
  remark        text,
  UNIQUE (activity_id, resource_id)
);

CREATE TABLE activity_delay (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  activity_id   uuid NOT NULL REFERENCES wbs_activity(id) ON DELETE CASCADE,
  no            int NOT NULL CHECK (no >= 1),
  description   text NOT NULL CHECK (length(btrim(description)) > 0),
  delay_code    text,
  accept_start  date,
  accept_finish date,
  critical      boolean NOT NULL DEFAULT false,
  remark        text,
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, no),
  CHECK (accept_finish IS NULL OR accept_start IS NULL OR accept_finish >= accept_start)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['activity_relation', 'activity_code', 'wbs_activity_code', 'activity_role', 'activity_delay'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
