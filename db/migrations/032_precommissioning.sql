-- ─────────────────────────────────────────────────────────────────────────
-- Pre-commissioning checklists and the RFSU certificate.
--
-- The rules are lib/completions/precom.mjs. Here: what the project declares
-- (its checklists and what each applies to), the attempts against them,
-- and the certificate. An attempt is evidence: added, never rewritten —
-- only its acceptance is set afterwards, by someone other than the
-- performer (held here too). A certificate is never deleted.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE precom_template (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code        text NOT NULL,
  title       text NOT NULL,
  applies_to  text NOT NULL,
  criteria    text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
ALTER TABLE precom_template ADD CONSTRAINT precom_applies_known CHECK (
  applies_to IN ('subsystem', 'rotating', 'static', 'fired', 'line', 'cable', 'instrument', 'loop'));

CREATE TABLE precom_attempt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  subsystem_id  uuid NOT NULL REFERENCES subsystem(id) ON DELETE CASCADE,
  template_id   uuid NOT NULL REFERENCES precom_template(id) ON DELETE RESTRICT,
  item_ref      text NOT NULL,          -- the item's id, or a loop number, or the subsystem's id
  result        text NOT NULL,
  performed_on  date NOT NULL,
  performed_by  uuid NOT NULL REFERENCES app_user(id),
  witnessed_by  text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_by   uuid REFERENCES app_user(id),
  accepted_at   timestamptz
);
ALTER TABLE precom_attempt ADD CONSTRAINT precom_result_known CHECK (result IN ('pass', 'fail'));
ALTER TABLE precom_attempt ADD CONSTRAINT precom_fail_says_why CHECK (result = 'pass' OR note IS NOT NULL);
ALTER TABLE precom_attempt ADD CONSTRAINT precom_only_pass_accepted CHECK (accepted_by IS NULL OR result = 'pass');
ALTER TABLE precom_attempt ADD CONSTRAINT precom_acceptor_not_performer CHECK (accepted_by IS NULL OR accepted_by IS DISTINCT FROM performed_by);
CREATE INDEX precom_attempt_item ON precom_attempt (project_id, subsystem_id, template_id, item_ref, created_at);

CREATE TABLE rfsu_certificate (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  subsystem_id  uuid NOT NULL REFERENCES subsystem(id) ON DELETE CASCADE,
  snapshot      jsonb NOT NULL,
  signed_by     uuid NOT NULL REFERENCES app_user(id),
  signed_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_by   uuid REFERENCES app_user(id),
  accepted_at   timestamptz,
  UNIQUE (project_id, subsystem_id)
);
ALTER TABLE rfsu_certificate ADD CONSTRAINT rfsu_acceptor_not_signer CHECK (accepted_by IS NULL OR accepted_by IS DISTINCT FROM signed_by);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['precom_template', 'precom_attempt', 'rfsu_certificate'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;

REVOKE DELETE, TRUNCATE ON precom_attempt, rfsu_certificate FROM app_rw;
REVOKE UPDATE ON precom_attempt, rfsu_certificate FROM app_rw;
GRANT UPDATE (accepted_by, accepted_at) ON precom_attempt, rfsu_certificate TO app_rw;

CREATE VIEW reporting.fact_rfsu WITH (security_invoker = true) AS
SELECT r.project_id AS project_key, r.subsystem_id AS subsystem_key, r.signed_at, r.accepted_at,
       (r.accepted_by IS NOT NULL) AS is_accepted
  FROM rfsu_certificate r;
GRANT SELECT ON reporting.fact_rfsu TO app_rw, app_report;
