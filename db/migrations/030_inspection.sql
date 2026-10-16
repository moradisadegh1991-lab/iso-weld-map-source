-- ─────────────────────────────────────────────────────────────────────────
-- Inspection: the Inspection & Test Plan, and the inspection requests (IR)
-- made against it.
--
-- The rules are lib/inspection/itp.mjs. Here: the records, and three rules
-- the database holds as well, because they are the ones a hurried script
-- would break:
--   · an approved ITP revision does not change — not its header, not one
--     of its activities; a change is a new revision;
--   · the one who prepared an ITP does not approve it;
--   · an inspection result is a signature: added, never rewritten.
-- An IR's state (awaiting / released / rejected) is not stored; it is read
-- from its results every time.
-- ─────────────────────────────────────────────────────────────────────────

-- Hours of notice an inspecting party is owed before an inspection.
-- Project policy (usually the ITP's own general notes); no default.
ALTER TABLE project ADD COLUMN inspection_notice_hours integer;
ALTER TABLE project ADD CONSTRAINT inspection_notice_positive CHECK (inspection_notice_hours IS NULL OR inspection_notice_hours > 0);

-- The party a member signs inspections for. A member with none signs none.
ALTER TABLE project_member ADD COLUMN inspection_party text;
ALTER TABLE project_member ADD CONSTRAINT inspection_party_known CHECK (
  inspection_party IS NULL OR inspection_party IN ('contractor', 'company', 'tpi'));

CREATE TABLE itp (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  itp_no       text NOT NULL,
  revision     text NOT NULL,
  title        text NOT NULL,
  scope        text NOT NULL,
  status       text NOT NULL DEFAULT 'draft',
  prepared_by  uuid REFERENCES app_user(id),
  approved_by  uuid REFERENCES app_user(id),
  approved_on  date,
  superseded_on date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, itp_no, revision)
);
ALTER TABLE itp ADD CONSTRAINT itp_scope_known CHECK (
  scope IN ('foundation', 'structure', 'rotating', 'static', 'fired', 'piping_spool', 'cable', 'instrument', 'coating'));
ALTER TABLE itp ADD CONSTRAINT itp_status_known CHECK (status IN ('draft', 'approved', 'superseded'));
ALTER TABLE itp ADD CONSTRAINT itp_approver_not_preparer CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM prepared_by);
ALTER TABLE itp ADD CONSTRAINT itp_approved_signed CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_on IS NOT NULL));
-- One revision of an ITP in force at a time.
CREATE UNIQUE INDEX itp_one_approved ON itp (project_id, itp_no) WHERE status = 'approved';

CREATE TABLE itp_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  itp_id      uuid NOT NULL REFERENCES itp(id) ON DELETE CASCADE,
  seq         integer NOT NULL,
  title       text NOT NULL,
  step_code   text,                 -- the chain step it gates, if any
  reference   text,                 -- spec / code clause
  criteria    text,                 -- acceptance criterion
  record      text,                 -- verifying document (ITR / form)
  contractor  char(1),
  company     char(1),
  tpi         char(1),
  UNIQUE (itp_id, seq)
);
ALTER TABLE itp_activity ADD CONSTRAINT itp_activity_points CHECK (
  (contractor IS NULL OR contractor IN ('H', 'W', 'R', 'S')) AND
  (company IS NULL OR company IN ('H', 'W', 'R', 'S')) AND
  (tpi IS NULL OR tpi IN ('H', 'W', 'R', 'S')));
ALTER TABLE itp_activity ADD CONSTRAINT itp_activity_has_point CHECK (
  contractor IS NOT NULL OR company IS NOT NULL OR tpi IS NOT NULL);
CREATE INDEX itp_activity_step ON itp_activity (project_id, step_code);

-- An approved (or superseded) ITP is fixed: its activities and its content.
-- Status moves forward only: draft → approved → superseded.
CREATE FUNCTION itp_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF TG_TABLE_NAME = 'itp' THEN
    IF OLD.status <> 'draft' AND (NEW.itp_no, NEW.revision, NEW.title, NEW.scope, NEW.prepared_by, NEW.approved_by, NEW.approved_on)
         IS DISTINCT FROM (OLD.itp_no, OLD.revision, OLD.title, OLD.scope, OLD.prepared_by, OLD.approved_by, OLD.approved_on) THEN
      RAISE EXCEPTION 'itp % rev % is %; a change is a new revision', OLD.itp_no, OLD.revision, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF (OLD.status, NEW.status) NOT IN (('draft','draft'), ('draft','approved'), ('approved','approved'), ('approved','superseded'), ('superseded','superseded')) THEN
      RAISE EXCEPTION 'itp status cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO s FROM itp WHERE id = COALESCE(NEW.itp_id, OLD.itp_id);
  IF s IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'itp is %; its activities are fixed', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER itp_fixed BEFORE UPDATE ON itp FOR EACH ROW EXECUTE FUNCTION itp_fixed();
CREATE TRIGGER itp_activity_fixed BEFORE INSERT OR UPDATE OR DELETE ON itp_activity FOR EACH ROW EXECUTE FUNCTION itp_fixed();

CREATE TABLE inspection_request (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  ir_no             text NOT NULL,
  activity_id       uuid NOT NULL REFERENCES itp_activity(id) ON DELETE RESTRICT,
  item_kind         text NOT NULL,
  item_id           uuid NOT NULL,
  subsystem_id      uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  location          text,
  note              text,
  planned_at        timestamptz NOT NULL,
  raised_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  raised_by         uuid REFERENCES app_user(id),
  reinspection_of   uuid REFERENCES inspection_request(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES app_user(id),
  cancel_reason     text,
  ncr_id            uuid REFERENCES ncr(id) ON DELETE SET NULL,
  UNIQUE (project_id, ir_no)
);
ALTER TABLE inspection_request ADD CONSTRAINT ir_item_kind_known CHECK (item_kind IN ('tag', 'spool', 'cable', 'instrument', 'coating_item'));
ALTER TABLE inspection_request ADD CONSTRAINT ir_cancel_has_reason CHECK (cancelled_at IS NULL OR cancel_reason IS NOT NULL);
CREATE INDEX inspection_request_item ON inspection_request (project_id, item_kind, item_id, activity_id);
CREATE INDEX inspection_request_planned ON inspection_request (project_id, planned_at);

CREATE TABLE inspection_result (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  ir_id           uuid NOT NULL REFERENCES inspection_request(id) ON DELETE CASCADE,
  party           text NOT NULL,
  outcome         text NOT NULL,
  inspector_name  text,
  comments        text,
  by_user         uuid REFERENCES app_user(id),
  recorded_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (ir_id, party)
);
ALTER TABLE inspection_result ADD CONSTRAINT inspection_result_party CHECK (party IN ('contractor', 'company', 'tpi'));
ALTER TABLE inspection_result ADD CONSTRAINT inspection_result_outcome CHECK (outcome IN ('accepted', 'accepted_comments', 'rejected', 'not_attended'));
ALTER TABLE inspection_result ADD CONSTRAINT inspection_result_rejection_says_why CHECK (outcome <> 'rejected' OR comments IS NOT NULL);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['itp', 'itp_activity', 'inspection_request', 'inspection_result'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;

-- A signature is added, never changed or taken back.
REVOKE UPDATE, DELETE, TRUNCATE ON inspection_result FROM app_rw;
