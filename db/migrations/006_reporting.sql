-- ─────────────────────────────────────────────────────────────────────────
-- EPIC-8 · reporting star schema
--
-- Shaped for Power BI: conformed dimensions around a few narrow fact views,
-- so the model that gets built on top is a star and not a tangle of joins
-- against operational tables.
--
-- EVERY VIEW IS security_invoker. This is not a style choice. A PostgreSQL
-- view runs with its OWNER's privileges by default, which means row level
-- security is evaluated against the owner and not the querying role — a plain
-- view over these tables returns every project's rows to anyone who can read
-- it. With security_invoker the policies apply to the caller, and the
-- isolation the rest of the system depends on survives into the BI layer.
--
-- HOW POWER BI CONNECTS
--
-- The policies key on `app.project_id`, so the connection must carry it.
-- PostgreSQL takes startup options in the connection string:
--
--   postgresql://app_report@host/db?options=-c%20app.project_id%3D<uuid>
--
-- One report file, one project, scope enforced by the database rather than by
-- a filter somebody can remove.
-- ─────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS reporting;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_report') THEN
    CREATE ROLE app_report NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA reporting TO app_rw, app_report;
GRANT USAGE ON SCHEMA public TO app_report;

-- ── the governing register ───────────────────────────────────────────────
--
-- A drawing may have several runs. The one that counts is the approved one;
-- failing that, the most recent that built. Every fact below hangs off this,
-- so a superseded draft never inflates a progress number.

CREATE VIEW reporting.current_run WITH (security_invoker = true) AS
SELECT DISTINCT ON (r.project_id, r.document_id)
       r.id AS run_id, r.project_id, r.document_id, r.line_id,
       r.status, r.approved_at, r.approved_by, r.created_at
  FROM extraction_run r
 WHERE r.engine_error IS NULL
 ORDER BY r.project_id, r.document_id, (r.status = 'approved') DESC, r.created_at DESC;

-- ── dimensions ───────────────────────────────────────────────────────────

CREATE VIEW reporting.dim_project WITH (security_invoker = true) AS
SELECT p.id AS project_key, p.code AS project_code, p.name AS project_name, p.created_at
  FROM project p;

CREATE VIEW reporting.dim_unit WITH (security_invoker = true) AS
SELECT u.id AS unit_key, u.project_id AS project_key, u.code AS unit_code, u.name AS unit_name
  FROM unit u;

CREATE VIEW reporting.dim_line WITH (security_invoker = true) AS
SELECT l.id AS line_key, l.project_id AS project_key, l.unit_id AS unit_key,
       l.line_no, l.service, l.schedule, l.insulation,
       c.code AS piping_class, c.service_category, c.material_spec, c.pwht_above_mm
  FROM line l
  LEFT JOIN piping_class c ON c.id = l.piping_class_id;

CREATE VIEW reporting.dim_document WITH (security_invoker = true) AS
SELECT d.id AS document_key, d.project_id AS project_key, d.unit_id AS unit_key,
       d.doc_no, d.revision, d.sheet_no, d.revision_date,
       (d.superseded_by IS NULL) AS is_current_revision,
       d.file_sha256, d.created_at
  FROM document d;

CREATE VIEW reporting.dim_welder WITH (security_invoker = true) AS
SELECT w.id AS welder_key, w.project_id AS project_key,
       w.stamp_no, w.name AS welder_name, w.employer, w.active,
       COUNT(q.id) FILTER (WHERE q.revoked_at IS NULL) AS live_qualifications,
       STRING_AGG(DISTINCT q.process::text, ', ') FILTER (WHERE q.revoked_at IS NULL) AS processes,
       MIN(q.expires_on) FILTER (WHERE q.revoked_at IS NULL) AS earliest_expiry
  FROM welder w
  LEFT JOIN welder_qualification q ON q.welder_id = w.id
 GROUP BY w.id;

CREATE VIEW reporting.dim_spool WITH (security_invoker = true) AS
SELECT s.id AS spool_key, s.project_id AS project_key, s.line_id AS line_key,
       s.spool_no, s.length_mm, s.nps_max, s.fab_status, s.fab_status_at
  FROM spool s
  JOIN reporting.current_run cr ON cr.run_id = s.extraction_run_id;

-- ── facts ────────────────────────────────────────────────────────────────
--
-- Grain: one row per weld in the governing register. The boolean measures are
-- deliberately pre-computed — a Power BI model should not have to express
-- "welded" as a relationship test.

CREATE VIEW reporting.fact_weld WITH (security_invoker = true) AS
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
       -- The handover gap, as a column: a weld that is welded but never
       -- examined is an ITR that will be missing from the dossier.
       (e.weld_uid IS NOT NULL AND n.first_result IS NULL) AS awaiting_ndt
  FROM weld w
  JOIN reporting.current_run cr ON cr.run_id = w.extraction_run_id
  LEFT JOIN weld_execution e
         ON e.weld_uid = w.weld_uid AND e.project_id = w.project_id
  LEFT JOIN LATERAL (
        SELECT COUNT(*) AS shots,
               MAX(r.result::text) FILTER (WHERE r.repair_cycle = 0) AS first_result
          FROM ndt_record r
         WHERE r.weld_uid = w.weld_uid AND r.project_id = w.project_id
       ) n ON true;

CREATE VIEW reporting.fact_ndt WITH (security_invoker = true) AS
SELECT r.id AS ndt_key, r.project_id AS project_key,
       r.weld_uid, e.welder_id AS welder_key, e.line_id AS line_key,
       r.method, r.result, r.repair_cycle, r.defect_type, r.inspected_at, r.report_no,
       (r.repair_cycle = 0)                          AS is_first_shot,
       (r.repair_cycle = 0 AND r.result = 'reject')  AS is_first_shot_reject
  FROM ndt_record r
  LEFT JOIN weld_execution e ON e.weld_uid = r.weld_uid AND e.project_id = r.project_id;

-- Grain: one field an engineer corrected. This is the extraction-accuracy
-- fact: it says which FIELD the model gets wrong, which aggregate accuracy
-- never could.
CREATE VIEW reporting.fact_extraction_edit WITH (security_invoker = true) AS
SELECT e.id AS edit_key, e.project_id AS project_key,
       e.document_id AS document_key, e.extraction_run_id AS run_key,
       e.path, e.field, e.kind,
       REGEXP_REPLACE(e.path, '\[\d+\]', '[]', 'g') AS field_path,
       e.before_value, e.after_value, e.edited_at, u.display_name AS edited_by
  FROM extraction_edit e
  LEFT JOIN app_user u ON u.id = e.edited_by;

-- ── KPI views, for the cards at the top of a page ────────────────────────

CREATE VIEW reporting.kpi_line_progress WITH (security_invoker = true) AS
SELECT f.project_key, f.line_key, l.line_no, l.piping_class,
       COUNT(*)                                      AS welds_total,
       COUNT(*) FILTER (WHERE f.is_welded)           AS welds_done,
       COUNT(*) FILTER (WHERE f.is_field_weld)       AS field_welds,
       COUNT(*) FILTER (WHERE f.is_examined)         AS welds_examined,
       COUNT(*) FILTER (WHERE f.awaiting_ndt)        AS awaiting_ndt,
       ROUND(100.0 * COUNT(*) FILTER (WHERE f.is_welded) / NULLIF(COUNT(*), 0), 1) AS pct_welded,
       ROUND(100.0 * COUNT(*) FILTER (WHERE f.is_examined) / NULLIF(COUNT(*), 0), 1) AS pct_examined
  FROM reporting.fact_weld f
  LEFT JOIN reporting.dim_line l ON l.line_key = f.line_key
 GROUP BY f.project_key, f.line_key, l.line_no, l.piping_class;

-- Repair rate on FIRST shots only. Counting re-shots punishes a welder twice
-- for one defect and rewards one whose rejects were never re-tested.
--
-- Each fact is aggregated BEFORE it is joined. Joining a dimension to two
-- one-to-many facts in the same query multiplies them together, and the
-- result is a KPI that is quietly several times too large — the kind of
-- number nobody questions because it is only ever seen as a card.
CREATE VIEW reporting.kpi_welder_performance WITH (security_invoker = true) AS
SELECT d.project_key, d.welder_key, d.stamp_no, d.welder_name, d.processes,
       COALESCE(w.welds_made, 0) AS welds_made,
       COALESCE(n.shots, 0)      AS shots,
       COALESCE(n.rejects, 0)    AS rejects,
       ROUND(100.0 * n.rejects / NULLIF(n.shots, 0), 1) AS repair_rate_pct
  FROM reporting.dim_welder d
  LEFT JOIN (
        SELECT welder_key, COUNT(DISTINCT weld_uid) AS welds_made
          FROM reporting.fact_weld
         WHERE welder_key IS NOT NULL
         GROUP BY welder_key
       ) w ON w.welder_key = d.welder_key
  LEFT JOIN (
        SELECT welder_key,
               COUNT(*) FILTER (WHERE is_first_shot)        AS shots,
               COUNT(*) FILTER (WHERE is_first_shot_reject) AS rejects
          FROM reporting.fact_ndt
         WHERE welder_key IS NOT NULL
         GROUP BY welder_key
       ) n ON n.welder_key = d.welder_key;

CREATE VIEW reporting.kpi_spool_status WITH (security_invoker = true) AS
SELECT s.project_key, s.line_key, s.fab_status,
       COUNT(*)            AS spools,
       SUM(s.length_mm)    AS length_mm,
       MAX(s.fab_status_at) AS last_movement
  FROM reporting.dim_spool s
 GROUP BY s.project_key, s.line_key, s.fab_status;

-- The list that decides whether a system can be handed over.
CREATE VIEW reporting.kpi_handover_gap WITH (security_invoker = true) AS
SELECT f.project_key, f.line_key, l.line_no, f.weld_uid, f.weld_no,
       f.shop_field, f.ndt_requirement, f.welded_at, w.stamp_no
  FROM reporting.fact_weld f
  LEFT JOIN reporting.dim_line l   ON l.line_key = f.line_key
  LEFT JOIN reporting.dim_welder w ON w.welder_key = f.welder_key
 WHERE f.awaiting_ndt;

-- Which fields extraction keeps getting wrong. The report that improves the
-- model, as opposed to the ones that report on the work.
CREATE VIEW reporting.kpi_extraction_accuracy WITH (security_invoker = true) AS
SELECT e.project_key, e.field_path, e.field,
       COUNT(*)                          AS corrections,
       COUNT(DISTINCT e.run_key)         AS runs_affected,
       MIN(e.edited_at)                  AS first_seen,
       MAX(e.edited_at)                  AS last_seen
  FROM reporting.fact_extraction_edit e
 GROUP BY e.project_key, e.field_path, e.field;

GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO app_rw, app_report;
ALTER DEFAULT PRIVILEGES IN SCHEMA reporting GRANT SELECT ON TABLES TO app_rw, app_report;

-- app_report reads through the views, which read the base tables as the
-- caller. Without these it would see nothing at all rather than its project.
GRANT SELECT ON project, unit, line, document, weld, spool, welder,
                welder_qualification, weld_execution, ndt_record,
                extraction_run, extraction_edit, piping_class, app_user
  TO app_report;
