-- ─────────────────────────────────────────────────────────────────────────
-- The organisation's process, step 3: users and their access.
--
-- app_user           a username to sign in with (besides the email), job
--                    title, field of expertise, phone and the company they
--                    work for (from the company directory, 067)
-- contract_member    a user assigned to a contract, with their position there
--                    and an access level
-- group_member       two more rights in a report's review group: add content
--                    (new rows) and delete content (remove rows); "edit" stays
--                    the right to change rows that exist
-- report_stage       each stage's one final approver and their deputy. While a
--                    stage names an approver, only they — or the deputy — issue
--                    its final approval, after signing the current content
-- report_signature / report_decision
--                    on_behalf_of: the approver a deputy acted for, kept with
--                    the act (the footer prints «از طرف …»)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE app_user ADD COLUMN username   text;
ALTER TABLE app_user ADD COLUMN job_title  text;
ALTER TABLE app_user ADD COLUMN specialty  text;
ALTER TABLE app_user ADD COLUMN phone      text;
ALTER TABLE app_user ADD COLUMN company_id uuid REFERENCES company(id) ON DELETE SET NULL;
ALTER TABLE app_user ADD CONSTRAINT app_user_username_shape CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
CREATE UNIQUE INDEX app_user_username ON app_user (username) WHERE username IS NOT NULL;

CREATE TABLE contract_member (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  position     text NOT NULL CHECK (length(btrim(position)) > 0),
  access       text NOT NULL CHECK (access IN ('view', 'edit', 'manage')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, user_id)
);
ALTER TABLE contract_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_member FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON contract_member USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT ON contract_member TO app_report;

ALTER TABLE group_member DROP CONSTRAINT group_member_permissions_check;
ALTER TABLE group_member ADD CONSTRAINT group_member_permissions_check
  CHECK (permissions <@ ARRAY['view', 'create', 'add_content', 'edit', 'edit_after_sign', 'delete_content', 'delete', 'sign',
                              'return', 'approve']::text[]);

ALTER TABLE report_stage ADD COLUMN approver_id uuid REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE report_stage ADD COLUMN deputy_id   uuid REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE report_stage ADD CONSTRAINT report_stage_deputy_not_approver CHECK (deputy_id IS NULL OR deputy_id IS DISTINCT FROM approver_id);
ALTER TABLE report_stage ADD CONSTRAINT report_stage_deputy_needs_approver CHECK (deputy_id IS NULL OR approver_id IS NOT NULL);

ALTER TABLE report_signature ADD COLUMN on_behalf_of uuid REFERENCES app_user(id);
ALTER TABLE report_decision  ADD COLUMN on_behalf_of uuid REFERENCES app_user(id);

-- 5.1 item 7: the colour a stage's changed rows are shown in (a row whose value
-- the stage changed carries the stage's name and this colour).
ALTER TABLE report_stage ADD COLUMN change_color text CHECK (change_color IS NULL OR change_color ~ '^#[0-9a-fA-F]{6}$');
