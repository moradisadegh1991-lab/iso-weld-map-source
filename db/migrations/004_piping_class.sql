-- ─────────────────────────────────────────────────────────────────────────
-- EPIC-4 · piping class
--
-- The piping class is the project's own specification: which material, which
-- schedule at each size, and how much examination. It outranks the code floor
-- in B31.3, and it is also the authority on WALL THICKNESS — which closes the
-- gap EPIC-3's qualification check has been reporting as unverifiable, since
-- a schedule label alone never told anyone a thickness.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE fluid_service AS ENUM (
  'normal', 'category_d', 'category_m', 'severe_cyclic', 'high_pressure'
);

CREATE TABLE piping_class (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code                text NOT NULL,              -- DX01, CS150...
  description         text,
  service_category    fluid_service NOT NULL,
  material_spec       text,
  corrosion_allow_mm  numeric(6,2),
  design_temp_c       numeric(7,2),
  design_press_barg   numeric(9,3),
  -- PWHT threshold, as the class states it. B31.3 Table 331.1.1 keys this on
  -- P-Number and thickness; the class is where a project pins it down.
  pwht_above_mm       numeric(6,2),
  -- Explicit rules, each stricter than the code or flagged as a deviation.
  -- A field-closure rule lives here, not in the engine: B31.3 draws no
  -- distinction between a shop and a field weld for examination.
  ndt_rules           jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

-- The size table off the class spec sheet. This is project data, not a copy
-- of B36.10M: the class states which schedule it uses at each size, and the
-- resulting thickness is what the qualification check needs.
CREATE TABLE piping_class_size (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  piping_class_id   uuid NOT NULL REFERENCES piping_class(id) ON DELETE CASCADE,
  nps               numeric(6,2) NOT NULL,
  schedule          text,
  wall_thickness_mm numeric(8,3) NOT NULL,
  od_mm             numeric(8,2),
  UNIQUE (piping_class_id, nps)
);

ALTER TABLE line ADD COLUMN piping_class_id uuid REFERENCES piping_class(id) ON DELETE SET NULL;

-- Which sample was drawn, with the seed, so it can be reproduced. An
-- inspector asking "why these welds" gets a procedure, not a shrug.
CREATE TABLE ndt_selection (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  line_id           uuid REFERENCES line(id) ON DELETE CASCADE,
  extraction_run_id uuid REFERENCES extraction_run(id) ON DELETE SET NULL,
  method            ndt_method NOT NULL,
  percent           numeric(5,2) NOT NULL,
  seed              text NOT NULL,
  selected_uids     text[] NOT NULL,
  rationale         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES app_user(id) ON DELETE SET NULL
);

CREATE INDEX ndt_selection_line_idx ON ndt_selection (project_id, line_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['piping_class', 'piping_class_size', 'ndt_selection'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
  END LOOP;
END $$;
