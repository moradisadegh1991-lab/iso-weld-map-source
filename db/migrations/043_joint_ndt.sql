-- ─────────────────────────────────────────────────────────────────────────
-- NDT of support, structural and equipment welds, as the project's NDT
-- matrix requires (rules: lib/ndt/joints.mjs, lib/ndt/compliance.mjs).
-- The matrix is the specification's; no percentages are built in.
-- Samples, progressive draws and NDT records are append-only.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE ndt_matrix_rule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  scope       text NOT NULL,
  joint_type  text NOT NULL,
  method      ndt_method NOT NULL,
  percent     numeric(5,2) NOT NULL,
  extension   text,                      -- what a rejected sample leads to; null = not stated
  basis       text NOT NULL,             -- the specification clause or code paragraph
  updated_by  uuid REFERENCES app_user(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, scope, joint_type, method)
);
ALTER TABLE ndt_matrix_rule ADD CONSTRAINT ndt_rule_scope CHECK (scope IN ('support', 'structural', 'equipment'));
ALTER TABLE ndt_matrix_rule ADD CONSTRAINT ndt_rule_joint CHECK (joint_type IN ('cjp', 'pjp', 'fillet'));
ALTER TABLE ndt_matrix_rule ADD CONSTRAINT ndt_rule_percent CHECK (percent > 0 AND percent <= 100);
ALTER TABLE ndt_matrix_rule ADD CONSTRAINT ndt_rule_extension CHECK (extension IS NULL OR extension IN ('full', 'progressive'));
ALTER TABLE ndt_matrix_rule ADD CONSTRAINT ndt_rule_volumetric_groove CHECK (NOT (method IN ('RT', 'UT') AND joint_type = 'fillet'));

CREATE TABLE weld_joint (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  scope         text NOT NULL,
  joint_no      text NOT NULL,
  tag_id        uuid REFERENCES tag(id) ON DELETE CASCADE,
  support_id    uuid REFERENCES pipe_support(id) ON DELETE CASCADE,
  joint_type    text NOT NULL,
  thickness_mm  numeric(7,2),
  drawing_ref   text,
  welder_id     uuid REFERENCES welder(id),
  welded_on     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, joint_no)
);
ALTER TABLE weld_joint ADD CONSTRAINT joint_scope CHECK (scope IN ('support', 'structural', 'equipment'));
ALTER TABLE weld_joint ADD CONSTRAINT joint_type_known CHECK (joint_type IN ('cjp', 'pjp', 'fillet'));
ALTER TABLE weld_joint ADD CONSTRAINT joint_parent CHECK (
  (scope = 'support' AND support_id IS NOT NULL AND tag_id IS NULL) OR
  (scope <> 'support' AND tag_id IS NOT NULL AND support_id IS NULL));
ALTER TABLE weld_joint ADD CONSTRAINT joint_welded_by CHECK (welded_on IS NULL OR welder_id IS NOT NULL);
CREATE INDEX weld_joint_tag ON weld_joint (tag_id);
CREATE INDEX weld_joint_support ON weld_joint (support_id);

CREATE TABLE joint_ndt_record (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  joint_id      uuid NOT NULL REFERENCES weld_joint(id) ON DELETE CASCADE,
  method        ndt_method NOT NULL,
  result        ndt_result NOT NULL,
  repair_cycle  integer NOT NULL,
  report_no     text,
  defect_type   text,
  inspected_on  date,
  inspector     text,
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (joint_id, method, repair_cycle)
);

-- group_key: the tag, or 'line:<id>' / 'support:<id>' for supports — the lot is group × joint type × method × welder.
CREATE TABLE joint_ndt_selection (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  group_key     text NOT NULL,
  joint_type    text NOT NULL,
  method        ndt_method NOT NULL,
  percent       numeric(5,2) NOT NULL,
  seed          text NOT NULL,
  selected_ids  uuid[] NOT NULL,
  drawn_by      uuid REFERENCES app_user(id),
  drawn_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE joint_progressive_draw (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  group_key     text NOT NULL,
  joint_type    text NOT NULL,
  method        ndt_method NOT NULL,
  welder_id     uuid NOT NULL REFERENCES welder(id),
  tier          text NOT NULL CHECK (tier IN ('a', 'b')),
  defect_ids    uuid[] NOT NULL,
  selected_ids  uuid[] NOT NULL,
  seed          text NOT NULL,
  drawn_by      uuid REFERENCES app_user(id),
  drawn_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, group_key, joint_type, method, welder_id, tier)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ndt_matrix_rule', 'weld_joint', 'joint_ndt_record', 'joint_ndt_selection', 'joint_progressive_draw'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ndt_matrix_rule, weld_joint TO app_rw;
GRANT SELECT, INSERT ON joint_ndt_record, joint_ndt_selection, joint_progressive_draw TO app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON joint_ndt_record, joint_ndt_selection, joint_progressive_draw FROM app_rw;

CREATE VIEW reporting.fact_joint_ndt WITH (security_invoker = true) AS
SELECT r.id AS ndt_key, r.project_id AS project_key, j.id AS joint_key, j.joint_no, j.scope, j.joint_type,
       j.tag_id AS tag_key, j.support_id AS support_key, j.welder_id AS welder_key,
       r.method, r.result, r.repair_cycle, r.inspected_on, r.report_no,
       (r.repair_cycle = 0) AS is_first_shot, (r.repair_cycle = 0 AND r.result = 'reject') AS is_first_shot_reject
  FROM joint_ndt_record r JOIN weld_joint j ON j.id = r.joint_id;
GRANT SELECT ON reporting.fact_joint_ndt TO app_rw, app_report;
