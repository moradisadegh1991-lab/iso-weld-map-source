-- How a report type prints, and the project's logos for its header.
--
--   report_print_layout  one row per saved layout of a type; the latest is
--                        the one in use. The layout itself is JSON, checked
--                        by lib/reports/print.mjs before it is kept.
--   project_logo         an image a header may show — kept as uploaded,
--                        type read from its bytes, named by its hash.
--
-- Both are only added to: an approved report printed last month must still
-- be printable with the layout of the day, and the logos it showed.

CREATE TABLE report_print_layout (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_type_id  uuid NOT NULL REFERENCES report_type(id) ON DELETE CASCADE,
  version         int  NOT NULL CHECK (version >= 1),
  layout          jsonb NOT NULL,
  saved_by        uuid REFERENCES app_user(id) ON DELETE SET NULL,
  saved_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (report_type_id, version)
);

CREATE TABLE project_logo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  sha256        text NOT NULL,
  storage_uri   text NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size     int  NOT NULL CHECK (byte_size > 0),
  uploaded_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, sha256)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['report_print_layout', 'project_logo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON report_print_layout, project_logo FROM app_rw;
GRANT SELECT ON report_print_layout, project_logo TO app_report;
