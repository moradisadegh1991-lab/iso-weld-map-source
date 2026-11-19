-- Empty configuration preserves the duty's shared PMS and WBS scope.
ALTER TABLE duty ADD COLUMN planning_forms jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(planning_forms) = 'object');
