CREATE TABLE structure_extension (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES structure_subscription(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES structure_source(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('roles','workflows')),
  parent_key text NOT NULL,
  local_key text NOT NULL,
  UNIQUE(subscription_id,source_id,category,parent_key,local_key)
);
ALTER TABLE structure_extension ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_extension FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON structure_extension USING (project_id=current_project_id()) WITH CHECK (project_id=current_project_id());
GRANT SELECT ON structure_extension TO app_report;
