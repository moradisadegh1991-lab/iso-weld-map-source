-- ─────────────────────────────────────────────────────────────────────────
-- Examined is not accepted (review finding F11).
--
-- fact_weld.is_examined is true once a weld has any first NDT record —
-- pending and rejected included. That is right for "how much has been
-- shot" and wrong for "has it passed": the spool's derived shop-NDT step,
-- field welding before the pressure test, and spool_stage all read it, so
-- a spool with a rejected film reported its shop NDT done.
--
-- is_accepted: the weld has at least one NDT record, and for EVERY method
-- recorded on it the record at that method's latest repair cycle is
-- `accept`. Repair cycles are counted per method (lib/db/repos/execution.mjs),
-- so "the latest cycle" is per method too: RT passed at its second cycle
-- does not hide PT rejected at its first.
--
-- Whether the methods recorded are the ones the weld REQUIRES is a separate
-- question (the NDT selection module's), not answered here.
-- ─────────────────────────────────────────────────────────────────────────

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
       g.grade                           AS grade_applied_mm,
       COALESCE(a.accepted, false)       AS is_accepted
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
       ) n ON true
  LEFT JOIN LATERAL (
        SELECT bool_and(r.result = 'accept') AS accepted
          FROM ndt_record r
         WHERE r.weld_uid = w.weld_uid AND r.project_id = w.project_id
           AND r.repair_cycle = (SELECT max(r2.repair_cycle) FROM ndt_record r2
                                  WHERE r2.weld_uid = r.weld_uid AND r2.project_id = r.project_id AND r2.method = r.method)
       ) a ON true;

-- The spool's stage: shop NDT and field welding by acceptance, as the
-- chain now reads them (lib/db/repos/piping-execution.mjs).
CREATE OR REPLACE VIEW reporting.spool_stage WITH (security_invoker = true) AS
WITH w AS (
  SELECT f.spool_key AS spool_id,
         COUNT(*) FILTER (WHERE NOT f.is_field_weld)                                AS shop_n,
         COUNT(*) FILTER (WHERE NOT f.is_field_weld AND f.is_welded)                AS shop_welded,
         COUNT(*) FILTER (WHERE NOT f.is_field_weld AND f.is_accepted)              AS shop_examined,
         COUNT(*) FILTER (WHERE f.is_field_weld)                                    AS field_n,
         COUNT(*) FILTER (WHERE f.is_field_weld AND f.is_welded AND f.is_accepted)  AS field_done,
         COUNT(*) FILTER (WHERE f.is_welded)                                        AS any_welded
    FROM reporting.fact_weld f
   WHERE f.spool_key IS NOT NULL
   GROUP BY f.spool_key
),
c AS (
  SELECT ci.spool_id,
         EXISTS (SELECT 1 FROM coating_activity ca WHERE ca.item_id = ci.id
                   AND ca.code = 'ready' AND ca.status = 'done') AS coated
    FROM coating_item ci
   WHERE ci.spool_id IS NOT NULL
),
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
       array_position(ARRAY['planned','released','fit_up','shop_weld','shop_ndt',
                            'erected','field_weld','supports','test','painted','ready'],
                      s.stage) - 1 AS stage_seq,
       s.built
  FROM s;
