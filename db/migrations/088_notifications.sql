-- ─────────────────────────────────────────────────────────────────────────
-- Notifications (owner's requirements of 2026-10-22, item 15: «فرمی به نام
-- نوتیفیکیشن که بتوان برای سایر کاربران نوتیفیکیشن ارسال نمود با امکان
-- فایل پیوست و مهلت پاسخ‌گویی»).
--
--   notification            a message one member sends others of the project:
--                           a title, its text, and the day a reply is due by
--                           (none: no reply asked for)
--   notification_recipient  each person it went to: when they read it, and
--                           their one reply and when (after the day: late,
--                           and shown so)
--   notification_file       its attachments, in the content store like every
--                           other file of the platform
-- A notification is not edited or withdrawn once sent: what was sent is the
-- record of what was asked.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE notification (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES app_user(id),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body        text CHECK (body IS NULL OR length(body) <= 10000),
  reply_due   date,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX notification_sender ON notification (project_id, sender_id, created_at DESC);

CREATE TABLE notification_recipient (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  notification_id  uuid NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES app_user(id),
  read_at          timestamptz,
  reply            text CHECK (reply IS NULL OR length(btrim(reply)) BETWEEN 1 AND 5000),
  replied_at       timestamptz,
  UNIQUE (notification_id, user_id),
  CHECK ((reply IS NULL) = (replied_at IS NULL))
);
CREATE INDEX notification_inbox ON notification_recipient (project_id, user_id);

CREATE TABLE notification_file (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  notification_id  uuid NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  sha256           text NOT NULL,
  storage_uri      text NOT NULL,
  content_type     text NOT NULL,
  byte_size        int  NOT NULL CHECK (byte_size > 0)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification', 'notification_recipient', 'notification_file'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
-- a notification and its files never change; a recipient's row only takes its read and reply
REVOKE UPDATE, DELETE, TRUNCATE ON notification, notification_recipient, notification_file FROM app_rw;
GRANT UPDATE (read_at, reply, replied_at) ON notification_recipient TO app_rw;
