-- ─────────────────────────────────────────────────────────────────────────
-- Tables across the platform (owner's requirements of 2026-10-22, items 7–9).
--
--   custom_field   a column the project adds to a table of the platform: the
--                  table it belongs to (the table's name, as TableKit knows
--                  it), its heading, its type (text, number, date, yes/no, a
--                  list of choices) and its place. The project's: every
--                  member sees it.
--   custom_value   a row's value in such a column, kept by the row's key
--                  (the table's own data-key), as text in the column's type
--
--   W.F and volumes take ten decimals (item 9: Excel numbers up to ten
--   decimals are accepted), and W.V is worked out to as many on read.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE custom_field (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  form_key    text NOT NULL CHECK (form_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  label       text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  data_type   text NOT NULL CHECK (data_type IN ('text', 'number', 'date', 'bool', 'list')),
  options     text[] NOT NULL DEFAULT '{}',
  seq         int NOT NULL DEFAULT 1,
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, form_key, label),
  CHECK (data_type <> 'list' OR cardinality(options) > 0)
);

CREATE TABLE custom_value (
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  field_id    uuid NOT NULL REFERENCES custom_field(id) ON DELETE CASCADE,
  row_key     text NOT NULL CHECK (length(row_key) BETWEEN 1 AND 200),
  value       text NOT NULL,
  updated_by  uuid REFERENCES app_user(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_id, row_key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_field', 'custom_value'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;

ALTER TABLE wbs_node ALTER COLUMN wf TYPE numeric(14,10);
ALTER TABLE wbs_activity ALTER COLUMN wf TYPE numeric(14,10);
ALTER TABLE template_activity ALTER COLUMN wf TYPE numeric(14,10);
ALTER TABLE wbs_node ALTER COLUMN volume_plan TYPE numeric(24,10);
ALTER TABLE wbs_node ALTER COLUMN volume_actual TYPE numeric(24,10);
ALTER TABLE wbs_activity ALTER COLUMN volume_plan TYPE numeric(24,10);
ALTER TABLE wbs_activity ALTER COLUMN volume_actual TYPE numeric(24,10);
