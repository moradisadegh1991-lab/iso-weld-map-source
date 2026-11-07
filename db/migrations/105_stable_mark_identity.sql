-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 — a mark has a persistent identity (lib/sheet/mark-identity.mjs).
--
-- Until now equipment (iso_equipment.mark_id), its welds (iso_equipment_weld.weld_ref) and the BOM ledger
-- (bom_allocation.owner_ref) referred to a mark by its LIST handle ("m1", "m2"…), which the page hands out in list order and a
-- re-extraction hands out again: after a weld is added or dropped, "m3" could be another weld and an allocation or an installed
-- valve followed the handle to the wrong mark.
--
-- They refer to the mark's `uid` (a UUID, kept in the payload with the mark) from now on, in the SAME columns (text). What this
-- migration does to what is already there:
--   · legacy_mark_uid(document, "m3") — a deterministic UUID (md5 of "document:m3" laid out as a v4 UUID) — becomes the uid
--     of a legacy reference. The payload side derives the same value for a saved mark that has no uid (lib/db/repos/mark-identity.mjs
--     legacyMarkUid), so the old handle and the new identity line up exactly, and a second run finds nothing left to change.
--   · iso_equipment.legacy_mark_id keeps the old handle for reading.
--   · bom_allocation.owner_ref and iso_equipment_weld.weld_ref are rewritten the same way. bom_allocation_event is NOT touched
--     (immutable): its snapshot keeps the handle the event was made under.
--   · sheet_mark_identity registers every uid in use (uid → project, document, class): a uid belongs to ONE drawing revision and
--     cannot be registered to another, which is what stops two marks, or two revisions, sharing one identity.
--   · sheet_mark_warning records where a re-read of a sheet could not tell which new mark was which saved mark.
-- Nothing is deleted. A reference that is already a UUID is left as it is.
-- ─────────────────────────────────────────────────────────────────────────

CREATE FUNCTION legacy_mark_uid(doc uuid, legacy text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-'
          || substr('89ab', (get_byte(decode(substr(h, 17, 2), 'hex'), 0) & 3) + 1, 1) || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
    FROM (SELECT md5(doc::text || ':' || legacy) AS h) x
$$;

CREATE TABLE sheet_mark_identity (
  uid         uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  cls         text NOT NULL CHECK (cls IN ('weld', 'spool', 'support', 'equipment')),
  legacy_id   text,
  first_no    text,
  run_id      uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sheet_mark_identity_doc ON sheet_mark_identity (project_id, document_id);

CREATE TABLE sheet_mark_warning (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  run_id      uuid,
  kind        text NOT NULL CHECK (kind IN ('ambiguous', 'removed')),
  detail      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES app_user(id),
  resolution  text CHECK (resolution IS NULL OR length(resolution) <= 400)
);
CREATE INDEX sheet_mark_warning_doc ON sheet_mark_warning (project_id, document_id) WHERE resolved_at IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sheet_mark_identity', 'sheet_mark_warning'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON sheet_mark_identity TO app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON sheet_mark_identity FROM app_rw;       -- an identity, once issued, is never changed or taken back
GRANT SELECT, INSERT, UPDATE ON sheet_mark_warning TO app_rw;             -- a warning is resolved, not deleted
REVOKE DELETE, TRUNCATE ON sheet_mark_warning FROM app_rw;
GRANT SELECT ON sheet_mark_identity, sheet_mark_warning TO app_report;

ALTER TABLE iso_equipment ADD COLUMN legacy_mark_id text CHECK (legacy_mark_id IS NULL OR length(legacy_mark_id) <= 120);

-- FORCE row level security hides every row from a non-superuser owner outside a project scope (as 012/102/103/104 explain).
ALTER TABLE iso_equipment NO FORCE ROW LEVEL SECURITY;
ALTER TABLE iso_equipment_weld NO FORCE ROW LEVEL SECURITY;
ALTER TABLE bom_allocation NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sheet_mark_identity NO FORCE ROW LEVEL SECURITY;

-- equipment: the handle moves to legacy_mark_id, the identity takes mark_id
UPDATE iso_equipment
   SET legacy_mark_id = mark_id, mark_id = legacy_mark_uid(document_id, mark_id)::text
 WHERE mark_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- the welds an equipment joins, by the weld mark's identity (the equipment's document is the weld mark's)
UPDATE iso_equipment_weld w
   SET weld_ref = legacy_mark_uid(e.document_id, w.weld_ref)::text
  FROM iso_equipment e
 WHERE e.id = w.equipment_id AND w.weld_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- the ledger's owners
UPDATE bom_allocation
   SET owner_ref = legacy_mark_uid(document_id, owner_ref)::text
 WHERE owner_kind IN ('weld', 'equipment', 'accessory') AND owner_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- every identity now in use is registered to its drawing revision
INSERT INTO sheet_mark_identity (uid, project_id, document_id, cls, legacy_id, first_no)
SELECT mark_id::uuid, project_id, document_id, 'equipment', legacy_mark_id, equipment_no FROM iso_equipment
ON CONFLICT (uid) DO NOTHING;
INSERT INTO sheet_mark_identity (uid, project_id, document_id, cls, first_no)
SELECT DISTINCT ON (w.weld_ref) w.weld_ref::uuid, e.project_id, e.document_id, 'weld', w.weld_no
  FROM iso_equipment_weld w JOIN iso_equipment e ON e.id = w.equipment_id
ON CONFLICT (uid) DO NOTHING;
INSERT INTO sheet_mark_identity (uid, project_id, document_id, cls, first_no)
SELECT DISTINCT ON (owner_ref) owner_ref::uuid, project_id, document_id,
       CASE owner_kind WHEN 'weld' THEN 'weld' ELSE 'equipment' END, owner_no
  FROM bom_allocation WHERE owner_kind IN ('weld', 'equipment', 'accessory') AND owner_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT (uid) DO NOTHING;

ALTER TABLE iso_equipment FORCE ROW LEVEL SECURITY;
ALTER TABLE iso_equipment_weld FORCE ROW LEVEL SECURITY;
ALTER TABLE bom_allocation FORCE ROW LEVEL SECURITY;
ALTER TABLE sheet_mark_identity FORCE ROW LEVEL SECURITY;
