-- ─────────────────────────────────────────────────────────────────────────
-- A project's own picking lists (owner's request of 2026-11-01): the values
-- a person picks, not types, in the isometric and weld-list tables (joint
-- type, size, schedule, material, WPS, support type, BOM group, line-data
-- values…). lib/register/value-lists.mjs names the lists and their built-in
-- values; a row here replaces a list's built-in values for this project,
-- saved whole, in the order the person put them.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE value_list (
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  list_key     text NOT NULL CHECK (list_key ~ '^[a-zA-Z]{1,40}$'),
  items        text[] NOT NULL CHECK (cardinality(items) <= 300),
  updated_by   uuid REFERENCES app_user(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, list_key)
);

ALTER TABLE value_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE value_list FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON value_list USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON value_list TO app_rw;
GRANT SELECT ON value_list TO app_report;
