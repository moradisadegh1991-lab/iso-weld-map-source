-- ─────────────────────────────────────────────────────────────────────────
-- What has been done to a tag, step by step.
--
-- The ORDER of the steps is not here. It lives in lib/platform/precedence.mjs
-- because it is engineering practice, and this repository's governing split
-- puts engineering practice in reviewable, testable code rather than in rows
-- somebody can edit in production. This table records only WHAT HAPPENED.
--
-- There is deliberately no `blocked` column. Blocked is computed from the
-- predecessors every time it is asked for. A stored blocked flag is wrong the
-- moment its predecessor completes, and nobody ever goes back to clear it —
-- which is how a progress board ends up with twenty red items that were
-- finished last month.
--
-- There is also no row for a step that has not started. Absence IS
-- not_started, so loading the breakdown does not mean writing nine empty rows
-- per tag before anyone has been to site.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE activity_status AS ENUM ('in_progress', 'done');

CREATE TABLE tag_activity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id       uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  -- Matches a step code in lib/platform/precedence.mjs. Not a foreign key,
  -- because the chain is code; db/test/precedence.mjs asserts that every code
  -- written here is one the chains define.
  code         text NOT NULL,
  status       activity_status NOT NULL,
  -- Evidence, so a claim of completion is attributable. An activity marked
  -- done by nobody is a rumour.
  recorded_by  uuid REFERENCES app_user(id),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  done_at      date,
  note         text,
  ref_no       text,          -- the ITR, alignment sheet or pour card number
  UNIQUE (project_id, tag_id, code)
);

CREATE INDEX tag_activity_tag_idx ON tag_activity (tag_id);

ALTER TABLE tag_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON tag_activity
  USING (project_id = current_project_id())
  WITH CHECK (project_id = current_project_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON tag_activity TO app_rw;
GRANT SELECT ON tag_activity TO app_report;

-- A claim that something is finished carries a date. Without one the
-- progress curve cannot be drawn, and "done" with no date is how a project
-- discovers in March that it does not know what happened in January.
ALTER TABLE tag_activity ADD CONSTRAINT done_is_dated
  CHECK (status <> 'done' OR done_at IS NOT NULL);

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_tag_activity WITH (security_invoker = true) AS
SELECT a.id AS activity_key, a.project_id AS project_key,
       a.tag_id AS tag_key, t.tag_no, t.discipline AS tag_discipline,
       t.subsystem_id AS subsystem_key,
       a.code, a.status, a.done_at, a.ref_no, a.recorded_at,
       u.display_name AS recorded_by
  FROM tag_activity a
  JOIN tag t ON t.id = a.tag_id
  LEFT JOIN app_user u ON u.id = a.recorded_by;

GRANT SELECT ON reporting.fact_tag_activity TO app_rw, app_report;

-- ── the neutral join the derive path needs ───────────────────────────────
--
-- `fact_progress` shipped with a subsystem but no tag. A subsystem is where
-- work is REPORTED; a tag is where work is SEQUENCED — "the piping on P-2101A
-- is connected" is a statement about a machine, not about a subsystem — and
-- the precedence chain cannot read the weld register without it.
--
-- Added here rather than patched into 007 because 007 has shipped. `tag_key`
-- goes last so the replace is additive and the views built on this one keep
-- working untouched.
CREATE OR REPLACE VIEW reporting.fact_progress WITH (security_invoker = true) AS
SELECT 'piping'::discipline AS discipline,
       f.project_key,
       COALESCE(l.subsystem_id, d.subsystem_id) AS subsystem_key,
       f.weld_uid::text  AS item_uid,
       f.weld_no         AS item_no,
       f.is_welded       AS is_installed,
       f.is_examined     AS is_tested,
       l.tag_id          AS tag_key
  FROM reporting.fact_weld f
  LEFT JOIN line     l ON l.id = f.line_key
  LEFT JOIN document d ON d.id = f.document_key;
