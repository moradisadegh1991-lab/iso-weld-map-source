ALTER TABLE contract_calendar ADD COLUMN shifts jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(shifts)='object');
