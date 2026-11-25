ALTER TABLE contract_role ADD COLUMN stakeholder_id uuid REFERENCES contract_stakeholder(id) ON DELETE RESTRICT;
