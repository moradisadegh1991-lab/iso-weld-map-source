-- A person's signature image: drawn on screen or a scanned signature.
--
-- It belongs to the person, not to a project, so it has no project_id and no
-- row security; who may SEE it is decided where it is served (only members
-- of a project the person is also in). Every image ever used is kept: a new
-- one is a new row, and the latest is the one in use. A report signature
-- records which image it was given with, so a report signed last year still
-- prints the signature it was signed with after the person changes theirs.

CREATE TABLE user_signature (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('drawn', 'scanned')),
  sha256        text NOT NULL,
  storage_uri   text NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size     int  NOT NULL CHECK (byte_size > 0),
  uploaded_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX user_signature_user ON user_signature (user_id, uploaded_at DESC);

REVOKE UPDATE, DELETE, TRUNCATE ON user_signature FROM app_rw;

ALTER TABLE report_signature ADD COLUMN signature_id uuid REFERENCES user_signature(id);
