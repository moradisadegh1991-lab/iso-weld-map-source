-- ─────────────────────────────────────────────────────────────────────────
-- What each spool is made of, in the drawing's stock codes — written with
-- the register from the engine's elements and the drawing's BOM
-- (lib/piping/spool-bom.mjs). A line the BOM cannot match is kept with
-- its reason, not dropped.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE spool_material (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  spool_id     uuid NOT NULL REFERENCES spool(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('pipe', 'fitting')),
  fitting_type text,
  nps          numeric(6,2),
  qty          numeric(14,3) NOT NULL,
  uom          text NOT NULL,
  stock_code   text,
  description  text,
  reason       text,                     -- why stock_code is null
  CHECK (stock_code IS NOT NULL OR reason IS NOT NULL)
);
CREATE INDEX spool_material_spool ON spool_material (spool_id);

ALTER TABLE spool_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE spool_material FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON spool_material USING (project_id = current_project_id())
  WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT ON spool_material TO app_rw;
GRANT SELECT ON spool_material TO app_report;
