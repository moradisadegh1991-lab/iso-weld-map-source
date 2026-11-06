-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2d.2 — override events outlive the spool rows they were made on.
--
-- Editing a register (lib/db/repos/review.mjs applyCorrection) deletes the run's spool rows and inserts new ones, with new
-- ids. Through the composite key of 102 (ON DELETE CASCADE) that deleted the run's override events too: an engineering
-- decision erased by a re-derivation. (A NEW extraction run or a new drawing revision does not delete anything — it makes new
-- spool rows beside the old ones — but the old rows were then reachable only by their ids.)
--
-- The spool rows are generated; the decision is not. So the event carries its own identity, written once, never changed:
--   spool_id, activity_id   plain uuids from now on — the historical identifiers of the spool and step it was made on
--   spool_no                the spool's number as printed
--   run_id, document_id     the extraction run and the drawing revision it was made on
--   doc_no, revision, sheet_no, line_no   readable, so the event stays legible after the rows are gone
-- and there is no foreign key from the event to the spool or the activity: nothing the register does to its generated rows
-- can reach the audit trail.
--
-- The integrity the keys of 102 gave is kept, at the only moment it can mean anything — when the event is written — by a
-- BEFORE INSERT trigger: the spool must exist and belong to the event's project, the activity must exist and be an activity
-- of that very spool, and the snapshot columns are FILLED BY THE TRIGGER from the live rows (anything the writer supplied is
-- overwritten, so a snapshot cannot be forged). The trigger takes FOR KEY SHARE on both rows, as a foreign key does, so a
-- concurrent delete waits for the insert. After that the ids may dangle by design; the snapshot says what they were.
--
-- Kept from 101/102: RLS, REVOKE UPDATE/DELETE/TRUNCATE, the unconditional no-UPDATE trigger, NOT NULL activity, the
-- reason/source CHECKs, the project key (the whole project going takes its events with it). Existing events are filled in
-- from the live rows (the one UPDATE this table ever sees, inside this migration, with the trigger off); the migration stops,
-- changing nothing, if an event cannot be filled in.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE material_override ADD COLUMN spool_no    text;
ALTER TABLE material_override ADD COLUMN run_id      uuid;
ALTER TABLE material_override ADD COLUMN document_id uuid;
ALTER TABLE material_override ADD COLUMN doc_no      text;
ALTER TABLE material_override ADD COLUMN revision    text;
ALTER TABLE material_override ADD COLUMN sheet_no    text;
ALTER TABLE material_override ADD COLUMN line_no     text;

-- The tables FORCE row level security; outside a project scope the owner would see nothing (as 012 and 102 explain).
ALTER TABLE material_override NO FORCE ROW LEVEL SECURITY;
ALTER TABLE spool NO FORCE ROW LEVEL SECURITY;
ALTER TABLE extraction_run NO FORCE ROW LEVEL SECURITY;
ALTER TABLE document NO FORCE ROW LEVEL SECURITY;
ALTER TABLE line NO FORCE ROW LEVEL SECURITY;

ALTER TABLE material_override DISABLE TRIGGER material_override_no_update;
UPDATE material_override m
   SET spool_no = s.spool_no, run_id = s.extraction_run_id, document_id = d.id,
       doc_no = d.doc_no, revision = d.revision, sheet_no = d.sheet_no, line_no = l.line_no
  FROM spool s
  JOIN extraction_run r ON r.id = s.extraction_run_id
  JOIN document d ON d.id = r.document_id
  LEFT JOIN line l ON l.id = s.line_id
 WHERE s.id = m.spool_id AND s.project_id = m.project_id;
ALTER TABLE material_override ENABLE TRIGGER material_override_no_update;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO bad FROM material_override WHERE spool_no IS NULL OR run_id IS NULL OR document_id IS NULL OR doc_no IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'material_override events whose spool/drawing could not be read (resolve by hand, nothing was changed): %', bad;
  END IF;
END $$;

ALTER TABLE material_override FORCE ROW LEVEL SECURITY;
ALTER TABLE spool FORCE ROW LEVEL SECURITY;
ALTER TABLE extraction_run FORCE ROW LEVEL SECURITY;
ALTER TABLE document FORCE ROW LEVEL SECURITY;
ALTER TABLE line FORCE ROW LEVEL SECURITY;

ALTER TABLE material_override ALTER COLUMN spool_no SET NOT NULL;
ALTER TABLE material_override ALTER COLUMN run_id SET NOT NULL;
ALTER TABLE material_override ALTER COLUMN document_id SET NOT NULL;
ALTER TABLE material_override ALTER COLUMN doc_no SET NOT NULL;
ALTER TABLE material_override ALTER COLUMN revision SET NOT NULL;
ALTER TABLE material_override ALTER COLUMN sheet_no SET NOT NULL;

-- The keys of 102 give way to the project key and the insert-time check below.
ALTER TABLE material_override DROP CONSTRAINT material_override_spool_fkey;
ALTER TABLE material_override DROP CONSTRAINT material_override_activity_fkey;
ALTER TABLE material_override ADD CONSTRAINT material_override_project_fkey
  FOREIGN KEY (project_id) REFERENCES project (id) ON DELETE CASCADE;
-- Their targets existed only for those keys.
ALTER TABLE spool_activity DROP CONSTRAINT spool_activity_id_project_spool_key;
ALTER TABLE spool DROP CONSTRAINT spool_project_id_id_key;

-- Readers find an event by its spool and by its drawing; the spool index of 101 stays.
CREATE INDEX material_override_drawing ON material_override (project_id, doc_no, sheet_no, spool_no, authorized_at DESC);

CREATE FUNCTION material_override_check_and_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; a record;
BEGIN
  SELECT sp.id, sp.project_id, sp.spool_no, sp.extraction_run_id, d.id AS document_id, d.doc_no, d.revision, d.sheet_no, l.line_no
    INTO s
    FROM spool sp
    JOIN extraction_run r ON r.id = sp.extraction_run_id
    JOIN document d ON d.id = r.document_id
    LEFT JOIN line l ON l.id = sp.line_id
   WHERE sp.id = NEW.spool_id AND sp.project_id = NEW.project_id
     FOR KEY SHARE OF sp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_override: spool % is not a spool of project %', NEW.spool_id, NEW.project_id
      USING ERRCODE = '23503', CONSTRAINT = 'material_override_spool_fkey';
  END IF;
  SELECT ac.id INTO a FROM spool_activity ac
   WHERE ac.id = NEW.activity_id AND ac.project_id = NEW.project_id AND ac.spool_id = NEW.spool_id
     FOR KEY SHARE OF ac;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_override: activity % is not an activity of spool % in project %', NEW.activity_id, NEW.spool_id, NEW.project_id
      USING ERRCODE = '23503', CONSTRAINT = 'material_override_activity_fkey';
  END IF;
  -- the snapshot is the database's reading of the live rows, never the writer's
  NEW.spool_no := s.spool_no; NEW.run_id := s.extraction_run_id; NEW.document_id := s.document_id;
  NEW.doc_no := s.doc_no; NEW.revision := s.revision; NEW.sheet_no := s.sheet_no; NEW.line_no := s.line_no;
  RETURN NEW;
END $$;
CREATE TRIGGER material_override_snapshot BEFORE INSERT ON material_override
  FOR EACH ROW EXECUTE FUNCTION material_override_check_and_snapshot();
