-- ─────────────────────────────────────────────────────────────────────────
-- Completions: piping test packages, their tests, and the mechanical
-- completion certificate of a subsystem.
--
-- The rules (B31.3 test pressure, readiness to test, the verdict, MC
-- readiness) are lib/completions/completions.mjs. A test record is
-- evidence and is never edited; its acceptance is the one field set later.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE test_package (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  pack_no       text NOT NULL,
  subsystem_id  uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  medium        text NOT NULL,
  -- ST/S at test and design temperature: engineering input, no default.
  stress_ratio  numeric(6,3),
  description   text,
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, pack_no)
);
ALTER TABLE test_package ADD CONSTRAINT test_medium_known CHECK (medium IN ('hydrostatic', 'pneumatic'));
ALTER TABLE test_package ADD CONSTRAINT stress_ratio_range CHECK (stress_ratio IS NULL OR (stress_ratio > 0 AND stress_ratio <= 6.5));

-- A line is tested in one package.
CREATE TABLE test_package_line (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  package_id  uuid NOT NULL REFERENCES test_package(id) ON DELETE CASCADE,
  line_id     uuid NOT NULL REFERENCES line(id) ON DELETE CASCADE,
  UNIQUE (project_id, line_id)
);

CREATE TABLE test_record (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  package_id     uuid NOT NULL REFERENCES test_package(id) ON DELETE CASCADE,
  tested_on      date NOT NULL,
  medium         text NOT NULL,
  required_barg  numeric(9,3),               -- as computed when the test was recorded
  basis          text,
  achieved_barg  numeric(9,3),
  hold_min       numeric(7,1),
  gauge_cert     text,
  leaks          boolean,
  witness        text,                       -- client / TPI inspector, by name
  verdict        text NOT NULL,
  reasons        jsonb NOT NULL DEFAULT '[]'::jsonb,
  recorded_by    uuid REFERENCES app_user(id),
  accepted_by    uuid REFERENCES app_user(id),
  accepted_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE test_record ADD CONSTRAINT test_verdict_known CHECK (verdict IN ('pass', 'fail'));
ALTER TABLE test_record ADD CONSTRAINT test_accepted_is_pass CHECK (accepted_by IS NULL OR verdict = 'pass');
ALTER TABLE test_record ADD CONSTRAINT test_acceptor_not_recorder CHECK (accepted_by IS NULL OR accepted_by IS DISTINCT FROM recorded_by);

CREATE TABLE mc_certificate (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  subsystem_id  uuid NOT NULL REFERENCES subsystem(id) ON DELETE CASCADE,
  snapshot      jsonb NOT NULL,              -- what the readiness was at the signature
  signed_by     uuid NOT NULL REFERENCES app_user(id),
  signed_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_by   uuid REFERENCES app_user(id),
  accepted_at   timestamptz,
  UNIQUE (project_id, subsystem_id)
);
ALTER TABLE mc_certificate ADD CONSTRAINT mc_acceptor_not_signer CHECK (accepted_by IS NULL OR accepted_by IS DISTINCT FROM signed_by);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['test_package', 'test_package_line', 'test_record', 'mc_certificate'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- Evidence: a test record or a certificate is never deleted, and of a test
-- record only the acceptance may be set afterwards.
REVOKE DELETE, TRUNCATE ON test_record, mc_certificate FROM app_rw;
REVOKE UPDATE ON test_record FROM app_rw;
GRANT UPDATE (accepted_by, accepted_at) ON test_record TO app_rw;
REVOKE UPDATE ON mc_certificate FROM app_rw;
GRANT UPDATE (accepted_by, accepted_at) ON mc_certificate TO app_rw;
GRANT SELECT ON test_package, test_package_line, test_record, mc_certificate TO app_report;

-- ── the spool's test step, from its package ──────────────────────────────
CREATE OR REPLACE VIEW reporting.spool_stage WITH (security_invoker = true) AS
WITH w AS (
  SELECT wd.spool_id,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Shop')                                   AS shop_n,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Shop' AND e.weld_uid IS NOT NULL)        AS shop_welded,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Shop' AND n.first_result IS NOT NULL)    AS shop_examined,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Field')                                  AS field_n,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Field' AND e.weld_uid IS NOT NULL
                                                        AND n.first_result IS NOT NULL)   AS field_done,
         COUNT(*) FILTER (WHERE e.weld_uid IS NOT NULL)                                   AS any_welded
    FROM weld wd
    LEFT JOIN weld_execution e ON e.weld_uid = wd.weld_uid AND e.project_id = wd.project_id
    LEFT JOIN LATERAL (
          SELECT MAX(r.result::text) FILTER (WHERE r.repair_cycle = 0) AS first_result
            FROM ndt_record r
           WHERE r.weld_uid = wd.weld_uid AND r.project_id = wd.project_id
         ) n ON true
   WHERE wd.spool_id IS NOT NULL
   GROUP BY wd.spool_id
),
-- The coating module's sign-off: `ready` on the spool's coating item is
-- refused while any coating step is open, so it stands for "painted (and
-- insulated, where required) and accepted".
-- Once a spool HAS a coating item, only that sign-off counts: a "painted"
-- ticked by hand before the item existed is ignored, as the engine ignores it.
c AS (
  SELECT ci.spool_id,
         EXISTS (SELECT 1 FROM coating_activity ca WHERE ca.item_id = ci.id
                   AND ca.code = 'ready' AND ca.status = 'done') AS coated
    FROM coating_item ci
   WHERE ci.spool_id IS NOT NULL
),
-- The test package's accepted pass answers the spool's test step, once
-- the spool's line is in a package: a hand-ticked "test" beside it is
-- ignored, as the engine ignores it (lib/db/repos/piping-execution.mjs).
tp AS (
  SELECT tl.line_id,
         EXISTS (SELECT 1 FROM test_record r WHERE r.package_id = tl.package_id
                   AND r.verdict = 'pass' AND r.accepted_by IS NOT NULL) AS passed
    FROM test_package_line tl
),
a AS (
  SELECT spool_id,
         bool_or(code = 'released' AND status = 'done') AS released,
         bool_or(code = 'fit_up'   AND status = 'done') AS fit_up,
         bool_or(code = 'erected'  AND status = 'done') AS erected,
         bool_or(code = 'supports' AND status = 'done') AS supports,
         bool_or(code = 'test'     AND status = 'done') AS tested,
         bool_or(code = 'painted'  AND status = 'done') AS painted,
         bool_or(code = 'ready'    AND status = 'done') AS ready,
         -- Anything past release, done or under way, means steel exists.
         bool_or(code <> 'released')                    AS physical
    FROM spool_activity
   GROUP BY spool_id
),
s AS (
  SELECT sp.id, sp.project_id, sp.line_id, sp.extraction_run_id, sp.spool_no,
         CASE
           WHEN a.ready    THEN 'ready'
           WHEN CASE WHEN c.spool_id IS NOT NULL THEN c.coated ELSE a.painted END THEN 'painted'
           WHEN CASE WHEN tp.line_id IS NOT NULL THEN tp.passed ELSE a.tested END THEN 'test'
           WHEN a.supports THEN 'supports'
           WHEN w.field_n > 0 AND w.field_done = w.field_n     THEN 'field_weld'
           WHEN a.erected  THEN 'erected'
           WHEN w.shop_n > 0 AND w.shop_examined = w.shop_n    THEN 'shop_ndt'
           WHEN w.shop_n > 0 AND w.shop_welded = w.shop_n      THEN 'shop_weld'
           WHEN a.fit_up   THEN 'fit_up'
           WHEN a.released THEN 'released'
           ELSE 'planned'
         END AS stage,
         (COALESCE(w.any_welded, 0) > 0 OR COALESCE(a.physical, false)) AS built
    FROM spool sp
    LEFT JOIN w ON w.spool_id = sp.id
    LEFT JOIN a ON a.spool_id = sp.id
    LEFT JOIN c ON c.spool_id = sp.id
    LEFT JOIN tp ON tp.line_id = sp.line_id
)
SELECT s.id AS spool_key, s.project_id AS project_key, s.line_id AS line_key,
       s.extraction_run_id AS run_key, s.spool_no, s.stage,
       -- For sorting in a report: position in the chain, 0 = still on paper.
       array_position(ARRAY['planned','released','fit_up','shop_weld','shop_ndt',
                            'erected','field_weld','supports','test','painted','ready'],
                      s.stage) - 1 AS stage_seq,
       s.built
  FROM s;
-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_test_package WITH (security_invoker = true) AS
SELECT p.id AS package_key, p.project_id AS project_key, p.pack_no, p.subsystem_id AS subsystem_key, p.medium,
       (SELECT count(*) FROM test_package_line l WHERE l.package_id = p.id) AS lines,
       EXISTS (SELECT 1 FROM test_record r WHERE r.package_id = p.id AND r.verdict = 'pass' AND r.accepted_by IS NOT NULL) AS is_accepted,
       (SELECT max(r.tested_on) FROM test_record r WHERE r.package_id = p.id) AS last_tested_on
  FROM test_package p;

CREATE VIEW reporting.fact_mc WITH (security_invoker = true) AS
SELECT m.project_id AS project_key, m.subsystem_id AS subsystem_key, m.signed_at, m.accepted_at,
       (m.accepted_by IS NOT NULL) AS is_accepted
  FROM mc_certificate m;

GRANT SELECT ON reporting.fact_test_package, reporting.fact_mc TO app_rw, app_report;
