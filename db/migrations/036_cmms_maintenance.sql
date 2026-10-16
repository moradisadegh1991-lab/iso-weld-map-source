-- ─────────────────────────────────────────────────────────────────────────
-- Handover to maintenance, phase 2: what a CMMS needs besides the asset
-- master — the maintenance plan, the spare parts, and when each instrument
-- is next calibrated. The rules are lib/cmms/maintenance.mjs.
--
-- Three rules the database holds as well, because they are the ones a bulk
-- import would break:
--   · an interval has a source: the OEM manual, an RCM/FMEA study, a
--     statute or insurer, or a company standard — with its reference. The
--     platform never proposes an interval;
--   · a PM task is approved by someone other than who prepared it, and an
--     approved revision does not change: a change is a new revision, which
--     supersedes the old one when it is approved;
--   · the history of spare-part and calibration-plan decisions is added to,
--     never rewritten.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE pm_task (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id          uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  task_code       text NOT NULL,             -- stable across revisions, e.g. PM-01
  revision        integer NOT NULL DEFAULT 0,
  title           text NOT NULL,
  strategy        text NOT NULL,
  interval_value  numeric(10,2),
  interval_unit   text,
  craft           text,
  duration_h      numeric(8,2),
  source          text NOT NULL,
  source_ref      text NOT NULL,             -- the manual and its section, the study, the regulation
  notes           text,
  status          text NOT NULL DEFAULT 'draft',
  prepared_by     uuid REFERENCES app_user(id),
  approved_by     uuid REFERENCES app_user(id),
  approved_at     timestamptz,
  superseded_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, tag_id, task_code, revision)
);
CREATE INDEX pm_task_tag ON pm_task (project_id, tag_id);
ALTER TABLE pm_task ADD CONSTRAINT pm_strategy_known CHECK (strategy IN ('time_based', 'condition_based', 'run_to_failure'));
ALTER TABLE pm_task ADD CONSTRAINT pm_unit_known CHECK (interval_unit IS NULL OR interval_unit IN ('day', 'week', 'month', 'year', 'run_hours'));
-- Run to failure has no interval; every other strategy has one.
ALTER TABLE pm_task ADD CONSTRAINT pm_interval_fits CHECK (
  (strategy = 'run_to_failure' AND interval_value IS NULL AND interval_unit IS NULL)
  OR (strategy <> 'run_to_failure' AND interval_value > 0 AND interval_unit IS NOT NULL));
ALTER TABLE pm_task ADD CONSTRAINT pm_source_known CHECK (source IN ('oem', 'rcm', 'statutory', 'company'));
ALTER TABLE pm_task ADD CONSTRAINT pm_source_cited CHECK (length(btrim(source_ref)) > 0);
ALTER TABLE pm_task ADD CONSTRAINT pm_craft_known CHECK (craft IS NULL OR craft IN ('mechanical', 'electrical', 'instrument', 'operations', 'civil', 'other'));
ALTER TABLE pm_task ADD CONSTRAINT pm_duration_positive CHECK (duration_h IS NULL OR duration_h > 0);
ALTER TABLE pm_task ADD CONSTRAINT pm_status_known CHECK (status IN ('draft', 'approved', 'superseded'));
ALTER TABLE pm_task ADD CONSTRAINT pm_approver_not_preparer CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM prepared_by);
ALTER TABLE pm_task ADD CONSTRAINT pm_approved_signed CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));
-- One revision of a task in force at a time, and one draft being written.
CREATE UNIQUE INDEX pm_task_one_approved ON pm_task (project_id, tag_id, task_code) WHERE status = 'approved';
CREATE UNIQUE INDEX pm_task_one_draft ON pm_task (project_id, tag_id, task_code) WHERE status = 'draft';

-- An approved task is fixed; it only moves on to superseded.
CREATE FUNCTION pm_task_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'pm task % rev % is %; it is kept', OLD.task_code, OLD.revision, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (NEW.tag_id, NEW.task_code, NEW.revision, NEW.title, NEW.strategy, NEW.interval_value,
        NEW.interval_unit, NEW.craft, NEW.duration_h, NEW.source, NEW.source_ref, NEW.notes, NEW.prepared_by,
        NEW.approved_by, NEW.approved_at)
     IS DISTINCT FROM (OLD.tag_id, OLD.task_code, OLD.revision, OLD.title, OLD.strategy, OLD.interval_value,
        OLD.interval_unit, OLD.craft, OLD.duration_h, OLD.source, OLD.source_ref, OLD.notes, OLD.prepared_by,
        OLD.approved_by, OLD.approved_at) THEN
    RAISE EXCEPTION 'pm task % rev % is %; a change is a new revision', OLD.task_code, OLD.revision, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.status, NEW.status) NOT IN (('draft','draft'), ('draft','approved'), ('approved','approved'), ('approved','superseded'), ('superseded','superseded')) THEN
    RAISE EXCEPTION 'pm task status cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pm_task_fixed BEFORE UPDATE OR DELETE ON pm_task FOR EACH ROW EXECUTE FUNCTION pm_task_fixed();

-- Spare parts, from the vendor's SPIR. A part number shared by several tags
-- is the interchangeability the SPIR records; it is read off these rows.
CREATE TABLE spare_part (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id           uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  part_no          text NOT NULL,            -- the manufacturer's part number
  manufacturer     text,
  description      text NOT NULL,
  category         text NOT NULL,
  uom              text NOT NULL DEFAULT 'EA',
  qty_installed    numeric(10,2),
  qty_recommended  numeric(10,2),            -- what the vendor's SPIR recommends
  qty_approved     numeric(10,2),            -- what the owner decided to hold
  item_id          uuid REFERENCES material_item(id) ON DELETE SET NULL,   -- the warehouse's item, when stocked
  spir_ref         text,
  updated_by       uuid REFERENCES app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, tag_id, part_no, category)
);
CREATE INDEX spare_part_tag ON spare_part (project_id, tag_id);
CREATE INDEX spare_part_no ON spare_part (project_id, part_no);
ALTER TABLE spare_part ADD CONSTRAINT spare_category_known CHECK (category IN ('commissioning', 'operational', 'capital'));
ALTER TABLE spare_part ADD CONSTRAINT spare_qty_nonnegative CHECK (
  (qty_installed IS NULL OR qty_installed >= 0) AND (qty_recommended IS NULL OR qty_recommended >= 0)
  AND (qty_approved IS NULL OR qty_approved >= 0));

CREATE TABLE spare_part_revision (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  part_no     text NOT NULL,
  action      text NOT NULL,               -- saved | removed
  snapshot    jsonb NOT NULL,
  by_user     uuid REFERENCES app_user(id),
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- When an instrument is calibrated again, and on what authority.
CREATE TABLE calibration_plan (
  instrument_id    uuid PRIMARY KEY REFERENCES instrument(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  interval_months  integer NOT NULL,
  source           text NOT NULL,
  source_ref       text NOT NULL,
  updated_by       uuid REFERENCES app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE calibration_plan ADD CONSTRAINT cal_interval_range CHECK (interval_months BETWEEN 1 AND 120);
ALTER TABLE calibration_plan ADD CONSTRAINT cal_source_known CHECK (source IN ('oem', 'rcm', 'statutory', 'company'));
ALTER TABLE calibration_plan ADD CONSTRAINT cal_source_cited CHECK (length(btrim(source_ref)) > 0);

CREATE TABLE calibration_plan_revision (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  instrument_id  uuid NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
  snapshot       jsonb NOT NULL,
  by_user        uuid REFERENCES app_user(id),
  at             timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Which export a logged file was: the asset master (phase 1), the plan, the spares.
ALTER TABLE handover_export ADD COLUMN kind text NOT NULL DEFAULT 'asset_master';
ALTER TABLE handover_export ADD CONSTRAINT handover_export_kind CHECK (kind IN ('asset_master', 'pm_plan', 'spares', 'calibration'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pm_task', 'spare_part', 'spare_part_revision', 'calibration_plan', 'calibration_plan_revision'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON spare_part_revision, calibration_plan_revision FROM app_rw;
GRANT SELECT, INSERT ON spare_part_revision, calibration_plan_revision TO app_rw;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_pm_task WITH (security_invoker = true) AS
SELECT p.id AS pm_task_key, p.project_id AS project_key, p.tag_id AS tag_key, p.task_code, p.revision, p.title,
       p.strategy, p.interval_value, p.interval_unit, p.craft, p.duration_h, p.source, p.source_ref, p.approved_at
  FROM pm_task p WHERE p.status = 'approved';

CREATE VIEW reporting.fact_spare_part WITH (security_invoker = true) AS
SELECT s.id AS spare_key, s.project_id AS project_key, s.tag_id AS tag_key, s.part_no, s.manufacturer, s.description,
       s.category, s.uom, s.qty_installed, s.qty_recommended, s.qty_approved, s.item_id AS item_key, s.spir_ref
  FROM spare_part s;

GRANT SELECT ON reporting.fact_pm_task, reporting.fact_spare_part TO app_rw, app_report;
