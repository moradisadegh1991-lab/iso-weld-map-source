-- ─────────────────────────────────────────────────────────────────────────
-- Reading received documents into the registers (lib/intake/*).
--
-- intake_pattern  the project's numbering shapes per kind — learned from a
--                 register or given by a person as an example
-- intake_run      one reading of one revision's file: how it was read and
--                 what came of it (a scan needing OCR is a result, not a gap)
-- intake_item     each proposed change, with where in the file it was seen;
--                 a person applies or rejects it — the only thing that
--                 changes on it afterwards is that decision
-- doc_ref         which revision shows which number: kept for everything
--                 applied, including what the document only confirmed
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE intake_pattern (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('drawing', 'equipment', 'line', 'instrument', 'subsystem', 'system')),
  shape       text NOT NULL CHECK (shape ~ '9'),
  example     text NOT NULL,
  source      text NOT NULL CHECK (source IN ('learned', 'person')),
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, shape)
);

CREATE TABLE intake_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  revision_id   uuid NOT NULL REFERENCES mdr_revision(id) ON DELETE CASCADE,
  method        text NOT NULL CHECK (method IN ('pdf-text', 'xlsx', 'none')),
  status        text NOT NULL CHECK (status IN ('read', 'needs-ocr', 'unsupported', 'failed')),
  pages         int,
  scanned_pages int[] NOT NULL DEFAULT '{}',
  doc_no_seen   boolean,                 -- the file prints the number it was received as (null: not checked)
  ambiguous     jsonb NOT NULL DEFAULT '[]',
  unknown_format jsonb NOT NULL DEFAULT '[]',
  error         text,
  started_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX intake_run_revision ON intake_run (revision_id, created_at);

CREATE TABLE intake_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  run_id       uuid NOT NULL REFERENCES intake_run(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  key          text NOT NULL,
  action       text NOT NULL CHECK (action IN ('new', 'update', 'conflict', 'same')),
  target_id    uuid,
  changes      jsonb NOT NULL DEFAULT '[]',
  attrs        jsonb NOT NULL DEFAULT '{}',
  disagree     jsonb NOT NULL DEFAULT '{}',
  seen_at      text[] NOT NULL DEFAULT '{}',
  decision     text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'applied', 'rejected')),
  reason       text,
  decided_by   uuid REFERENCES app_user(id),
  decided_at   timestamptz,
  UNIQUE (run_id, kind, key),
  -- A conflict replaces what the register held: a person says why.
  CHECK (decision <> 'applied' OR action <> 'conflict' OR reason IS NOT NULL),
  CHECK (decision = 'pending' OR decided_by IS NOT NULL)
);
CREATE INDEX intake_item_run ON intake_item (run_id);

CREATE TABLE doc_ref (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  revision_id  uuid NOT NULL REFERENCES mdr_revision(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  key          text NOT NULL,
  target_id    uuid,
  item_id      uuid REFERENCES intake_item(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, kind, key)
);
CREATE INDEX doc_ref_key ON doc_ref (project_id, kind, key);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['intake_pattern', 'intake_run', 'intake_item', 'doc_ref'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- A reading and its proposal are records; only the decision on an item is written later.
REVOKE UPDATE, DELETE, TRUNCATE ON intake_run, intake_item, doc_ref FROM app_rw;
GRANT SELECT, INSERT ON intake_run, intake_item, doc_ref TO app_rw;
GRANT UPDATE (decision, reason, decided_by, decided_at) ON intake_item TO app_rw;
GRANT SELECT ON intake_pattern, intake_run, intake_item, doc_ref TO app_report;
