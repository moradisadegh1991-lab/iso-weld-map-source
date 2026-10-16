-- ─────────────────────────────────────────────────────────────────────────
-- Commissioning after pre-commissioning: RFC as its own certificate, the
-- commissioning procedures between RFC and RFSU, and the performance test
-- against the contract's guarantees.
--
--   MC → pre-commissioning checklists → RFC → commissioning procedures
--      → RFSU → start-up → performance test
--
-- Until now RFSU was signed straight after the pre-commissioning checklists;
-- it certified what RFC certifies. The rules are lib/completions/precom.mjs
-- and lib/completions/performance.mjs.
-- ─────────────────────────────────────────────────────────────────────────

-- A checklist belongs to one phase. Every one declared so far was a
-- pre-commissioning checklist.
ALTER TABLE precom_template ADD COLUMN phase text NOT NULL DEFAULT 'precom';
ALTER TABLE precom_template ADD CONSTRAINT precom_phase_known CHECK (phase IN ('precom', 'commissioning'));

CREATE TABLE rfc_certificate (
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
ALTER TABLE rfc_certificate ADD CONSTRAINT rfc_acceptor_not_signer CHECK (accepted_by IS NULL OR accepted_by IS DISTINCT FROM signed_by);

-- An RFSU signed before RFC existed certified exactly what RFC certifies
-- (MC, every pre-commissioning checklist, no punch A, no NCR). It is carried
-- forward as that subsystem's RFC — same signer, same dates, labelled — not
-- re-signed by anyone. rfsu_certificate FORCEs row level security, so the
-- force is lifted for this one read (as 012 does), and rfc_certificate gets
-- its policy only after the rows are in.
ALTER TABLE rfsu_certificate NO FORCE ROW LEVEL SECURITY;
INSERT INTO rfc_certificate (project_id, subsystem_id, snapshot, signed_by, signed_at, accepted_by, accepted_at)
SELECT project_id, subsystem_id,
       jsonb_build_object('carriedFrom', 'rfsu', 'rfsuId', id,
         'note', 'RFSU signed before RFC was a separate certificate (migration 048)', 'checks', snapshot -> 'checks'),
       signed_by, signed_at, accepted_by, accepted_at
  FROM rfsu_certificate;
ALTER TABLE rfsu_certificate FORCE ROW LEVEL SECURITY;

-- ── performance test ─────────────────────────────────────────────────────

-- What the contract guarantees, clause by clause. A guarantee with a unit
-- is that unit's; one without is the plant's.
CREATE TABLE performance_guarantee (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code             text NOT NULL,
  parameter        text NOT NULL,
  unit_id          uuid REFERENCES unit(id) ON DELETE RESTRICT,
  uom              text NOT NULL,
  direction        text NOT NULL,            -- min: at least the value · max: at most
  guaranteed_value numeric NOT NULL,
  min_duration_h   numeric,                  -- only when the contract states one
  basis            text NOT NULL,            -- the contract clause
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
ALTER TABLE performance_guarantee ADD CONSTRAINT guarantee_direction_known CHECK (direction IN ('min', 'max'));
ALTER TABLE performance_guarantee ADD CONSTRAINT guarantee_duration_positive CHECK (min_duration_h IS NULL OR min_duration_h > 0);

CREATE TABLE performance_test (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  test_no      text NOT NULL,
  unit_id      uuid REFERENCES unit(id) ON DELETE RESTRICT,   -- NULL: the plant
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz NOT NULL,
  note         text,
  recorded_by  uuid REFERENCES app_user(id),
  signed_by    uuid REFERENCES app_user(id),
  signed_at    timestamptz,
  accepted_by  uuid REFERENCES app_user(id),
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, test_no)
);
ALTER TABLE performance_test ADD CONSTRAINT performance_test_window CHECK (ended_at > started_at);
ALTER TABLE performance_test ADD CONSTRAINT performance_test_accept_after_sign CHECK (
  accepted_by IS NULL OR (signed_by IS NOT NULL AND accepted_by IS DISTINCT FROM signed_by));

CREATE TABLE performance_result (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  test_id       uuid NOT NULL REFERENCES performance_test(id) ON DELETE CASCADE,
  guarantee_id  uuid NOT NULL REFERENCES performance_guarantee(id) ON DELETE RESTRICT,
  measured      numeric NOT NULL,
  method        text,                         -- meter / lab sample / calculation reference
  UNIQUE (test_id, guarantee_id)
);

-- A signed test is what was measured: its results no longer change.
CREATE FUNCTION performance_result_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s timestamptz; found boolean;
BEGIN
  SELECT signed_at, true INTO s, found FROM performance_test WHERE id = COALESCE(NEW.test_id, OLD.test_id);
  IF found AND s IS NOT NULL THEN
    RAISE EXCEPTION 'performance test is signed; its results are fixed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER performance_result_fixed BEFORE INSERT OR UPDATE OR DELETE ON performance_result
  FOR EACH ROW EXECUTE FUNCTION performance_result_fixed();

-- A guarantee a result was judged against keeps its terms.
CREATE FUNCTION performance_guarantee_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.direction, NEW.guaranteed_value, NEW.uom, NEW.unit_id, NEW.min_duration_h)
       IS DISTINCT FROM (OLD.direction, OLD.guaranteed_value, OLD.uom, OLD.unit_id, OLD.min_duration_h)
     AND EXISTS (SELECT 1 FROM performance_result r WHERE r.guarantee_id = OLD.id) THEN
    RAISE EXCEPTION 'guarantee % has test results; its terms are fixed', OLD.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER performance_guarantee_fixed BEFORE UPDATE ON performance_guarantee
  FOR EACH ROW EXECUTE FUNCTION performance_guarantee_fixed();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rfc_certificate', 'performance_guarantee', 'performance_test', 'performance_result'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;

-- Certificates as RFSU's: never deleted, only accepted afterwards.
REVOKE DELETE, TRUNCATE, UPDATE ON rfc_certificate FROM app_rw;
GRANT UPDATE (accepted_by, accepted_at) ON rfc_certificate TO app_rw;
REVOKE DELETE, TRUNCATE ON performance_test, performance_guarantee FROM app_rw;

CREATE VIEW reporting.fact_rfc WITH (security_invoker = true) AS
SELECT r.project_id AS project_key, r.subsystem_id AS subsystem_key, r.signed_at, r.accepted_at,
       (r.accepted_by IS NOT NULL) AS is_accepted, (r.snapshot ? 'carriedFrom') AS is_carried_from_rfsu
  FROM rfc_certificate r;

CREATE VIEW reporting.fact_performance_result WITH (security_invoker = true) AS
SELECT r.id AS result_key, r.project_id AS project_key, t.test_no, t.unit_id AS unit_key, t.started_at, t.ended_at,
       (t.accepted_by IS NOT NULL) AS is_accepted, g.code AS guarantee_code, g.parameter, g.uom, g.direction,
       g.guaranteed_value, r.measured,
       CASE WHEN g.direction = 'min' THEN r.measured >= g.guaranteed_value ELSE r.measured <= g.guaranteed_value END AS value_met
  FROM performance_result r JOIN performance_test t ON t.id = r.test_id JOIN performance_guarantee g ON g.id = r.guarantee_id;

GRANT SELECT ON reporting.fact_rfc, reporting.fact_performance_result TO app_rw, app_report;
