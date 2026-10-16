-- ─────────────────────────────────────────────────────────────────────────
-- The organisation's process, steps 5–6: reports belong to contracts, and a
-- report carries photos (with a caption and tags) and attached files.
-- The content and its stage rules are lib/reports/contract-daily.mjs; the
-- workflow (stages, groups, signatures, approval) is the one of 058/068.
-- A file is never deleted: it is marked removed, by whom and when.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE report ADD COLUMN contract_id uuid REFERENCES contract(id) ON DELETE RESTRICT;
CREATE INDEX report_contract ON report (contract_id, report_date);

CREATE TABLE report_file (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_id     uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('photo', 'file')),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  caption       text,
  tags          text[] NOT NULL DEFAULT '{}',
  sha256        text NOT NULL,
  storage_uri   text NOT NULL,
  content_type  text NOT NULL,
  byte_size     int  NOT NULL CHECK (byte_size > 0),
  stage_seq     int  NOT NULL,
  uploaded_by   uuid REFERENCES app_user(id),
  uploaded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_by    uuid REFERENCES app_user(id),
  removed_at    timestamptz,
  CHECK (kind <> 'photo' OR content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
CREATE INDEX report_file_report ON report_file (report_id);
ALTER TABLE report_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_file FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON report_file USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
REVOKE UPDATE, DELETE, TRUNCATE ON report_file FROM app_rw;
GRANT UPDATE (removed_by, removed_at, caption, tags) ON report_file TO app_rw;
GRANT SELECT ON report_file TO app_report;
