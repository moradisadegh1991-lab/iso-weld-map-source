-- ─────────────────────────────────────────────────────────────────────────
-- Installation equipment of an isometric (owner's request of 2026-11-02): a valve, strainer,
-- instrument… installed on the pipe, joined to one or more welds of the
-- sheet, with accessories (a gasket, bolts, nuts) that are rows of the same
-- BOM. The triangle on the sheet is its mark (sheetMarkup, kind "equipment");
-- these tables (named iso_*: the plant's equipment register is another thing) are its register, made to match the marks when the register is
-- saved (lib/db/repos/iso-equipment.mjs) — relations with keys, not a blob.
--
--   iso_equipment            one per mark of a drawing revision; `pt` the BOM row it is
--   iso_equipment_weld       the welds it joins (weld mark's id, number kept for reading)
--   iso_equipment_accessory  its accessories: BOM row, quantity, and their own installation status
--
-- The BOM quantities they take are in bom_allocation (migration 097), owner
-- kinds 'equipment' and 'accessory'.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE iso_equipment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  run_id       uuid REFERENCES extraction_run(id) ON DELETE SET NULL,
  mark_id      text NOT NULL CHECK (length(mark_id) BETWEEN 1 AND 120),
  equipment_no text NOT NULL DEFAULT '' CHECK (length(equipment_no) <= 120),
  tag          text CHECK (tag IS NULL OR length(tag) <= 120),
  type         text CHECK (type IS NULL OR length(type) <= 120),
  pt           integer CHECK (pt IS NULL OR pt BETWEEN 1 AND 999),
  spool        text CHECK (spool IS NULL OR length(spool) <= 120),
  status       text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'delivered', 'installed', 'tested')),
  note         text CHECK (note IS NULL OR length(note) <= 400),
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES app_user(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, mark_id)
);
CREATE INDEX iso_equipment_doc_idx ON iso_equipment (project_id, document_id);

CREATE TABLE iso_equipment_weld (
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES iso_equipment(id) ON DELETE CASCADE,
  weld_ref     text NOT NULL CHECK (length(weld_ref) BETWEEN 1 AND 120),
  weld_no      text CHECK (weld_no IS NULL OR length(weld_no) <= 120),
  PRIMARY KEY (equipment_id, weld_ref)
);

CREATE TABLE iso_equipment_accessory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES iso_equipment(id) ON DELETE CASCADE,
  pt           integer NOT NULL CHECK (pt BETWEEN 1 AND 999),
  qty          numeric(14,3) NOT NULL CHECK (qty > 0),
  unit         text NOT NULL DEFAULT 'pcs' CHECK (unit IN ('pcs', 'm')),
  status       text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'delivered', 'installed', 'tested')),
  UNIQUE (equipment_id, pt)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['iso_equipment', 'iso_equipment_weld', 'iso_equipment_accessory'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
