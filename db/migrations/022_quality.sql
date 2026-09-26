-- ─────────────────────────────────────────────────────────────────────────
-- Punch list and non-conformance (NCR).
--
-- The rules are lib/quality/quality.mjs. Here: the records, and an event
-- log for each that the application can add to but never rewrite — a punch
-- item downgraded from A to B, or an NCR disposition that was rejected,
-- stays visible after the fact.
-- ─────────────────────────────────────────────────────────────────────────

-- How long an NCR may be overdue before it goes to the project manager.
-- Project policy; no default.
ALTER TABLE project ADD COLUMN ncr_escalation_days integer;
ALTER TABLE project ADD CONSTRAINT ncr_escalation_positive CHECK (ncr_escalation_days IS NULL OR ncr_escalation_days > 0);

CREATE TABLE punch_item (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  punch_no             text NOT NULL,
  subsystem_id         uuid NOT NULL REFERENCES subsystem(id) ON DELETE RESTRICT,
  tag_id               uuid REFERENCES tag(id) ON DELETE SET NULL,
  discipline           discipline,
  category             char(1) NOT NULL,
  description          text NOT NULL,
  location             text,
  action_contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  raised_by            uuid REFERENCES app_user(id),
  raised_on            date NOT NULL,
  due_on               date,
  status               text NOT NULL DEFAULT 'open',
  cleared_by           uuid REFERENCES app_user(id),
  cleared_on           date,
  clear_note           text,
  closed_by            uuid REFERENCES app_user(id),
  closed_on            date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, punch_no)
);
ALTER TABLE punch_item ADD CONSTRAINT punch_category_known CHECK (category IN ('A', 'B', 'C'));
ALTER TABLE punch_item ADD CONSTRAINT punch_status_known CHECK (status IN ('open', 'cleared', 'closed'));
-- The one who did the work does not accept it — held here as well as in
-- the engine, because it is the rule a hurried MC walkdown breaks.
ALTER TABLE punch_item ADD CONSTRAINT punch_verifier_not_clearer CHECK (closed_by IS NULL OR closed_by IS DISTINCT FROM cleared_by);
CREATE INDEX punch_item_subsystem ON punch_item (project_id, subsystem_id, status);

CREATE TABLE punch_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  punch_id    uuid NOT NULL REFERENCES punch_item(id) ON DELETE CASCADE,
  event       text NOT NULL,
  from_value  text,
  to_value    text,
  note        text,
  by_user     uuid REFERENCES app_user(id),
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE punch_event ADD CONSTRAINT punch_event_known CHECK (
  event IN ('raised', 'cleared', 'rejected', 'closed', 'recategorised'));

CREATE TABLE ncr (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  ncr_no            text NOT NULL,
  title             text NOT NULL,
  description       text NOT NULL,
  requirement       text,                   -- the spec / drawing / code clause not met
  source            text,                   -- inspection, audit, client, NDT …
  severity          text NOT NULL,
  discipline        discipline,
  subsystem_id      uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  tag_id            uuid REFERENCES tag(id) ON DELETE SET NULL,
  contractor_id     uuid REFERENCES contractor(id) ON DELETE SET NULL,
  raised_by         uuid REFERENCES app_user(id),
  raised_on         date NOT NULL,
  response_due      date,
  status            text NOT NULL DEFAULT 'open',
  disposition       text,
  disposition_note  text,
  proposed_by       uuid REFERENCES app_user(id),
  approved_by       uuid REFERENCES app_user(id),
  approved_on       date,
  root_cause        text,
  corrective_action text,
  implemented_by    uuid REFERENCES app_user(id),
  implemented_on    date,
  implement_note    text,
  closed_by         uuid REFERENCES app_user(id),
  closed_on         date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, ncr_no)
);
ALTER TABLE ncr ADD CONSTRAINT ncr_severity_known CHECK (severity IN ('major', 'minor'));
ALTER TABLE ncr ADD CONSTRAINT ncr_status_known CHECK (status IN ('open', 'proposed', 'approved', 'implemented', 'closed'));
ALTER TABLE ncr ADD CONSTRAINT ncr_disposition_known CHECK (
  disposition IS NULL OR disposition IN ('use_as_is', 'repair', 'rework', 'reject'));
ALTER TABLE ncr ADD CONSTRAINT ncr_approver_not_proposer CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM proposed_by);
ALTER TABLE ncr ADD CONSTRAINT ncr_closer_not_implementer CHECK (closed_by IS NULL OR closed_by IS DISTINCT FROM implemented_by);
ALTER TABLE ncr ADD CONSTRAINT ncr_closed_with_cause CHECK (
  status <> 'closed' OR (root_cause IS NOT NULL AND corrective_action IS NOT NULL));

CREATE TABLE ncr_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  ncr_id      uuid NOT NULL REFERENCES ncr(id) ON DELETE CASCADE,
  event       text NOT NULL,
  note        text,
  by_user     uuid REFERENCES app_user(id),
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['punch_item', 'punch_event', 'ncr', 'ncr_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON punch_event, ncr_event FROM app_rw;
GRANT SELECT, INSERT ON punch_event, ncr_event TO app_rw;
-- A punch item or NCR is closed, not deleted.
REVOKE DELETE, TRUNCATE ON punch_item, ncr FROM app_rw;
GRANT SELECT ON punch_item, punch_event, ncr, ncr_event TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_punch WITH (security_invoker = true) AS
SELECT p.id AS punch_key, p.project_id AS project_key, p.punch_no, p.subsystem_id AS subsystem_key,
       p.tag_id AS tag_key, p.discipline, p.category, p.status, p.action_contractor_id AS contractor_key,
       p.raised_on, p.due_on, p.cleared_on, p.closed_on,
       (p.status <> 'closed' AND p.category = 'A') AS blocks_mc,
       (p.status <> 'closed' AND p.category IN ('A', 'B')) AS blocks_rfsu
  FROM punch_item p;

CREATE VIEW reporting.fact_ncr WITH (security_invoker = true) AS
SELECT n.id AS ncr_key, n.project_id AS project_key, n.ncr_no, n.severity, n.status, n.disposition,
       n.discipline, n.subsystem_id AS subsystem_key, n.tag_id AS tag_key, n.contractor_id AS contractor_key,
       n.raised_on, n.response_due, n.closed_on,
       (n.status <> 'closed') AS is_open,
       (n.closed_on - n.raised_on) AS days_to_close
  FROM ncr n;

GRANT SELECT ON reporting.fact_punch, reporting.fact_ncr TO app_rw, app_report;
