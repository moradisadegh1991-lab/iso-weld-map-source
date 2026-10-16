-- ─────────────────────────────────────────────────────────────────────────
-- EPS, PMS versions, WBS and activities (owner's request 2026-10-16).
--
-- eps_pms             a contract's PMS (the EPS holds several): code, title,
--                     registered, planned and actual start and finish
-- eps_version         a PMS's versions of the schedule, ordered, movable
--                     between PMSs; each carries its WBS's settings (level
--                     colours, numbering, separator, budget mode) and the
--                     root's budget
-- wbs_node            the version's WBS, a tree under the PMS code; only
--                     what a person types is stored — W.V, budgets by mode,
--                     durations are worked out on read (lib/eps/wbs.mjs)
-- activity_template   activity templates, a tree of their own
-- template_activity   a template's activities: code (template + 2 digits),
--                     name, W.F, description
-- wbs_activity        a WBS node's activities, from a template or by hand;
--                     volumes, dates and budgets are read from the node
--
-- The imported PMS of migration 062 (pms_import …) is a record of a file
-- and stays as it is; this is the schedule as the project builds it.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE eps_pms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  code          text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$'),
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  registered_on date NOT NULL DEFAULT CURRENT_DATE,
  plan_start    date, plan_end date, actual_start date, actual_end date,
  seq           int NOT NULL DEFAULT 1,
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code),
  CHECK (plan_end IS NULL OR plan_start IS NULL OR plan_end >= plan_start),
  CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start)
);

CREATE TABLE eps_version (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  pms_id        uuid NOT NULL REFERENCES eps_pms(id) ON DELETE RESTRICT,
  code          text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}$'),
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  description   text,
  registered_on date NOT NULL DEFAULT CURRENT_DATE,
  start_on      date, end_on date,
  seq           int NOT NULL DEFAULT 1,
  budget_plan   numeric(20,2) CHECK (budget_plan IS NULL OR budget_plan >= 0),
  budget_actual numeric(20,2) CHECK (budget_actual IS NULL OR budget_actual >= 0),
  settings      jsonb NOT NULL DEFAULT '{}',
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code),
  CHECK (end_on IS NULL OR start_on IS NULL OR end_on >= start_on)
);

CREATE TABLE activity_template (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES activity_template(id) ON DELETE RESTRICT,
  code          text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,19}$'),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  description   text,
  seq           int NOT NULL DEFAULT 1,
  UNIQUE (project_id, code)
);

CREATE TABLE template_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  template_id   uuid NOT NULL REFERENCES activity_template(id) ON DELETE CASCADE,
  number        int NOT NULL CHECK (number BETWEEN 1 AND 99),
  code          text NOT NULL,
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  wf            numeric(9,4) CHECK (wf IS NULL OR (wf >= 0 AND wf <= 100)),
  description   text,
  UNIQUE (template_id, number)
);

CREATE TABLE wbs_node (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  version_id    uuid NOT NULL REFERENCES eps_version(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES wbs_node(id) ON DELETE RESTRICT,
  code          text NOT NULL CHECK (length(btrim(code)) > 0),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  seq           int NOT NULL DEFAULT 1,
  budget_plan   numeric(20,2) CHECK (budget_plan IS NULL OR budget_plan >= 0),
  budget_actual numeric(20,2) CHECK (budget_actual IS NULL OR budget_actual >= 0),
  qty           numeric(14,2) CHECK (qty IS NULL OR qty >= 0),
  unit          text,
  volume_plan   numeric(16,3) CHECK (volume_plan IS NULL OR volume_plan >= 0),
  volume_actual numeric(16,3) CHECK (volume_actual IS NULL OR volume_actual >= 0),
  wf            numeric(9,4) CHECK (wf IS NULL OR (wf >= 0 AND wf <= 100)),
  plan_start    date, plan_end date, actual_start date, actual_end date,
  description   text,
  template_id   uuid REFERENCES activity_template(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, code),
  CHECK (plan_end IS NULL OR plan_start IS NULL OR plan_end >= plan_start),
  CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start)
);
CREATE INDEX wbs_node_parent ON wbs_node (parent_id);

CREATE TABLE wbs_activity (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  node_id              uuid NOT NULL REFERENCES wbs_node(id) ON DELETE CASCADE,
  code                 text NOT NULL,
  name                 text NOT NULL CHECK (length(btrim(name)) > 0),
  wf                   numeric(9,4) CHECK (wf IS NULL OR (wf >= 0 AND wf <= 100)),
  template_activity_id uuid REFERENCES template_activity(id) ON DELETE SET NULL,
  template_code        text,
  progress             numeric(6,2) CHECK (progress IS NULL OR (progress >= 0 AND progress <= 100)),
  description          text,
  seq                  int NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, code)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['eps_pms', 'eps_version', 'activity_template', 'template_activity', 'wbs_node', 'wbs_activity'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
