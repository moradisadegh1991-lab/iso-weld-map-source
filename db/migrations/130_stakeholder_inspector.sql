ALTER TABLE project_stakeholder DROP CONSTRAINT project_stakeholder_role_check,
  ADD CONSTRAINT project_stakeholder_role_check CHECK (role IN ('owner', 'epc', 'consultant', 'supervisor', 'contractor', 'subcontractor', 'vendor', 'other', 'inspector'));
ALTER TABLE contract_stakeholder DROP CONSTRAINT contract_stakeholder_role_check,
  ADD CONSTRAINT contract_stakeholder_role_check CHECK (role IN ('employer', 'contractor', 'consultant', 'supervisor', 'subcontractor', 'other', 'inspector'));
