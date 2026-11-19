-- An empty list retains the workflow membership of existing duties.
ALTER TABLE duty ADD COLUMN form_rules jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(form_rules) = 'array');
