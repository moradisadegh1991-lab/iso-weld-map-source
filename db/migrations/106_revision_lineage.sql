-- ─────────────────────────────────────────────────────────────────────────
-- Phase 8 — revision lineage and controlled carry-forward (docs/audit/phase-8-revision-lifecycle.md).
--
-- Why a migration at all: `document.superseded_by` is a forward pointer from EVERY older revision to the NEWEST upload, so the
-- order and the direct source of a revision cannot be derived from it; and a mark's uid belongs to one revision for ever (105), so
-- "this weld of rev B is that weld of rev A" can only be kept as a stored, traceable mapping. Additive only: nothing existing is
-- changed, dropped or rewritten; 104 / 105 and the run / approval triggers are untouched.
--
--   document.parent_document_id   the revision this one was made from (same project, same doc_no and sheet; never itself; write-once;
--                                 one child per parent, so a drawing's chain is a line, not a tree)
--   document.change_note          why the revision exists
--   revision_carry_op             one APPLIED carry-forward (source, target, the hash of each run it was planned against, who, when,
--                                 summary). `request_key` makes the same request idempotent.
--   revision_carry_map            the identity mapping an operation (or an explicit confirmation) established: source uid → target uid.
--                                 append-only. A target uid maps from one source uid only; a source uid maps once per target revision.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE document ADD COLUMN parent_document_id uuid REFERENCES document(id) ON DELETE RESTRICT;
ALTER TABLE document ADD COLUMN change_note text CHECK (change_note IS NULL OR length(change_note) <= 500);
ALTER TABLE document ADD CONSTRAINT document_parent_not_self CHECK (parent_document_id IS NULL OR parent_document_id <> id);
CREATE UNIQUE INDEX document_one_child_per_parent ON document (parent_document_id) WHERE parent_document_id IS NOT NULL;

CREATE FUNCTION document_parent_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p document%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.parent_document_id IS NOT NULL AND NEW.parent_document_id IS DISTINCT FROM OLD.parent_document_id THEN
    RAISE EXCEPTION 'document.parent_document_id is write-once' USING ERRCODE = '42501';
  END IF;
  IF NEW.parent_document_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.parent_document_id IS NULL) THEN
    SELECT * INTO p FROM document WHERE id = NEW.parent_document_id;
    IF NOT FOUND OR p.project_id <> NEW.project_id OR p.doc_no <> NEW.doc_no OR p.sheet_no <> NEW.sheet_no THEN
      RAISE EXCEPTION 'document.parent_document_id must be another revision of the same drawing sheet in the same project' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_parent_check BEFORE INSERT OR UPDATE OF parent_document_id ON document
  FOR EACH ROW EXECUTE FUNCTION document_parent_check();

CREATE TABLE revision_carry_op (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  from_document_id  uuid NOT NULL REFERENCES document(id) ON DELETE RESTRICT,
  to_document_id    uuid NOT NULL REFERENCES document(id) ON DELETE RESTRICT,
  from_run_id       uuid,
  to_run_id         uuid,
  from_hash         text NOT NULL,
  to_hash_before    text NOT NULL,
  to_hash_after     text NOT NULL,
  request_key       text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 120),
  summary           jsonb NOT NULL DEFAULT '{}',
  created_by        uuid REFERENCES app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (to_document_id, request_key),
  CHECK (from_document_id <> to_document_id)
);
CREATE INDEX revision_carry_op_to ON revision_carry_op (project_id, to_document_id);

CREATE TABLE revision_carry_map (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  op_id             uuid REFERENCES revision_carry_op(id) ON DELETE RESTRICT,
  from_document_id  uuid NOT NULL REFERENCES document(id) ON DELETE RESTRICT,
  to_document_id    uuid NOT NULL REFERENCES document(id) ON DELETE RESTRICT,
  cls               text NOT NULL CHECK (cls IN ('weld', 'spool', 'support', 'equipment')),
  from_uid          text NOT NULL,
  to_uid            text NOT NULL,
  fields            text[] NOT NULL DEFAULT '{}',
  created_by        uuid REFERENCES app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (to_document_id, to_uid),
  UNIQUE (to_document_id, from_uid)
);
CREATE INDEX revision_carry_map_from ON revision_carry_map (project_id, from_document_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['revision_carry_op', 'revision_carry_map'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

CREATE FUNCTION revision_carry_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER revision_carry_op_no_update BEFORE UPDATE OR DELETE ON revision_carry_op FOR EACH ROW EXECUTE FUNCTION revision_carry_append_only();
CREATE TRIGGER revision_carry_map_no_update BEFORE UPDATE OR DELETE ON revision_carry_map FOR EACH ROW EXECUTE FUNCTION revision_carry_append_only();

GRANT SELECT, INSERT ON revision_carry_op, revision_carry_map TO app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON revision_carry_op, revision_carry_map FROM app_rw;
GRANT SELECT ON revision_carry_op, revision_carry_map TO app_report;

-- (the same note 105 makes: FORCE would hide every row from the owner outside a project scope)
