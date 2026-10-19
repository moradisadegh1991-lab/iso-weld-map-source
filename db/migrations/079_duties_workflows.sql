-- ─────────────────────────────────────────────────────────────────────────
-- Duties, a tree of workflows, and a workflow attached to a form
-- (owner's requirements of 2026-10-18, docs/digital-epc/12-owner-requirements.md).
--
--   duty           a post in the project («مدیر کارگاه», «ناظر مقیم») with the
--                  access it normally carries. People come and go; the
--                  workflow names the duty, and whoever holds it acts.
--   duty_member    who holds a duty now
--   workflow       a node of the workflow tree. A node with stages is a
--                  workflow; a node without is a folder. Stages, groups and
--                  pages belong to the workflow, not to a form, so one
--                  workflow serves several forms.
--   report_type.workflow_id   the workflow a form follows
--   workflow_page  the pages of a workflow, each a name and a number and the
--                  parts of the form it holds; a page's footer prints the
--                  signatures of the duties that reach it
--   group_duty     a duty in a review group: its rights there, how many days
--                  it has to review, the pages it reaches and the tree rows
--                  it may change (none named → all)
--   report_signature.accept_changes   «if my stage changes the content, my
--                  signature stands»
--
-- Every report type that already had stages gets a workflow of its own with
-- them, so nothing in flight changes: the same stages, groups, members and
-- signatures, reached through the workflow.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE duty (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code         text CHECK (code IS NULL OR code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}$'),
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  description  text,
  permissions  text[] NOT NULL DEFAULT ARRAY['view']::text[],
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE UNIQUE INDEX duty_code ON duty (project_id, code) WHERE code IS NOT NULL;

CREATE TABLE duty_member (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  duty_id      uuid NOT NULL REFERENCES duty(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  UNIQUE (duty_id, user_id)
);

CREATE TABLE workflow (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES workflow(id) ON DELETE RESTRICT,
  code         text,
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  description  text,
  seq          int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX workflow_code ON workflow (project_id, code) WHERE code IS NOT NULL;

ALTER TABLE report_type  ADD COLUMN workflow_id uuid REFERENCES workflow(id) ON DELETE RESTRICT;
ALTER TABLE report_stage ADD COLUMN workflow_id uuid REFERENCES workflow(id) ON DELETE CASCADE;
ALTER TABLE report_stage ALTER COLUMN report_type_id DROP NOT NULL;

CREATE TABLE workflow_page (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  workflow_id  uuid NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  page_no      int  NOT NULL CHECK (page_no >= 1),
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  sections     text[] NOT NULL DEFAULT ARRAY[]::text[],      -- the parts of the form on this page; none → all
  UNIQUE (workflow_id, page_no)
);

CREATE TABLE group_duty (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL REFERENCES review_group(id) ON DELETE CASCADE,
  duty_id      uuid NOT NULL REFERENCES duty(id) ON DELETE CASCADE,
  permissions  text[] NOT NULL DEFAULT ARRAY['view']::text[]
               CHECK (permissions <@ ARRAY['view', 'create', 'add_content', 'edit', 'delete_content', 'delete', 'sign',
                                           'return', 'approve']::text[]),
  review_days  int CHECK (review_days IS NULL OR review_days >= 1),
  pages        uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],      -- the pages it reaches; none → every page
  scope        text[] NOT NULL DEFAULT ARRAY[]::text[],      -- the tree rows (and all under them) it may change; none → all rows
  UNIQUE (group_id, duty_id)
);

ALTER TABLE report_signature ADD COLUMN accept_changes boolean NOT NULL DEFAULT false;

-- The workflow each report type already had becomes a workflow of its own.
ALTER TABLE report_type NO FORCE ROW LEVEL SECURITY;
ALTER TABLE report_stage NO FORCE ROW LEVEL SECURITY;
CREATE TEMP TABLE wf_map ON COMMIT DROP AS
SELECT t.id AS type_id, gen_random_uuid() AS workflow_id, t.project_id, t.code, t.name, t.description
  FROM report_type t WHERE EXISTS (SELECT 1 FROM report_stage s WHERE s.report_type_id = t.id);
ALTER TABLE workflow NO FORCE ROW LEVEL SECURITY;
INSERT INTO workflow (id, project_id, code, name, description) SELECT workflow_id, project_id, code, name, description FROM wf_map;
UPDATE report_type t SET workflow_id = m.workflow_id FROM wf_map m WHERE m.type_id = t.id;
UPDATE report_stage s SET workflow_id = m.workflow_id FROM wf_map m WHERE m.type_id = s.report_type_id;
ALTER TABLE workflow FORCE ROW LEVEL SECURITY;
ALTER TABLE report_stage FORCE ROW LEVEL SECURITY;
ALTER TABLE report_type FORCE ROW LEVEL SECURITY;

ALTER TABLE report_stage ALTER COLUMN workflow_id SET NOT NULL;
ALTER TABLE report_stage ADD CONSTRAINT report_stage_workflow_seq UNIQUE (workflow_id, seq);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['duty', 'duty_member', 'workflow', 'workflow_page', 'group_duty'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
