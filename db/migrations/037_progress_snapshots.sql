-- ─────────────────────────────────────────────────────────────────────────
-- F-16, and the history earned value needs.
--
-- F-16: reporting.fact_progress still called a weld "tested" once it had any
-- NDT record — a rejected film included. F11 fixed that for the spool stage
-- (031) but this view kept reading is_examined, so platform EV credited a
-- rejected weld with its "tested" share. Tested is now is_accepted: every
-- method's latest shot accepted.
--
-- Snapshots: platform EV is today's count; it cannot be computed for a past
-- date, so a monthly figure that is not recorded is lost. A snapshot records,
-- for a data date, each control account's PV, EV (with where it came from)
-- and AC, and the installed/tested counts of every discipline by subsystem —
-- including civil, structural and coating, which the engine derives and no
-- view can (lib/controls/progress.mjs). Snapshots are added, never changed:
-- the figure reported for a month stays what it was.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW reporting.fact_progress WITH (security_invoker = true) AS
SELECT 'piping'::discipline AS discipline,
       f.project_key,
       COALESCE(l.subsystem_id, d.subsystem_id) AS subsystem_key,
       f.weld_uid::text  AS item_uid,
       f.weld_no         AS item_no,
       f.is_welded       AS is_installed,
       f.is_accepted     AS is_tested,
       l.tag_id          AS tag_key
  FROM reporting.fact_weld f
  LEFT JOIN line     l ON l.id = f.line_key
  LEFT JOIN document d ON d.id = f.document_key
UNION ALL
SELECT 'electrical'::discipline, c.project_key, c.subsystem_key,
       c.cable_key::text, c.cable_no, c.is_pulled, c.is_ready, c.tag_key
  FROM reporting.fact_cable c
UNION ALL
SELECT 'instrumentation'::discipline, i.project_key, i.subsystem_key,
       i.instrument_key::text, i.tag_no, i.is_installed, i.is_ready, i.tag_key
  FROM reporting.fact_instrument i;

CREATE TABLE ev_snapshot (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  account_id            uuid NOT NULL REFERENCES control_account(id) ON DELETE CASCADE,
  as_of                 date NOT NULL,
  baseline_rev          text,
  pv_pct                numeric(6,2),
  ev_pct                numeric(6,2),
  ev_method             text NOT NULL,           -- platform | manual, as the account was on the day
  ev_detail             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- counts and rule of credit, or the report and its source
  ev_reason             text,                    -- why there is no EV, when there is none
  ac                    numeric(16,2),
  bac                   numeric(16,2),
  currency              text,
  taken_by              uuid REFERENCES app_user(id),
  taken_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (account_id, as_of)
);
CREATE INDEX ev_snapshot_project ON ev_snapshot (project_id, as_of);
ALTER TABLE ev_snapshot ADD CONSTRAINT ev_snapshot_method CHECK (ev_method IN ('platform', 'manual'));

CREATE TABLE progress_snapshot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  as_of         date NOT NULL,
  discipline    text NOT NULL,
  subsystem_id  uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  items         integer NOT NULL,
  installed     integer NOT NULL,
  tested        integer NOT NULL,
  taken_by      uuid REFERENCES app_user(id),
  taken_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX progress_snapshot_one ON progress_snapshot (project_id, as_of, discipline, COALESCE(subsystem_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE progress_snapshot ADD CONSTRAINT progress_snapshot_counts CHECK (0 <= tested AND tested <= installed AND installed <= items);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ev_snapshot', 'progress_snapshot'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- What was reported for a month stays what it was.
REVOKE UPDATE, DELETE, TRUNCATE ON ev_snapshot, progress_snapshot FROM app_rw;
GRANT SELECT, INSERT ON ev_snapshot, progress_snapshot TO app_rw;
GRANT SELECT ON ev_snapshot, progress_snapshot TO app_report;

-- ── reporting: the S-curve and the progress trend for Power BI ───────────

CREATE VIEW reporting.fact_ev_snapshot WITH (security_invoker = true) AS
SELECT s.id AS snapshot_key, s.project_id AS project_key, s.account_id AS account_key, a.code AS account_code,
       s.as_of, s.baseline_rev, s.pv_pct, s.ev_pct, s.ev_method, s.ac, s.bac, s.currency,
       CASE WHEN s.bac IS NOT NULL AND s.pv_pct IS NOT NULL THEN round(s.bac * s.pv_pct / 100, 2) END AS pv,
       CASE WHEN s.bac IS NOT NULL AND s.ev_pct IS NOT NULL THEN round(s.bac * s.ev_pct / 100, 2) END AS ev
  FROM ev_snapshot s JOIN control_account a ON a.id = s.account_id;

CREATE VIEW reporting.fact_progress_snapshot WITH (security_invoker = true) AS
SELECT p.project_id AS project_key, p.as_of, p.discipline, p.subsystem_id AS subsystem_key,
       p.items, p.installed, p.tested
  FROM progress_snapshot p;

GRANT SELECT ON reporting.fact_ev_snapshot, reporting.fact_progress_snapshot TO app_rw, app_report;
