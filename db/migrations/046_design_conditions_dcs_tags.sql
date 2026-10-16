-- ─────────────────────────────────────────────────────────────────────────
-- Asset master: design conditions from the equipment datasheet, and the
-- tag's identifiers in the DCS / Historian (Master Plan §4).
--
-- Design pressure and design temperature are numbers an engineer reads off
-- a datasheet — the platform cannot OCR a PDF — but it will not take them
-- without saying which datasheet: design_datasheet_rev_id points at an
-- ISSUED revision already in the MDR (026), and lib/cmms/handover.mjs
-- refuses one that is not registered against this very tag. A value with
-- no revision, or a revision with no value, is rejected (see
-- designConditionProblems in lib/cmms/handover.mjs).
--
-- DCS / Historian tags are a small registry, not a live integration: the
-- point's label (what it measures) with its identifier in either system —
-- at least one of the two, since a point control-room operators watch on
-- the DCS may not yet be archived, and a Historian-only point (a computed
-- KPI) may have no live DCS tag.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE asset_master
  ADD COLUMN design_pressure_barg    numeric,
  ADD COLUMN design_temp_min_c       numeric,
  ADD COLUMN design_temp_max_c       numeric,
  ADD COLUMN design_datasheet_rev_id uuid REFERENCES mdr_revision(id) ON DELETE SET NULL;

CREATE TABLE asset_dcs_tag (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  label          text NOT NULL,
  dcs_tag        text,
  historian_tag  text,
  uom            text,
  note           text,
  created_by     uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, tag_id, label)
);

ALTER TABLE asset_dcs_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_dcs_tag FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON asset_dcs_tag USING (project_id = current_project_id())
  WITH CHECK (project_id = current_project_id());

GRANT SELECT ON asset_dcs_tag TO app_report;

CREATE VIEW reporting.dim_dcs_tag WITH (security_invoker = true) AS
SELECT a.id, a.project_id AS project_key, a.tag_id AS tag_key, t.tag_no, a.label, a.dcs_tag, a.historian_tag, a.uom
  FROM asset_dcs_tag a JOIN tag t ON t.id = a.tag_id;

GRANT SELECT ON reporting.dim_dcs_tag TO app_rw, app_report;

-- Design conditions on the existing reporting view.
DROP VIEW reporting.dim_asset_master;
CREATE VIEW reporting.dim_asset_master WITH (security_invoker = true) AS
SELECT t.id AS tag_key, t.project_id AS project_key, t.tag_no, t.description, t.subsystem_id AS subsystem_key,
       m.iso_class, m.criticality, m.manufacturer, m.model, m.serial_no, m.year_built,
       m.design_pressure_barg, m.design_temp_min_c, m.design_temp_max_c
  FROM tag t LEFT JOIN asset_master m ON m.tag_id = t.id
 WHERE t.discipline = 'equipment';

GRANT SELECT ON reporting.dim_asset_master TO app_rw, app_report;
