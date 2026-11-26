ALTER TABLE contract_calendar
  ADD COLUMN annual_exceptions jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(annual_exceptions) = 'object');
