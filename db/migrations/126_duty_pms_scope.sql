-- Existing duties keep the contract's access rules until a PMS scope is selected.
ALTER TABLE duty ADD COLUMN pms_scope uuid[] NOT NULL DEFAULT '{}';
