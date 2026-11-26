ALTER TABLE contract_member DROP CONSTRAINT contract_member_contract_id_user_id_key;
CREATE INDEX contract_member_contract_user_idx ON contract_member (contract_id, user_id);
CREATE UNIQUE INDEX contract_member_legacy_appointment_idx
  ON contract_member (contract_id, user_id) WHERE decree IS NULL;
