-- ─────────────────────────────────────────────────────────────────────────
-- MESC numbers on stock items, checked against the owner's catalogue.
--
-- The catalogue (numbers, group titles, units) is the owner's — imported
-- from its MESC book with the edition named — and the platform holds none
-- of its own. Rules: lib/warehouse/mesc.mjs.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE material_item ADD COLUMN mesc_code text;
ALTER TABLE material_item ADD CONSTRAINT material_mesc_ten_digits CHECK (mesc_code IS NULL OR mesc_code ~ '^[0-9]{10}$');
-- One MESC number, one stock item: a second item with the same number is a duplicate in the stock master.
CREATE UNIQUE INDEX material_item_mesc_once ON material_item (project_id, mesc_code) WHERE mesc_code IS NOT NULL;

ALTER TABLE project ADD COLUMN mesc_edition text;   -- which catalogue edition the codes were checked against

CREATE TABLE mesc_group (
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  prefix      text NOT NULL,
  title       text NOT NULL,
  PRIMARY KEY (project_id, prefix)
);
ALTER TABLE mesc_group ADD CONSTRAINT mesc_group_prefix CHECK (prefix ~ '^([0-9]{2}|[0-9]{4}|[0-9]{6})$');

CREATE TABLE mesc_entry (
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code         text NOT NULL,
  description  text NOT NULL,
  uom          text,
  PRIMARY KEY (project_id, code)
);
ALTER TABLE mesc_entry ADD CONSTRAINT mesc_entry_code CHECK (code ~ '^[0-9]{10}$');

CREATE TABLE mesc_import (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  edition     text NOT NULL,
  groups      integer NOT NULL,
  entries     integer NOT NULL,
  by_user     uuid REFERENCES app_user(id),
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mesc_group', 'mesc_entry', 'mesc_import'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
REVOKE UPDATE, DELETE, TRUNCATE ON mesc_import FROM app_rw;
