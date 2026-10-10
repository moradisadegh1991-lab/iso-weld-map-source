-- Reports that pass through stages of review, signature and approval: the
-- daily site report first, any report type after it.
--
--   report_type    a kind of report (daily report, weekly report…)
--   report_stage   its stages, in order (contractor → supervision → client)
--   review_group   the groups that review at a stage, in priority order
--   group_member   a user in a group, with the rights the group gives them
--   report         one report: its number, date, the stage it is at
--   report_version every content it has had; an edit adds a version
--   report_signature  every signature and every withdrawal of one
--   report_decision   every stage approval, return and cancellation
--   report_recipient  who the report was sent to
--
-- The rules (who may edit, sign, approve or return, and when) are decided in
-- lib/reports/workflow.mjs, not here. What the database itself guarantees is
-- that history is only ever added to: a version, a signature, a withdrawal
-- and a decision are rows that are never changed or removed.

CREATE TABLE report_type (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code         text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,11}$'),
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  description  text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

CREATE TABLE report_stage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_type_id  uuid NOT NULL REFERENCES report_type(id) ON DELETE CASCADE,
  seq             int  NOT NULL CHECK (seq >= 1),
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  UNIQUE (report_type_id, seq)
);

CREATE TABLE review_group (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  stage_id     uuid NOT NULL REFERENCES report_stage(id) ON DELETE CASCADE,
  seq          int  NOT NULL CHECK (seq >= 1),           -- priority within the stage
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  title        text,
  description  text,
  UNIQUE (stage_id, name),
  UNIQUE (stage_id, seq)
);

CREATE TABLE group_member (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL REFERENCES review_group(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  permissions  text[] NOT NULL DEFAULT ARRAY['view']::text[]
               CHECK (permissions <@ ARRAY['view', 'create', 'edit', 'edit_after_sign', 'delete', 'sign',
                                           'return', 'approve']::text[]),
  UNIQUE (group_id, user_id)
);

CREATE TABLE report (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_type_id    uuid NOT NULL REFERENCES report_type(id),
  report_no         text NOT NULL,
  report_date       date NOT NULL,
  title             text,
  stage_seq         int  NOT NULL DEFAULT 1 CHECK (stage_seq >= 1),   -- the stage it is at
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'cancelled')),
  created_by        uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  approved_version  int,                 -- the version the last stage approved: the record of the report
  approved_hash     text,                -- sha256 of that version's content
  approved_at       timestamptz,
  UNIQUE (project_id, report_no),
  CHECK (status <> 'approved' OR (approved_version IS NOT NULL AND approved_hash IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE report_version (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_id     uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  version_no    int  NOT NULL CHECK (version_no >= 1),
  stage_seq     int  NOT NULL,          -- the stage the report was at when this content was written
  content       jsonb NOT NULL,
  content_hash  text NOT NULL,
  edited_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  edited_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (report_id, version_no)
);

CREATE TABLE report_signature (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_id    uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  stage_seq    int  NOT NULL,
  group_id     uuid NOT NULL REFERENCES review_group(id),
  user_id      uuid NOT NULL REFERENCES app_user(id),
  action       text NOT NULL CHECK (action IN ('sign', 'withdraw')),
  version_no   int  NOT NULL,          -- the content the signature attests to
  at           timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX report_signature_report ON report_signature (report_id, stage_seq, at);

CREATE TABLE report_decision (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_id    uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  stage_seq    int  NOT NULL,
  action       text NOT NULL CHECK (action IN ('approved', 'returned', 'cancelled')),
  version_no   int  NOT NULL,
  user_id      uuid NOT NULL REFERENCES app_user(id),
  comment      text,
  at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (action = 'approved' OR length(btrim(comment)) > 0)    -- a return or a cancellation says why
);
CREATE INDEX report_decision_report ON report_decision (report_id, at);

CREATE TABLE report_recipient (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_id   uuid NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  sent_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  stage_seq   int  NOT NULL,
  note        text,
  sent_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['report_type', 'report_stage', 'review_group', 'group_member', 'report', 'report_version',
                           'report_signature', 'report_decision', 'report_recipient'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- History is added to, never rewritten.
REVOKE UPDATE, DELETE, TRUNCATE ON report_version, report_signature, report_decision FROM app_rw;

GRANT SELECT ON report_type, report_stage, review_group, group_member, report, report_version,
  report_signature, report_decision, report_recipient TO app_report;
