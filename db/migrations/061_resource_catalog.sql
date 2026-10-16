-- The daily report's catalogue: the roles, machines, tools, consumables and
-- materials a project reports, each with its kind and — for what is not
-- counted in heads or machines — its unit. Offered to the form as the
-- writer types; a name not in it can still be typed (and is reported as
-- typed). `source` says where an item came from (an import, or a person).

CREATE TABLE resource_catalog (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('person', 'machine', 'tool', 'consumable', 'material', 'project_material')),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  name_en     text,
  discipline  text,
  unit        text,
  source      text NOT NULL DEFAULT 'manual',
  source_ref  text,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, name),
  CHECK (kind IN ('person', 'machine') OR unit IS NOT NULL OR source <> 'manual')
);

ALTER TABLE resource_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON resource_catalog USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT ON resource_catalog TO app_report;
