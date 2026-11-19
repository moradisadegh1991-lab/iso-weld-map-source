-- A parent belongs to the same contract. Existing roles start at its root.
ALTER TABLE contract_role ADD COLUMN parent_id uuid;
ALTER TABLE contract_role ADD CONSTRAINT contract_role_id_contract_unique UNIQUE (id, contract_id);
ALTER TABLE contract_role ADD CONSTRAINT contract_role_parent_same_contract
  FOREIGN KEY (parent_id, contract_id) REFERENCES contract_role (id, contract_id);
ALTER TABLE contract_role ADD CONSTRAINT contract_role_parent_not_self CHECK (parent_id IS DISTINCT FROM id);
CREATE INDEX contract_role_parent_idx ON contract_role(parent_id) WHERE parent_id IS NOT NULL;
