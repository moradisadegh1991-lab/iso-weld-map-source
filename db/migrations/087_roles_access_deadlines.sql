-- ─────────────────────────────────────────────────────────────────────────
-- Roles, a person's own access, and stage deadlines (owner's requirements of
-- 2026-10-22, items 1 and 2-a; docs/digital-epc/14-owner-requirements.md).
--
--   contract_role         a role of a contract («نظارت کارگاه», «پیمانکار
--                         لوله‌کشی»): it gathers the duties of that contract.
--   duty.role_id          the role a duty belongs to (none: a duty of the
--                         project, as before)
--   duty_member           a person holding a duty now carries
--     .permissions        their own access level: of the rights the duty has
--                         in a group, only these (none: all of them)
--     .temporary, .starts_on, .ends_on
--                         a temporary holding counts only from its first day
--                         to its last; both days are required
--   report_stage
--     .approver_duty_id, .deputy_duty_id
--                         the final approver and deputy named by a duty: who
--                         holds it, signs and approves (one of them is
--                         enough), instead of a named person
--     .deadline_days, .deadline_text
--                         days the stage has to review a report; past them it
--                         counts as approved, and the text shows where the
--                         signature would have been. Both or neither.
--   report_decision.auto  an approval the deadline gave, not a person: no
--                         user, written at the moment the days ran out.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE contract_role (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  description  text,
  seq          int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, name)
);
ALTER TABLE contract_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_role FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON contract_role USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_role TO app_rw;
GRANT SELECT ON contract_role TO app_report;

ALTER TABLE duty ADD COLUMN role_id uuid REFERENCES contract_role(id) ON DELETE SET NULL;

ALTER TABLE duty_member ADD COLUMN permissions text[]
  CHECK (permissions IS NULL OR (cardinality(permissions) > 0 AND permissions <@ ARRAY['view', 'create', 'add_content', 'edit', 'delete_content', 'delete', 'sign',
                                                                                       'return', 'approve']::text[]));
ALTER TABLE duty_member ADD COLUMN temporary boolean NOT NULL DEFAULT false;
ALTER TABLE duty_member ADD COLUMN starts_on date;
ALTER TABLE duty_member ADD COLUMN ends_on date;
ALTER TABLE duty_member ADD CONSTRAINT duty_member_temporary_days CHECK (
  (temporary AND starts_on IS NOT NULL AND ends_on IS NOT NULL AND ends_on >= starts_on)
  OR (NOT temporary AND starts_on IS NULL AND ends_on IS NULL));

ALTER TABLE report_stage ADD COLUMN approver_duty_id uuid REFERENCES duty(id) ON DELETE SET NULL;
ALTER TABLE report_stage ADD COLUMN deputy_duty_id uuid REFERENCES duty(id) ON DELETE SET NULL;
ALTER TABLE report_stage ADD CONSTRAINT report_stage_one_approver CHECK (approver_id IS NULL OR approver_duty_id IS NULL);
ALTER TABLE report_stage ADD CONSTRAINT report_stage_deputy_duty CHECK (deputy_duty_id IS NULL OR (approver_duty_id IS NOT NULL AND deputy_duty_id <> approver_duty_id));
ALTER TABLE report_stage ADD COLUMN deadline_days int CHECK (deadline_days IS NULL OR deadline_days BETWEEN 1 AND 365);
ALTER TABLE report_stage ADD COLUMN deadline_text text CHECK (deadline_text IS NULL OR length(btrim(deadline_text)) BETWEEN 1 AND 200);
ALTER TABLE report_stage ADD CONSTRAINT report_stage_deadline_both CHECK ((deadline_days IS NULL) = (deadline_text IS NULL));

ALTER TABLE report_decision ADD COLUMN auto boolean NOT NULL DEFAULT false;
ALTER TABLE report_decision ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE report_decision ADD CONSTRAINT report_decision_who CHECK ((auto AND user_id IS NULL AND action = 'approved') OR (NOT auto AND user_id IS NOT NULL));
