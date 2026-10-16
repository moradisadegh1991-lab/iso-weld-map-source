-- ─────────────────────────────────────────────────────────────────────────
-- Handover to maintenance: the asset master a CMMS needs per tag, the
-- project's rules for it, and a log of every export.
--
-- The rules are lib/cmms/handover.mjs. Nameplate data and criticality are
-- corrected, not overwritten silently: every change is kept, with who made
-- it — thirty years of maintenance will ask where a serial number came from.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE project
  ADD COLUMN cmms_plant_code     text,     -- the plant's code in the CMMS
  ADD COLUMN floc_template       text,     -- e.g. {plant}-{unit}-{system}-{tag}
  ADD COLUMN criticality_levels  text;     -- e.g. "A, B, C" — company policy, no default

CREATE TABLE asset_master (
  tag_id             uuid PRIMARY KEY REFERENCES tag(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  iso_class          text,
  criticality        text,
  criticality_basis  text,
  manufacturer       text,
  model              text,
  serial_no          text,
  year_built         integer,
  updated_by         uuid REFERENCES app_user(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_master_revision (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  snapshot    jsonb NOT NULL,
  by_user     uuid REFERENCES app_user(id),
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE handover_export (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  rows_total  integer NOT NULL,
  rows_ready  integer NOT NULL,
  sha256      char(64) NOT NULL,
  by_user     uuid REFERENCES app_user(id),
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asset_master', 'asset_master_revision', 'handover_export'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON asset_master_revision, handover_export FROM app_rw;
GRANT SELECT, INSERT ON asset_master_revision, handover_export TO app_rw;
GRANT SELECT ON asset_master, asset_master_revision, handover_export TO app_report;

CREATE VIEW reporting.dim_asset_master WITH (security_invoker = true) AS
SELECT t.id AS tag_key, t.project_id AS project_key, t.tag_no, t.description, t.subsystem_id AS subsystem_key,
       m.iso_class, m.criticality, m.manufacturer, m.model, m.serial_no, m.year_built
  FROM tag t LEFT JOIN asset_master m ON m.tag_id = t.id
 WHERE t.discipline = 'equipment';

GRANT SELECT ON reporting.dim_asset_master TO app_rw, app_report;
