-- ─────────────────────────────────────────────────────────────────────────
-- The planning preview's sub-forms (owner's requirements of 2026-10-22,
-- items 13–28, images 1–7).
--
--   requirement_type      the contract's list of requirement kinds — the
--                         owner's five (engineering, material, site,
--                         contractor, others) to start with, editable; each
--                         names the hold column it counts in
--   activity_requirement  what an activity needs in a version before it can
--                         go on: name, document, kind, the weight held,
--                         target and actual release dates, status, the
--                         activity it waits on, remark; one row per activity
--                         and version may be the active one
--   activity_comment      comments, actions and their follow-up on an
--                         activity in a version: item discussed, who acts,
--                         by when, status, department, completed
--   wbs_activity          the activity-detail fields of image 1 a person
--                         types: status, update date, suspended, added to
--                         invoice, scale-up of the duration, constraint start
--                         and finish
--
-- A requirement and a comment hang on the version's planning row, so a
-- planning row they hang on is not removed from under them.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE requirement_type (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  hold_group   text NOT NULL DEFAULT 'others' CHECK (hold_group IN ('engineering', 'material', 'site', 'contractor', 'others')),
  seq          int NOT NULL DEFAULT 1,
  UNIQUE (contract_id, name)
);

CREATE TABLE activity_requirement (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  version_id       uuid NOT NULL,
  activity_id      uuid NOT NULL,
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  doc_no           text,
  type_id          uuid NOT NULL REFERENCES requirement_type(id) ON DELETE RESTRICT,
  hold_weight      numeric(24,10) CHECK (hold_weight IS NULL OR hold_weight >= 0),
  target_date      date,
  done_date        date,
  status           text,
  active           boolean NOT NULL DEFAULT false,
  pred_activity_id uuid REFERENCES wbs_activity(id) ON DELETE SET NULL,
  remark           text,
  seq              int NOT NULL DEFAULT 1,
  created_by       uuid REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (version_id, activity_id) REFERENCES activity_plan (version_id, activity_id) ON DELETE RESTRICT,
  CHECK (pred_activity_id IS DISTINCT FROM activity_id)
);
CREATE INDEX activity_requirement_plan ON activity_requirement (version_id, activity_id);
CREATE UNIQUE INDEX activity_requirement_one_active ON activity_requirement (version_id, activity_id) WHERE active;

CREATE TABLE activity_comment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  version_id   uuid NOT NULL,
  activity_id  uuid NOT NULL,
  row_no       int NOT NULL CHECK (row_no >= 1),
  item         text NOT NULL CHECK (length(btrim(item)) > 0),
  action_by    uuid REFERENCES app_user(id),
  action_date  date,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  department   text,
  done_date    date,
  remark       text,
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (version_id, activity_id) REFERENCES activity_plan (version_id, activity_id) ON DELETE RESTRICT,
  UNIQUE (version_id, activity_id, row_no)
);

ALTER TABLE wbs_activity ADD COLUMN status_text text;
ALTER TABLE wbs_activity ADD COLUMN update_date date;
ALTER TABLE wbs_activity ADD COLUMN suspended boolean NOT NULL DEFAULT false;
ALTER TABLE wbs_activity ADD COLUMN add_to_invoice boolean NOT NULL DEFAULT false;
ALTER TABLE wbs_activity ADD COLUMN scale_up_pct numeric(9,4);
ALTER TABLE wbs_activity ADD COLUMN constraint_start date;
ALTER TABLE wbs_activity ADD COLUMN constraint_end date;
ALTER TABLE wbs_activity ADD CONSTRAINT wbs_activity_constraint_span CHECK (constraint_end IS NULL OR constraint_start IS NULL OR constraint_end >= constraint_start);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['requirement_type', 'activity_requirement', 'activity_comment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
