-- ─────────────────────────────────────────────────────────────────────────
-- The line list a drawing's title block prints, and the drawing's bill of
-- material, kept when its weld register is saved (owner's request of
-- 2026-11-01: «first the line-list data, checked against what is already
-- registered, then the BOM — and all of them registered»).
--
--   line            the line-list values the title block prints for the
--                   line: design and operating pressure and temperature,
--                   the test pressure and fluid, NDT, PWHT, paint and the
--                   insulation's thickness (`insulation` already holds its
--                   type). Text as printed — the sheet names its own units
--                   (barg, °C) and a value is never converted or guessed.
--                   A sheet fills a value only where the line has none; a
--                   value that differs from the one on file is reported,
--                   never written over (lib/db/repos/line-list.mjs).
--
--   iso_bom_row     the bill of material of one drawing sheet revision (a
--                   `document` row), one row per PT number as a person
--                   checked it on the review page: group, description,
--                   size, item code, quantity and its unit. Saved again
--                   with each save of that sheet's register until the
--                   register is approved; an approved register's BOM is
--                   not rewritten (a correction is a new revision).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE line
  ADD COLUMN design_pressure     text,
  ADD COLUMN operating_pressure  text,
  ADD COLUMN design_temp         text,
  ADD COLUMN operating_temp      text,
  ADD COLUMN test_pressure       text,
  ADD COLUMN test_fluid          text,
  ADD COLUMN ndt                 text,
  ADD COLUMN pwht                text,
  ADD COLUMN paint               text,
  ADD COLUMN insulation_thk      text;

CREATE TABLE iso_bom_row (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  run_id       uuid REFERENCES extraction_run(id) ON DELETE SET NULL,
  line_id      uuid REFERENCES line(id) ON DELETE SET NULL,
  pt           integer NOT NULL CHECK (pt BETWEEN 1 AND 999),
  grp          text,
  description  text NOT NULL DEFAULT '' CHECK (length(description) <= 400),
  size         text,
  item_code    text,
  qty          numeric(14,3) CHECK (qty IS NULL OR qty >= 0),
  qty_unit     text CHECK (qty_unit IS NULL OR qty_unit IN ('m', 'pcs')),
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, pt)
);
CREATE INDEX iso_bom_row_line_idx ON iso_bom_row (project_id, line_id);

ALTER TABLE iso_bom_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE iso_bom_row FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON iso_bom_row USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON iso_bom_row TO app_rw;
GRANT SELECT ON iso_bom_row TO app_report;
