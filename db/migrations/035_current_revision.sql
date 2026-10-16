-- ─────────────────────────────────────────────────────────────────────────
-- F-15: a superseded revision still counted.
--
-- reporting.current_run picked one run per DOCUMENT — but a new revision of a
-- drawing is a new document row, so after Rev 1 arrived both Rev 0's register
-- and Rev 1's were "current". Every weld carried across the revision (same
-- weld_uid) was in fact_weld twice, and with it in every progress figure, the
-- handover gap, the spool stage and earned value built on them. Found by the
-- joint history page, which lists one weld's revisions and saw two current.
--
-- The run that counts is now the one of the revision in force: a document
-- another revision has superseded (document.superseded_by, set when the new
-- revision is registered) has none. Columns unchanged, so every view built on
-- this one keeps its definition.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW reporting.current_run WITH (security_invoker = true) AS
SELECT DISTINCT ON (r.project_id, r.document_id)
       r.id AS run_id, r.project_id, r.document_id, r.line_id,
       r.status, r.approved_at, r.approved_by, r.created_at
  FROM extraction_run r
  JOIN document d ON d.id = r.document_id
 WHERE r.engine_error IS NULL
   AND d.superseded_by IS NULL
 ORDER BY r.project_id, r.document_id, (r.status = 'approved') DESC, r.created_at DESC;
