CREATE TABLE contract_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  weekdays smallint[] NOT NULL CHECK (cardinality(weekdays) > 0 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  exceptions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(exceptions) = 'object'),
  is_default boolean NOT NULL DEFAULT false,
  UNIQUE (contract_id, name)
);
CREATE UNIQUE INDEX contract_calendar_one_default ON contract_calendar(contract_id) WHERE is_default;
ALTER TABLE contract_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_calendar FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON contract_calendar USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_calendar TO app_rw;
GRANT SELECT ON contract_calendar TO app_report;

ALTER TABLE eps_pms ADD COLUMN calendar_id uuid REFERENCES contract_calendar(id) ON DELETE NO ACTION;
ALTER TABLE eps_version ADD COLUMN calendar_id uuid REFERENCES contract_calendar(id) ON DELETE NO ACTION;
ALTER TABLE wbs_activity ADD COLUMN calendar_id uuid REFERENCES contract_calendar(id) ON DELETE NO ACTION;
ALTER TABLE activity_plan ADD COLUMN calendar_id uuid REFERENCES contract_calendar(id) ON DELETE NO ACTION;
ALTER TABLE activity_role ADD COLUMN calendar_id uuid REFERENCES contract_calendar(id) ON DELETE NO ACTION;
