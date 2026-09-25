-- ─────────────────────────────────────────────────────────────────────────
-- Document control: the master document register (MDR), every revision
-- issued with its purpose, and transmittals with the client's return codes.
--
-- The rules are lib/documents/control.mjs. The `document` table (migration
-- 001) stays what it is: an uploaded sheet with its bytes. The MDR is the
-- register those sheets are checked against — an isometric extracted from
-- a revision that was not the construction revision on the day is flagged.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE mdr_document (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  doc_no             text NOT NULL,
  title              text NOT NULL,
  discipline         text,
  doc_type           text,
  originator         text,                   -- EPC, vendor, contractor, client
  subsystem_id       uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  tag_id             uuid REFERENCES tag(id) ON DELETE SET NULL,
  approval_required  boolean NOT NULL DEFAULT false,
  planned_ifc_on     date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, doc_no)
);

-- An issued revision is a fact; it is superseded by the next, never edited.
CREATE TABLE mdr_revision (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mdr_id      uuid NOT NULL REFERENCES mdr_document(id) ON DELETE CASCADE,
  revision    text NOT NULL,
  purpose     text NOT NULL,
  issued_on   date NOT NULL,
  note        text,
  issued_by   uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (mdr_id, revision)
);
ALTER TABLE mdr_revision ADD CONSTRAINT mdr_purpose_known CHECK (purpose IN ('IFR', 'IFA', 'IFC', 'AB', 'VOID'));

CREATE TABLE transmittal (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  transmittal_no  text NOT NULL,
  to_party        text NOT NULL,
  purpose         text NOT NULL,
  sent_on         date NOT NULL,
  response_due    date,
  sent_by         uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, transmittal_no)
);
ALTER TABLE transmittal ADD CONSTRAINT transmittal_due_after_sent CHECK (response_due IS NULL OR response_due >= sent_on);

CREATE TABLE transmittal_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  transmittal_id  uuid NOT NULL REFERENCES transmittal(id) ON DELETE CASCADE,
  revision_id     uuid NOT NULL REFERENCES mdr_revision(id),
  return_code     smallint,
  returned_on     date,
  comment         text,
  UNIQUE (transmittal_id, revision_id)
);
ALTER TABLE transmittal_item ADD CONSTRAINT return_code_known CHECK (return_code IS NULL OR return_code BETWEEN 1 AND 4);
ALTER TABLE transmittal_item ADD CONSTRAINT return_is_dated CHECK ((return_code IS NULL) = (returned_on IS NULL));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mdr_document', 'mdr_revision', 'transmittal', 'transmittal_item'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON mdr_revision FROM app_rw;
GRANT SELECT, INSERT ON mdr_revision TO app_rw;
-- A transmittal is sent; only the client's return is filled in afterwards.
REVOKE UPDATE, DELETE, TRUNCATE ON transmittal_item FROM app_rw;
GRANT SELECT, INSERT ON transmittal_item TO app_rw;
GRANT UPDATE (return_code, returned_on, comment) ON transmittal_item TO app_rw;
GRANT SELECT ON mdr_document, mdr_revision, transmittal, transmittal_item TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_mdr_revision WITH (security_invoker = true) AS
SELECT r.id AS revision_key, r.project_id AS project_key, d.id AS mdr_key, d.doc_no, d.discipline, d.doc_type,
       d.subsystem_id AS subsystem_key, d.tag_id AS tag_key, r.revision, r.purpose, r.issued_on, d.planned_ifc_on
  FROM mdr_revision r JOIN mdr_document d ON d.id = r.mdr_id;

CREATE VIEW reporting.fact_transmittal_item WITH (security_invoker = true) AS
SELECT i.id AS item_key, i.project_id AS project_key, t.transmittal_no, t.to_party, t.purpose, t.sent_on, t.response_due,
       i.revision_id AS revision_key, i.return_code, i.returned_on
  FROM transmittal_item i JOIN transmittal t ON t.id = i.transmittal_id;

GRANT SELECT ON reporting.fact_mdr_revision, reporting.fact_transmittal_item TO app_rw, app_report;
