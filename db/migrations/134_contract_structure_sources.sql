ALTER TABLE contract_stakeholder ADD UNIQUE (id, project_id, contract_id, company_id, role);

CREATE TABLE structure_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stakeholder_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  company_id uuid NOT NULL,
  role text NOT NULL,
  label text NOT NULL,
  UNIQUE (id, company_id, role),
  FOREIGN KEY (stakeholder_id,project_id,contract_id,company_id,role)
    REFERENCES contract_stakeholder(id,project_id,contract_id,company_id,role) ON DELETE CASCADE
);
CREATE TABLE structure_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stakeholder_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  company_id uuid NOT NULL,
  role text NOT NULL,
  source_id uuid NOT NULL,
  selection jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (stakeholder_id,project_id,contract_id,company_id,role)
    REFERENCES contract_stakeholder(id,project_id,contract_id,company_id,role) ON DELETE CASCADE,
  FOREIGN KEY (source_id,company_id,role) REFERENCES structure_source(id,company_id,role) ON DELETE RESTRICT
);
ALTER TABLE structure_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_source FORCE ROW LEVEL SECURITY;
CREATE POLICY source_discover ON structure_source FOR SELECT USING (project_id=current_project_id() OR EXISTS
  (SELECT 1 FROM contract_stakeholder s WHERE s.project_id=current_project_id() AND s.company_id=structure_source.company_id AND s.role=structure_source.role));
CREATE POLICY source_manage ON structure_source FOR ALL USING (project_id=current_project_id()) WITH CHECK (project_id=current_project_id());
ALTER TABLE structure_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON structure_subscription USING (project_id=current_project_id()) WITH CHECK (project_id=current_project_id());
GRANT SELECT ON structure_source,structure_subscription TO app_report;
