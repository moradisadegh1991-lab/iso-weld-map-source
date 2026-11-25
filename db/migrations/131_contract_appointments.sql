ALTER TABLE contract_member
  ADD COLUMN decree text UNIQUE CHECK (btrim(decree) <> ''),
  ADD COLUMN personnel text,
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  ADD COLUMN starts_on date,
  ADD COLUMN ends_on date,
  ADD CHECK (ends_on >= starts_on);
