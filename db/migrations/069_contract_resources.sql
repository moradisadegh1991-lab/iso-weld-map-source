-- ─────────────────────────────────────────────────────────────────────────
-- The organisation's process, step 4: a contract's resources, each in a
-- branch of the contract's resource tree (067). Type, discipline/group (the
-- branch), name, direct or indirect, unit, forecast quantity, actual quantity
-- needed, status and description. The daily report's resource section
-- (step 6) counts against these.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE contract_resource (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  category_id   uuid REFERENCES contract_category(id) ON DELETE RESTRICT,
  kind          text NOT NULL CHECK (kind IN ('person', 'machine', 'tool', 'consumable', 'material', 'project_material')),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  direct        boolean NOT NULL DEFAULT true,
  unit          text,
  forecast_qty  numeric(14,2) CHECK (forecast_qty IS NULL OR forecast_qty >= 0),
  actual_qty    numeric(14,2) CHECK (actual_qty IS NULL OR actual_qty >= 0),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'demobilised')),
  description   text,
  seq           int NOT NULL DEFAULT 1,
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, kind, name),
  CHECK (kind IN ('person', 'machine') OR unit IS NOT NULL)      -- a quantity without a unit means nothing
);
CREATE INDEX contract_resource_category ON contract_resource (category_id);
ALTER TABLE contract_resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_resource FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON contract_resource USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT ON contract_resource TO app_report;
