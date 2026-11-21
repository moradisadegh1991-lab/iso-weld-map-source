ALTER TABLE report_type ADD COLUMN form_contract_id uuid REFERENCES contract(id) ON DELETE CASCADE;
ALTER TABLE report_type ADD COLUMN form_navigation text NOT NULL DEFAULT 'handover';
CREATE INDEX report_type_form_contract ON report_type(form_contract_id) WHERE form_contract_id IS NOT NULL;

-- Published definitions are intentionally readable across projects. Reports,
-- membership, and workflow assignments stay in the consuming project.
CREATE TABLE published_form (
  type_id uuid PRIMARY KEY REFERENCES report_type(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  section text NOT NULL,
  navigation text NOT NULL,
  definition jsonb NOT NULL
);
ALTER TABLE published_form ENABLE ROW LEVEL SECURITY;
ALTER TABLE published_form FORCE ROW LEVEL SECURITY;
CREATE POLICY published_form_read ON published_form FOR SELECT USING (current_project_id() IS NOT NULL);
CREATE POLICY published_form_insert ON published_form FOR INSERT WITH CHECK (project_id = current_project_id());
CREATE POLICY published_form_update ON published_form FOR UPDATE USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
CREATE POLICY published_form_delete ON published_form FOR DELETE USING (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON published_form TO app_rw;
GRANT SELECT ON published_form TO app_report;
