-- ─────────────────────────────────────────────────────────────────────────
-- The WBS belongs to the PMS; a version is a schedule of it (owner's
-- requirements of 2026-10-22, «PLANING»).
--
--   wbs_node.pms_id      the tree is the PMS's, one for all its versions
--                        (it was each version's own, migration 073)
--   scope_rule.pms_id    a scope rule builds that tree, so it follows it
--   eps_pms.settings,    the tree's settings (numbering, separator, budget
--   budget_plan,         mode) and its root budget move with it from the
--   budget_actual        version
--   wbs_activity.act_type, activity_no, wf_rate
--                        the activity's type, its own ID (A1000, as in P6)
--                        and W.F rate, as the activity page shows them
--   activity_plan        an activity in a version: start, finish, the work
--                        done before the start, the quantity planned in this
--                        version, a description. With a version chosen the
--                        activity's dates and planned quantity are read from
--                        here; an activity the version does not carry keeps
--                        its own.
--
-- A database where two versions of one PMS already have trees of their own
-- is refused rather than merged: which tree is the PMS's is the planner's
-- call, not this migration's.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM wbs_node n JOIN eps_version v ON v.id = n.version_id
              GROUP BY v.pms_id HAVING count(DISTINCT n.version_id) > 1) THEN
    RAISE EXCEPTION 'two versions of one PMS have WBS trees of their own; keep one before migrating (083)';
  END IF;
END $$;

ALTER TABLE eps_pms ADD COLUMN settings jsonb NOT NULL DEFAULT '{}';
ALTER TABLE eps_pms ADD COLUMN budget_plan numeric(20,2) CHECK (budget_plan IS NULL OR budget_plan >= 0);
ALTER TABLE eps_pms ADD COLUMN budget_actual numeric(20,2) CHECK (budget_actual IS NULL OR budget_actual >= 0);

-- the settings and root budget of the version whose tree it was, else the master, else the first
UPDATE eps_pms p SET settings = v.settings, budget_plan = v.budget_plan, budget_actual = v.budget_actual
  FROM (SELECT DISTINCT ON (v.pms_id) v.pms_id, v.settings, v.budget_plan, v.budget_actual FROM eps_version v
         ORDER BY v.pms_id, EXISTS (SELECT 1 FROM wbs_node n WHERE n.version_id = v.id) DESC, v.master DESC, v.seq) v
 WHERE v.pms_id = p.id;

ALTER TABLE wbs_node ADD COLUMN pms_id uuid REFERENCES eps_pms(id) ON DELETE RESTRICT;
UPDATE wbs_node n SET pms_id = v.pms_id FROM eps_version v WHERE v.id = n.version_id;
ALTER TABLE wbs_node ALTER COLUMN pms_id SET NOT NULL;
ALTER TABLE wbs_node DROP COLUMN version_id;
ALTER TABLE wbs_node ADD CONSTRAINT wbs_node_pms_code UNIQUE (pms_id, code);

ALTER TABLE scope_rule ADD COLUMN pms_id uuid REFERENCES eps_pms(id) ON DELETE CASCADE;
UPDATE scope_rule r SET pms_id = v.pms_id FROM eps_version v WHERE v.id = r.version_id;
ALTER TABLE scope_rule ALTER COLUMN pms_id SET NOT NULL;
ALTER TABLE scope_rule DROP COLUMN version_id;
CREATE INDEX scope_rule_pms ON scope_rule (pms_id);

ALTER TABLE eps_version DROP COLUMN settings;

ALTER TABLE wbs_activity ADD COLUMN act_type text;
ALTER TABLE wbs_activity ADD COLUMN activity_no text;
ALTER TABLE wbs_activity ADD COLUMN wf_rate numeric(24,10);

CREATE TABLE activity_plan (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  version_id   uuid NOT NULL REFERENCES eps_version(id) ON DELETE RESTRICT,
  activity_id  uuid NOT NULL REFERENCES wbs_activity(id) ON DELETE CASCADE,
  start_on     date,
  end_on       date,
  done_before  numeric(24,10) CHECK (done_before IS NULL OR done_before >= 0),
  volume_plan  numeric(24,10) CHECK (volume_plan IS NULL OR volume_plan >= 0),
  description  text,
  seq          int NOT NULL DEFAULT 1,
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, activity_id),
  CHECK (end_on IS NULL OR start_on IS NULL OR end_on >= start_on)
);
CREATE INDEX activity_plan_activity ON activity_plan (activity_id);

-- a version plans only its own PMS's activities
CREATE FUNCTION activity_plan_same_pms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM eps_version v JOIN wbs_activity a ON a.id = NEW.activity_id JOIN wbs_node n ON n.id = a.node_id
                  WHERE v.id = NEW.version_id AND n.pms_id = v.pms_id) THEN
    RAISE EXCEPTION 'activity_plan: the activity is not on the WBS of the version''s PMS';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER activity_plan_same_pms BEFORE INSERT OR UPDATE OF version_id, activity_id ON activity_plan
  FOR EACH ROW EXECUTE FUNCTION activity_plan_same_pms();

ALTER TABLE activity_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON activity_plan USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON activity_plan TO app_rw;
GRANT SELECT ON activity_plan TO app_report;
