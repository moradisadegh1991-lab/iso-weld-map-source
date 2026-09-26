-- ─────────────────────────────────────────────────────────────────────────
-- HSE, safe work before the permit: who is competent, whether the scaffold
-- or crane is fit to use today, and whether the job's hazards were assessed.
-- Rules are lib/hse/safework.mjs.
--
-- Each of these ends at the permit: a crew member without the competence
-- the project requires for that permit type, a scaffold or crane whose
-- inspection does not cover the whole permit window, or a missing/unapproved
-- JSA where the project requires one — the permit is not issued.
--
-- What the project has not decided is not decided here: the inspection
-- intervals, the highest residual risk it accepts, which competences each
-- permit type needs and which permit types need a JSA have no defaults.
-- NULL means "not stated"; for the two JSON settings an empty list is a
-- statement ("nothing required") and is different from NULL.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE project
  ADD COLUMN hse_scaffold_inspection_days integer,
  ADD COLUMN hse_crane_inspection_days    integer,
  ADD COLUMN hse_risk_max_residual        integer,
  ADD COLUMN hse_competence_rules         jsonb,   -- {"hot": ["induction", "hot_work"], ...}
  ADD COLUMN hse_jsa_required_types       jsonb;   -- ["hot", "confined_space", ...]
ALTER TABLE project ADD CONSTRAINT hse_safework_settings CHECK (
  COALESCE(hse_scaffold_inspection_days, 1) > 0 AND COALESCE(hse_crane_inspection_days, 1) > 0
  AND (hse_risk_max_residual IS NULL OR hse_risk_max_residual BETWEEN 1 AND 25)
  AND (hse_competence_rules IS NULL OR jsonb_typeof(hse_competence_rules) = 'object')
  AND (hse_jsa_required_types IS NULL OR jsonb_typeof(hse_jsa_required_types) = 'array'));

-- ── people and their competence ──────────────────────────────────────────

-- Workers on site are not platform users; they are who a permit names.
CREATE TABLE hse_person (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  id_no         text NOT NULL,             -- national / employee number: one person, one row
  full_name     text NOT NULL,
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  trade         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id_no)
);

CREATE TABLE hse_competence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  person_id      uuid NOT NULL REFERENCES hse_person(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  cert_no        text,
  issuer         text,
  issued_on      date NOT NULL,
  expires_on     date,
  no_expiry      boolean NOT NULL DEFAULT false,   -- stated on the card, not assumed
  revoked_on     date,
  revoked_reason text,
  recorded_by    uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hse_competence ADD CONSTRAINT competence_kind_known CHECK (kind IN (
  'induction', 'work_at_height', 'confined_space', 'confined_space_attendant', 'gas_tester', 'hot_work',
  'rigger', 'crane_operator', 'scaffolder', 'scaffold_inspector', 'lifting_inspector', 'electrical_isolation',
  'radiography', 'first_aid'));
ALTER TABLE hse_competence ADD CONSTRAINT competence_expiry_stated CHECK (NOT no_expiry OR expires_on IS NULL);
ALTER TABLE hse_competence ADD CONSTRAINT competence_dates CHECK (expires_on IS NULL OR expires_on >= issued_on);
ALTER TABLE hse_competence ADD CONSTRAINT competence_revoked_with_reason CHECK (
  revoked_on IS NULL OR (revoked_reason IS NOT NULL AND revoked_on >= issued_on));
CREATE INDEX hse_competence_person ON hse_competence (person_id, kind);

-- ── scaffolds and cranes ─────────────────────────────────────────────────

CREATE TABLE hse_equipment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  ref_no        text NOT NULL,             -- scaffold tag number / crane registration
  description   text,
  area          text,
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  capacity_t    numeric(8,2),              -- a crane's rated capacity, as registered
  dismantled_on date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, ref_no)
);
ALTER TABLE hse_equipment ADD CONSTRAINT equipment_kind_known CHECK (kind IN ('scaffold', 'crane'));

-- An inspection is a record of what the inspector found that day: append-only.
CREATE TABLE hse_equipment_inspection (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES hse_equipment(id) ON DELETE CASCADE,
  inspected_on date NOT NULL,
  result       text NOT NULL,
  inspector_id uuid NOT NULL REFERENCES hse_person(id),
  cert_ref     text,                       -- scaffold tag / thorough-examination report number
  findings     text,
  recorded_by  uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE hse_equipment_inspection ADD CONSTRAINT equipment_result_known CHECK (result IN ('pass', 'fail'));
ALTER TABLE hse_equipment_inspection ADD CONSTRAINT equipment_fail_says_why CHECK (result = 'pass' OR findings IS NOT NULL);
CREATE INDEX hse_equipment_inspection_eq ON hse_equipment_inspection (equipment_id, inspected_on);

-- ── JSA / TRA ────────────────────────────────────────────────────────────

CREATE TABLE hse_jsa (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  jsa_no        text NOT NULL,
  revision      text NOT NULL,
  title         text NOT NULL,
  area          text,
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'draft',
  prepared_by   uuid REFERENCES app_user(id),
  approved_by   uuid REFERENCES app_user(id),
  approved_on   date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, jsa_no, revision)
);
ALTER TABLE hse_jsa ADD CONSTRAINT jsa_status_known CHECK (status IN ('draft', 'approved', 'superseded'));
ALTER TABLE hse_jsa ADD CONSTRAINT jsa_approver_not_preparer CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM prepared_by);
ALTER TABLE hse_jsa ADD CONSTRAINT jsa_approved_signed CHECK (status = 'draft' OR (approved_by IS NOT NULL AND approved_on IS NOT NULL));
CREATE UNIQUE INDEX hse_jsa_one_approved ON hse_jsa (project_id, jsa_no) WHERE status = 'approved';

CREATE TABLE hse_jsa_step (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  jsa_id              uuid NOT NULL REFERENCES hse_jsa(id) ON DELETE CASCADE,
  seq                 integer NOT NULL,
  step                text NOT NULL,
  hazard              text NOT NULL,
  controls            text,
  likelihood          integer NOT NULL,
  severity            integer NOT NULL,
  residual_likelihood integer,
  residual_severity   integer,
  UNIQUE (jsa_id, seq)
);
ALTER TABLE hse_jsa_step ADD CONSTRAINT jsa_step_scale CHECK (
  likelihood BETWEEN 1 AND 5 AND severity BETWEEN 1 AND 5
  AND (residual_likelihood IS NULL OR residual_likelihood BETWEEN 1 AND 5)
  AND (residual_severity IS NULL OR residual_severity BETWEEN 1 AND 5));

-- An approved (or superseded) JSA is fixed, content and steps: a change is a
-- new revision. Status moves forward only. Same rule as itp_fixed (030).
CREATE FUNCTION hse_jsa_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  IF TG_TABLE_NAME = 'hse_jsa' THEN
    IF OLD.status <> 'draft' AND (NEW.jsa_no, NEW.revision, NEW.title, NEW.area, NEW.contractor_id, NEW.prepared_by,
                                  NEW.approved_by, NEW.approved_on)
         IS DISTINCT FROM (OLD.jsa_no, OLD.revision, OLD.title, OLD.area, OLD.contractor_id, OLD.prepared_by,
                           OLD.approved_by, OLD.approved_on) THEN
      RAISE EXCEPTION 'JSA % rev % is %; a change is a new revision', OLD.jsa_no, OLD.revision, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF (OLD.status, NEW.status) NOT IN (('draft','draft'), ('draft','approved'), ('approved','approved'), ('approved','superseded'), ('superseded','superseded')) THEN
      RAISE EXCEPTION 'JSA status cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO s FROM hse_jsa WHERE id = COALESCE(NEW.jsa_id, OLD.jsa_id);
  -- No parent row: a cascade from the JSA's own deletion, nothing left to protect.
  IF s IS NOT NULL AND s <> 'draft' THEN
    RAISE EXCEPTION 'JSA is %; its steps are fixed', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER hse_jsa_fixed BEFORE UPDATE ON hse_jsa FOR EACH ROW EXECUTE FUNCTION hse_jsa_fixed();
CREATE TRIGGER hse_jsa_step_fixed BEFORE INSERT OR UPDATE OR DELETE ON hse_jsa_step FOR EACH ROW EXECUTE FUNCTION hse_jsa_fixed();

-- ── what a permit names ──────────────────────────────────────────────────

ALTER TABLE hse_permit
  ADD COLUMN equipment_id uuid REFERENCES hse_equipment(id),
  ADD COLUMN jsa_id       uuid REFERENCES hse_jsa(id);

CREATE TABLE hse_permit_crew (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  permit_id  uuid NOT NULL REFERENCES hse_permit(id) ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES hse_person(id),
  UNIQUE (permit_id, person_id)
);

-- The crew a permit was checked against is the crew it was issued with:
-- nobody is added to or taken off a permit once it is no longer a request.
CREATE FUNCTION hse_permit_crew_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM hse_permit WHERE id = COALESCE(NEW.permit_id, OLD.permit_id);
  IF s IS NOT NULL AND s <> 'requested' THEN
    RAISE EXCEPTION 'permit is %; its crew is fixed', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER hse_permit_crew_fixed BEFORE INSERT OR UPDATE OR DELETE ON hse_permit_crew
  FOR EACH ROW EXECUTE FUNCTION hse_permit_crew_fixed();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hse_person', 'hse_competence', 'hse_equipment', 'hse_equipment_inspection',
                           'hse_jsa', 'hse_jsa_step', 'hse_permit_crew'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- An inspection is what was found; a card is corrected by revoking it.
REVOKE UPDATE, DELETE, TRUNCATE ON hse_equipment_inspection FROM app_rw;
GRANT SELECT, INSERT ON hse_equipment_inspection TO app_rw;
REVOKE DELETE, TRUNCATE ON hse_competence FROM app_rw;
GRANT SELECT ON hse_person, hse_competence, hse_equipment, hse_equipment_inspection, hse_jsa, hse_jsa_step,
               hse_permit_crew TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_hse_competence WITH (security_invoker = true) AS
SELECT c.id AS competence_key, c.project_id AS project_key, c.person_id AS person_key, p.full_name, p.id_no,
       p.contractor_id AS contractor_key, c.kind, c.issued_on, c.expires_on, c.no_expiry, c.revoked_on
  FROM hse_competence c JOIN hse_person p ON p.id = c.person_id;

CREATE VIEW reporting.fact_hse_equipment_inspection WITH (security_invoker = true) AS
SELECT i.id AS inspection_key, i.project_id AS project_key, e.id AS equipment_key, e.kind, e.ref_no, e.area,
       i.inspected_on, i.result, i.inspector_id AS inspector_key
  FROM hse_equipment_inspection i JOIN hse_equipment e ON e.id = i.equipment_id;

GRANT SELECT ON reporting.fact_hse_competence, reporting.fact_hse_equipment_inspection TO app_rw, app_report;
