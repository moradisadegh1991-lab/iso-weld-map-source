-- ─────────────────────────────────────────────────────────────────────────
-- EPIC-1 · core schema
--
-- Scope: make the tool remember things, for more than one person, across
-- more than one project. Everything here exists to serve a story in
-- docs/epc-llm/03-implementation-backlog.md.
--
-- Two rules shape the whole design:
--
--   1. Every row that belongs to a project carries `project_id`, and row
--      level security is FORCED on those tables. A forgotten WHERE clause
--      therefore leaks nothing — the database refuses, not the application.
--
--   2. Nothing computed is stored without the run that computed it. A weld
--      row points at the extraction_run that produced it, which points at
--      the document revision it read. That chain is what makes the register
--      auditable and what revision diffing (EPIC-2) walks.
-- ─────────────────────────────────────────────────────────────────────────

-- ── tenancy ──────────────────────────────────────────────────────────────

CREATE TABLE project (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

-- ── people and their standing in a project ───────────────────────────────

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject       text NOT NULL UNIQUE,   -- the identity provider's stable subject claim
  email         text,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Roles are deliberately few and named after what the site actually calls
-- people. `engineer` is the only role that may approve a weld register,
-- because that approval carries professional responsibility.
CREATE TYPE project_role AS ENUM ('viewer', 'engineer', 'qc', 'admin');

CREATE TABLE project_member (
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role        project_role NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- ── documents and revision control ───────────────────────────────────────

CREATE TABLE document (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  unit_id        uuid REFERENCES unit(id) ON DELETE SET NULL,
  doc_no         text NOT NULL,
  doc_type       text NOT NULL DEFAULT 'isometric',
  revision       text NOT NULL,
  revision_date  date,
  sheet_no       text NOT NULL DEFAULT '1/1',
  -- content addressing: the same bytes are never stored or processed twice
  file_sha256    char(64) NOT NULL,
  storage_uri    text NOT NULL,
  content_type   text,
  byte_size      bigint,
  -- set when a later revision of the same drawing arrives (EPIC-2)
  superseded_by  uuid REFERENCES document(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  UNIQUE (project_id, doc_no, revision, sheet_no)
);

CREATE INDEX document_sha_idx ON document (project_id, file_sha256);
CREATE INDEX document_current_idx ON document (project_id, doc_no) WHERE superseded_by IS NULL;

-- ── lines ────────────────────────────────────────────────────────────────

CREATE TABLE line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  unit_id       uuid REFERENCES unit(id) ON DELETE SET NULL,
  line_no       text NOT NULL,
  piping_class  text,
  service       text,
  schedule      text,
  insulation    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, line_no)
);

-- ── the audit record of one model pass over one document ─────────────────

CREATE TYPE run_status AS ENUM ('extracted', 'approved', 'superseded', 'failed');

CREATE TABLE extraction_run (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  document_id        uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  line_id            uuid REFERENCES line(id) ON DELETE SET NULL,
  model_name         text,
  model_version      text,
  pass_name          text,
  input_tokens       integer,
  output_tokens      integer,
  raw_output_uri     text,
  -- the sanitized extraction that was fed to the engine: ground truth for
  -- the extraction-layer eval, and what a re-run must reproduce
  payload            jsonb NOT NULL,
  -- the engine's own checks array, kept verbatim so accuracy can be tracked
  -- over time and any register can be re-justified later
  validation_checks  jsonb NOT NULL DEFAULT '[]'::jsonb,
  engine_error       text,
  status             run_status NOT NULL DEFAULT 'extracted',
  approved_by        uuid REFERENCES app_user(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  -- what was approved, so a later edit cannot silently change signed-off work
  approved_sha256    char(64),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES app_user(id) ON DELETE SET NULL,
  CONSTRAINT approval_is_complete CHECK (
    (status <> 'approved')
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_sha256 IS NOT NULL)
  )
);

CREATE INDEX extraction_run_document_idx ON extraction_run (project_id, document_id, created_at DESC);

-- ── the computed register ────────────────────────────────────────────────

CREATE TABLE spool (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  extraction_run_id uuid NOT NULL REFERENCES extraction_run(id) ON DELETE CASCADE,
  line_id           uuid REFERENCES line(id) ON DELETE SET NULL,
  spool_no          text NOT NULL,
  length_mm         numeric(12,2),
  nps_max           numeric(6,2),
  UNIQUE (extraction_run_id, spool_no)
);

CREATE TYPE weld_location AS ENUM ('Shop', 'Field');

CREATE TABLE weld (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  extraction_run_id uuid NOT NULL REFERENCES extraction_run(id) ON DELETE CASCADE,
  document_id       uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  line_id           uuid REFERENCES line(id) ON DELETE SET NULL,
  spool_id          uuid REFERENCES spool(id) ON DELETE SET NULL,
  -- stable across revisions: this is the key the whole programme hangs on,
  -- and what EPIC-2's diff and EPIC-3's traceability both join by
  weld_uid          text NOT NULL,
  weld_no           text NOT NULL,
  weld_kind         text NOT NULL,          -- BW | Tie-in | Closure | ...
  shop_field        weld_location NOT NULL,
  joint_role        text,
  nps               numeric(6,2),
  schedule          text,
  elevation_mm      integer,
  ndt_requirement   text,
  pos_e             numeric(14,3),
  pos_n             numeric(14,3),
  pos_el            numeric(14,3),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (extraction_run_id, weld_no)
);

CREATE INDEX weld_uid_idx ON weld (project_id, weld_uid);
CREATE INDEX weld_run_idx ON weld (extraction_run_id);

-- ── row level security ───────────────────────────────────────────────────
--
-- FORCE matters: without it the policies would not apply to the table owner,
-- which is exactly who the application connects as, and the whole control
-- would be decorative.

CREATE OR REPLACE FUNCTION current_project_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.project_id', true), '')::uuid
  $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'unit', 'document', 'line', 'extraction_run', 'spool', 'weld'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- The application must NOT connect as a superuser: PostgreSQL lets superusers
-- and BYPASSRLS roles through row level security unconditionally, FORCE or
-- not, so connecting as one would make every policy above decorative. This is
-- the role the application runs as, and lib/db/scope.mjs switches into it for
-- the duration of any project-scoped work.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;

-- `project` and `project_member` stay outside project-scoped RLS on purpose:
-- they are the directory a user consults BEFORE a project scope exists, so a
-- policy keyed on the current project would make choosing one impossible.
-- Access to them is filtered by user in lib/db/repos/projects.mjs instead.
