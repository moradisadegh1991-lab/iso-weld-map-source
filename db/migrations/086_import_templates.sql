-- ─────────────────────────────────────────────────────────────────────────
-- Excel templates a person builds (owner's requirements of 2026-10-22,
-- «کاربر قابلیت ایجاد فایل الگو با توجه به ستون‌ها داشته باشد و فایل الگو
-- را با نام خاصی ذخیره نماید»).
--
--   import_template   of one of the platform's templates (its key in
--                     lib/import-templates.mjs), the columns kept, under a
--                     name of its own; the project's, for every member.
--                     Which columns are allowed and which cannot be left
--                     out is the template's own rule, checked before saving.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE import_template (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind ~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$'),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  columns     text[] NOT NULL CHECK (cardinality(columns) > 0),
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, name)
);

ALTER TABLE import_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_template FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON import_template USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON import_template TO app_rw;
GRANT SELECT ON import_template TO app_report;
