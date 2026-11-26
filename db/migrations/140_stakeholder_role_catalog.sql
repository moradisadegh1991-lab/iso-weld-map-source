CREATE TABLE stakeholder_role_catalog (
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  scope text NOT NULL CHECK (scope IN ('project', 'contract', 'both')),
  seq integer NOT NULL CHECK (seq >= 0),
  active boolean NOT NULL DEFAULT true,
  note text,
  PRIMARY KEY (project_id, code)
);
ALTER TABLE stakeholder_role_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakeholder_role_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON stakeholder_role_catalog
  USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());

ALTER TABLE project_stakeholder DROP CONSTRAINT project_stakeholder_role_check,
  ADD CONSTRAINT project_stakeholder_role_check CHECK (
    role IN ('owner', 'epc', 'consultant', 'supervisor', 'contractor', 'subcontractor', 'vendor', 'other', 'inspector')
    OR role ~ '^custom-[a-f0-9]{32}$');
ALTER TABLE contract_stakeholder DROP CONSTRAINT contract_stakeholder_role_check,
  ADD CONSTRAINT contract_stakeholder_role_check CHECK (
    role IN ('employer', 'contractor', 'consultant', 'supervisor', 'subcontractor', 'other', 'inspector')
    OR role ~ '^custom-[a-f0-9]{32}$');
