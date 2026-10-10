-- ─────────────────────────────────────────────────────────────────────────
-- Schedule (MS Project) and PMS (weighted progress measurement).
--
-- An import is a record of a file as it was handed over: the schedule's
-- tasks with their baseline and current dates, the PMS breakdown with its
-- weights and the progress it stated. Neither is edited — a new issue of
-- the file is a new import, and the newest one is current.
--
-- What is added after the import is added beside it, never into it:
--   pms_link      which schedule task a PMS element is planned by
--                 (the newest entry for an element wins; NULL unlinks)
--   pms_progress  a step's progress reported after the workbook, by date
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE schedule_import (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title          text,
  author         text,
  source_name    text NOT NULL,
  source_sha256  text NOT NULL,
  status_date    date,
  start_date     date,
  finish_date    date,
  last_saved     text,
  task_count     int NOT NULL,
  imported_by    uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE schedule_task (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  import_id      uuid NOT NULL REFERENCES schedule_import(id) ON DELETE CASCADE,
  uid            int NOT NULL,
  task_no        int,
  name           text NOT NULL,
  wbs            text,
  outline        text,
  level          int,
  parent_uid     int,
  is_summary     boolean NOT NULL DEFAULT false,
  is_milestone   boolean NOT NULL DEFAULT false,
  start_date     date,
  finish_date    date,
  bl_start       date,
  bl_finish      date,
  act_start      date,
  act_finish     date,
  duration_days  numeric(10,2),
  pct            numeric(5,2),
  critical       boolean NOT NULL DEFAULT false,
  custom         jsonb NOT NULL DEFAULT '{}',   -- the planner's own fields, by alias (WF, Plan%, Project Price …)
  UNIQUE (import_id, uid)
);
CREATE INDEX schedule_task_import ON schedule_task (import_id);

CREATE TABLE schedule_link (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  import_id      uuid NOT NULL REFERENCES schedule_import(id) ON DELETE CASCADE,
  pred_uid       int NOT NULL,
  succ_uid       int NOT NULL,
  link_type      text NOT NULL CHECK (link_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days       numeric(10,2) NOT NULL DEFAULT 0
);
CREATE INDEX schedule_link_import ON schedule_link (import_id);

CREATE TABLE pms_import (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title           text,
  source_name     text NOT NULL,
  source_sha256   text NOT NULL,
  -- The date the stated progress is true at. A PMS workbook often does not
  -- print it; then it is NULL (UNKNOWN) until a person states it, and the
  -- file's own save time is kept beside it — which is not the same thing.
  data_date       date,
  file_saved_at   timestamptz,
  stated_total    numeric,                -- the workbook's own top-level progress, 0…1
  computed_total  numeric,                -- re-derived from the steps, 0…1
  problems        jsonb NOT NULL DEFAULT '[]',
  imported_by     uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE pms_node (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  import_id       uuid NOT NULL REFERENCES pms_import(id) ON DELETE CASCADE,
  seq             int NOT NULL,
  parent_seq      int,
  kind            text NOT NULL CHECK (kind IN ('group', 'step')),
  level           int NOT NULL,
  row_no          int,
  name            text NOT NULL,
  code            text,
  unit            text,
  step_weight     numeric,                -- share inside its element (rule of credit)
  wf              numeric,                -- share of the whole project
  qty             numeric,
  done_qty        numeric,
  progress        numeric,                -- as the workbook states it, 0…1
  progress_last   numeric,
  progress_this   numeric,
  UNIQUE (import_id, seq)
);
CREATE INDEX pms_node_import ON pms_node (import_id);

CREATE TABLE pms_link (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  pms_import_id       uuid NOT NULL REFERENCES pms_import(id) ON DELETE CASCADE,
  node_seq            int NOT NULL,
  schedule_import_id  uuid NOT NULL REFERENCES schedule_import(id) ON DELETE CASCADE,
  task_uid            int,                -- NULL: unlinked
  linked_by           text NOT NULL CHECK (linked_by IN ('name', 'code', 'person')),
  user_id             uuid REFERENCES app_user(id),
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX pms_link_node ON pms_link (pms_import_id, node_seq, created_at);

CREATE TABLE pms_progress (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  pms_import_id  uuid NOT NULL REFERENCES pms_import(id) ON DELETE CASCADE,
  node_seq       int NOT NULL,
  as_of          date NOT NULL,
  pct            numeric(5,2) NOT NULL CHECK (pct >= 0 AND pct <= 100),
  source         text NOT NULL CHECK (length(btrim(source)) > 0),
  recorded_by    uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX pms_progress_node ON pms_progress (pms_import_id, node_seq, as_of);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schedule_import', 'schedule_task', 'schedule_link', 'pms_import', 'pms_node',
                           'pms_link', 'pms_progress'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- Imports, links and progress are records. The one thing a person may add
-- to an import afterwards is the data date it did not state.
REVOKE UPDATE, DELETE, TRUNCATE ON schedule_import, schedule_task, schedule_link, pms_import, pms_node,
                                   pms_link, pms_progress FROM app_rw;
GRANT SELECT, INSERT ON schedule_import, schedule_task, schedule_link, pms_import, pms_node,
                        pms_link, pms_progress TO app_rw;
GRANT UPDATE (data_date) ON pms_import TO app_rw;
GRANT SELECT ON schedule_import, schedule_task, schedule_link, pms_import, pms_node, pms_link, pms_progress TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_schedule_task WITH (security_invoker = true) AS
SELECT t.project_id AS project_key, t.import_id AS schedule_key, i.status_date, t.uid, t.task_no, t.outline, t.wbs,
       t.name, t.is_summary, t.is_milestone, t.start_date, t.finish_date, t.bl_start, t.bl_finish,
       t.act_start, t.act_finish, t.duration_days, t.pct, t.critical,
       (t.finish_date - t.bl_finish) AS finish_slip_days
  FROM schedule_task t JOIN schedule_import i ON i.id = t.import_id;

CREATE VIEW reporting.fact_pms_node WITH (security_invoker = true) AS
SELECT n.project_id AS project_key, n.import_id AS pms_key, i.data_date, n.seq, n.parent_seq, n.kind, n.level,
       n.name, n.code, n.unit, n.step_weight, n.wf, n.qty, n.done_qty, n.progress AS stated_progress
  FROM pms_node n JOIN pms_import i ON i.id = n.import_id;

GRANT SELECT ON reporting.fact_schedule_task, reporting.fact_pms_node TO app_rw, app_report;
