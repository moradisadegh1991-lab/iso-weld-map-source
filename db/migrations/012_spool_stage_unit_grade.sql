-- ─────────────────────────────────────────────────────────────────────────
-- One spool status instead of two; grade elevation per unit.
-- ─────────────────────────────────────────────────────────────────────────

-- ── the spool's stage, derived ───────────────────────────────────────────
--
-- `spool.fab_status` (migration 002) was set freely, one value at a time,
-- by whoever called the endpoint. Migration 011 added the governed chain
-- beside it, and two statuses for one spool is how a report says
-- "fabricated" while the chain says "released". This makes the chain the
-- only source and derives the headline from it.
--
-- The ONE question that depends on it most is in the revision diff: does
-- steel already exist for this spool? That decides whether a revision is a
-- free paper change or cut-and-reweld. So `built` is its own column, and it
-- is deliberately generous: ANY weld made on the spool, or any physical step
-- recorded (done or under way). A spool half-welded with nothing ticked is
-- built — missing it would drop real rework off the warning list, which is
-- the dangerous direction to be wrong in.
--
-- `stage` is the furthest step actually done, in chain order. A step that
-- does not apply (no shop welds on a single straight length) is NOT counted
-- as progress: "not applicable" is not "done".
--
-- The chain itself lives in lib/platform/precedence.mjs; this CASE mirrors
-- its order. db/test/execution.mjs checks the two agree on real spools.
--
-- Reads `weld` directly rather than reporting.fact_weld, so a spool from a
-- superseded run keeps its history — which is exactly the run the revision
-- diff is asking about.

CREATE VIEW reporting.spool_stage WITH (security_invoker = true) AS
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
           WHEN a.painted  THEN 'painted'
           WHEN a.tested   THEN 'test'
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
)
SELECT s.id AS spool_key, s.project_id AS project_key, s.line_id AS line_key,
       s.extraction_run_id AS run_key, s.spool_no, s.stage,
       -- For sorting in a report: position in the chain, 0 = still on paper.
       array_position(ARRAY['planned','released','fit_up','shop_weld','shop_ndt',
                            'erected','field_weld','supports','test','painted','ready'],
                      s.stage) - 1 AS stage_seq,
       s.built
  FROM s;

-- ── carry the old statuses over before dropping them ─────────────────────
--
-- Someone may have recorded a status through the old endpoint. That is
-- evidence, and a migration that drops it silently is a migration that
-- loses a site record. Each old value becomes the chain activities it
-- implies, dated when it was recorded, attributed to whoever recorded it,
-- and noted as carried over so nobody mistakes it for a fresh entry.
--
--   released                           → released
--   fabricated, tested, shipped        → released + fit_up (steel exists)
--   painted                            → … + painted
--   erected                            → … + erected
--
-- "fabricated" does NOT become welds: there is no welder, no WPS and no date
-- per joint to make a weld record from, and inventing them would be worse
-- than the downgrade. fit_up is enough to keep the spool `built`, which is
-- the property the revision diff depends on.

-- Both tables FORCE row level security, and outside a project scope the
-- policy sees no project. Run by an owner that is not a superuser, the
-- SELECT below would see zero rows and carry nothing over — silently. So the
-- force is lifted for exactly this statement and restored after it.
ALTER TABLE spool NO FORCE ROW LEVEL SECURITY;
ALTER TABLE spool_activity NO FORCE ROW LEVEL SECURITY;

INSERT INTO spool_activity (project_id, spool_id, code, status, done_at, note, recorded_by)
SELECT sp.project_id, sp.id, x.code, 'done',
       COALESCE(sp.fab_status_at::date, CURRENT_DATE),
       'منتقل‌شده از وضعیت قدیمی fab_status=' || sp.fab_status::text,
       sp.fab_status_by
  FROM spool sp
  CROSS JOIN LATERAL (VALUES
    ('released', sp.fab_status IN ('released','fabricated','tested','painted','shipped','erected')),
    ('fit_up',   sp.fab_status IN ('fabricated','tested','painted','shipped','erected')),
    ('painted',  sp.fab_status = 'painted'),
    ('erected',  sp.fab_status = 'erected')
  ) AS x(code, applies)
 WHERE x.applies
ON CONFLICT (project_id, spool_id, code) DO NOTHING;

ALTER TABLE spool FORCE ROW LEVEL SECURITY;
ALTER TABLE spool_activity FORCE ROW LEVEL SECURITY;

-- ── retire the free-set column ───────────────────────────────────────────

DROP VIEW reporting.kpi_spool_status;
DROP VIEW reporting.dim_spool;

DROP INDEX IF EXISTS spool_fab_idx;
ALTER TABLE spool
  DROP COLUMN fab_status,
  DROP COLUMN fab_status_at,
  DROP COLUMN fab_status_by,
  DROP COLUMN fab_note;
DROP TYPE fabrication_status;

CREATE VIEW reporting.dim_spool WITH (security_invoker = true) AS
SELECT s.id AS spool_key, s.project_id AS project_key, s.line_id AS line_key,
       s.spool_no, s.length_mm, s.nps_max,
       st.stage, st.stage_seq, st.built
  FROM spool s
  JOIN reporting.current_run cr ON cr.run_id = s.extraction_run_id
  JOIN reporting.spool_stage st ON st.spool_key = s.id;

CREATE VIEW reporting.kpi_spool_status WITH (security_invoker = true) AS
SELECT s.project_key, s.line_key, s.stage, s.stage_seq,
       COUNT(*)         AS spools,
       SUM(s.length_mm) AS length_mm
  FROM reporting.dim_spool s
 GROUP BY s.project_key, s.line_key, s.stage, s.stage_seq;

GRANT SELECT ON reporting.spool_stage, reporting.dim_spool, reporting.kpi_spool_status
  TO app_rw, app_report;

-- ── grade elevation per unit ─────────────────────────────────────────────
--
-- One grade for the whole project is right for a flat site and wrong for a
-- terraced one: an olefin complex on the Asalouyeh coast can have a process
-- area, a tank farm and a flare area on different platforms. A unit may
-- override the project grade; a weld takes its line's unit, then its
-- drawing's unit, then the project — the most specific statement wins.
--
-- The grade actually applied is reported beside every verdict, so a buried
-- count can always be traced to the number that produced it.

ALTER TABLE unit ADD COLUMN grade_elevation_mm numeric(12,1);

CREATE OR REPLACE VIEW reporting.fact_weld WITH (security_invoker = true) AS
SELECT w.weld_uid,
       w.project_id  AS project_key,
       w.line_id     AS line_key,
       w.document_id AS document_key,
       w.spool_id    AS spool_key,
       e.welder_id   AS welder_key,
       w.weld_no, w.weld_kind, w.shop_field, w.joint_role,
       w.nps, w.elevation_mm, w.ndt_requirement,
       (w.shop_field = 'Field')          AS is_field_weld,
       (e.weld_uid IS NOT NULL)          AS is_welded,
       e.welded_at,
       e.process,
       (e.pwht_report_no IS NOT NULL)    AS pwht_done,
       (n.first_result IS NOT NULL)      AS is_examined,
       n.first_result                    AS ndt_first_result,
       COALESCE(n.shots, 0)              AS ndt_shots,
       (e.weld_uid IS NOT NULL AND n.first_result IS NULL) AS awaiting_ndt,
       w.pos_el,
       (w.pos_el < g.grade)              AS is_buried,
       (w.pos_el - g.grade)              AS height_above_grade_mm,
       g.grade                           AS grade_applied_mm
  FROM weld w
  JOIN reporting.current_run cr ON cr.run_id = w.extraction_run_id
  JOIN project p ON p.id = w.project_id
  LEFT JOIN line     l  ON l.id  = w.line_id
  LEFT JOIN unit     ul ON ul.id = l.unit_id
  LEFT JOIN document d  ON d.id  = w.document_id
  LEFT JOIN unit     ud ON ud.id = d.unit_id
  CROSS JOIN LATERAL (
        SELECT COALESCE(ul.grade_elevation_mm, ud.grade_elevation_mm, p.grade_elevation_mm) AS grade
       ) g
  LEFT JOIN weld_execution e
         ON e.weld_uid = w.weld_uid AND e.project_id = w.project_id
  LEFT JOIN LATERAL (
        SELECT COUNT(*) AS shots,
               MAX(r.result::text) FILTER (WHERE r.repair_cycle = 0) AS first_result
          FROM ndt_record r
         WHERE r.weld_uid = w.weld_uid AND r.project_id = w.project_id
       ) n ON true;

CREATE OR REPLACE VIEW reporting.kpi_buried_exposure WITH (security_invoker = true) AS
SELECT f.project_key, f.line_key, l.line_no,
       COUNT(*)                                        AS welds,
       COUNT(*) FILTER (WHERE f.is_buried)             AS buried,
       COUNT(*) FILTER (WHERE f.is_buried = false)     AS above_ground,
       COUNT(*) FILTER (WHERE f.is_buried IS NULL)     AS unknown,
       MIN(f.height_above_grade_mm)                    AS deepest_mm,
       MIN(f.grade_applied_mm)                         AS grade_min_mm,
       MAX(f.grade_applied_mm)                         AS grade_max_mm
  FROM reporting.fact_weld f
  LEFT JOIN line l ON l.id = f.line_key
 GROUP BY f.project_key, f.line_key, l.line_no;
