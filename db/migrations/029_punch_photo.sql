-- ─────────────────────────────────────────────────────────────────────────
-- Site photos on punch items. The bytes live in the content-addressed
-- store (lib/storage/content-store.mjs) under their SHA-256; this row says
-- which item, which stage, when it was taken and by whom. Evidence: the
-- application can add a photo, never change or remove one. The same bytes
-- on the same item are one photo.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE punch_photo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  punch_id      uuid NOT NULL REFERENCES punch_item(id) ON DELETE CASCADE,
  sha256        char(64) NOT NULL,
  storage_uri   text NOT NULL,
  content_type  text NOT NULL,
  byte_size     integer NOT NULL,
  stage         text NOT NULL,
  taken_on      date NOT NULL,
  uploaded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (punch_id, sha256)
);
ALTER TABLE punch_photo ADD CONSTRAINT punch_photo_stage_known CHECK (stage IN ('raised', 'cleared', 'other'));
ALTER TABLE punch_photo ADD CONSTRAINT punch_photo_is_image CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp'));
CREATE INDEX punch_photo_punch ON punch_photo (punch_id);

ALTER TABLE punch_photo ENABLE ROW LEVEL SECURITY;
ALTER TABLE punch_photo FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON punch_photo USING (project_id = current_project_id())
  WITH CHECK (project_id = current_project_id());

REVOKE UPDATE, DELETE, TRUNCATE ON punch_photo FROM app_rw;
GRANT SELECT, INSERT ON punch_photo TO app_rw;
GRANT SELECT ON punch_photo TO app_report;
