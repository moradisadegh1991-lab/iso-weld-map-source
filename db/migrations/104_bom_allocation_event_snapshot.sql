-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1 (persistence unification) — the allocation history stands on its own.
--
-- bom_allocation_event pointed at its allocation with a foreign key ON DELETE CASCADE and the history query joined the live
-- allocation row to say WHAT each event was about (owner, PT). An allocation row that is removed or replaced would have taken
-- its events with it, and a history that survived would not have said what it was about.
--
-- Each event now carries what it was about, written once: owner_kind, owner_ref, owner_no, pt, unit. `allocation_id` stays as the
-- historical identifier (a plain uuid; it may dangle by design), the key to the allocation is replaced by a BEFORE INSERT
-- trigger that checks the allocation exists and is of the event's project and drawing revision (FOR KEY SHARE, as a key would)
-- and fills the snapshot from it — a writer cannot supply or forge it. The table is made append-only like the ledgers beside it
-- (REVOKE UPDATE/DELETE/TRUNCATE from app_rw, and a trigger refusing any UPDATE): the default privileges of 001 had left the
-- application role able to change and delete events.
--
-- Kept: the project and document keys (the revision itself going takes its events with it), RLS, the index.
-- Existing events are filled in from the live allocations (the migration stops, changing nothing, if one cannot be).
-- No event is removed or rewritten otherwise.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE bom_allocation_event ADD COLUMN owner_kind text;
ALTER TABLE bom_allocation_event ADD COLUMN owner_ref  text;
ALTER TABLE bom_allocation_event ADD COLUMN owner_no   text;
ALTER TABLE bom_allocation_event ADD COLUMN pt         integer;
ALTER TABLE bom_allocation_event ADD COLUMN unit       text;

-- FORCE row level security hides every row from a non-superuser owner outside a project scope; lifted for the fill only.
ALTER TABLE bom_allocation_event NO FORCE ROW LEVEL SECURITY;
ALTER TABLE bom_allocation NO FORCE ROW LEVEL SECURITY;

UPDATE bom_allocation_event e
   SET owner_kind = a.owner_kind, owner_ref = a.owner_ref, owner_no = a.owner_no, pt = a.pt, unit = a.unit
  FROM bom_allocation a
 WHERE a.id = e.allocation_id AND a.project_id = e.project_id;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO bad FROM bom_allocation_event WHERE owner_kind IS NULL OR owner_ref IS NULL OR pt IS NULL OR unit IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'bom_allocation_event rows whose allocation could not be read (resolve by hand, nothing was changed): %', bad;
  END IF;
END $$;

ALTER TABLE bom_allocation_event FORCE ROW LEVEL SECURITY;
ALTER TABLE bom_allocation FORCE ROW LEVEL SECURITY;

ALTER TABLE bom_allocation_event ALTER COLUMN owner_kind SET NOT NULL;
ALTER TABLE bom_allocation_event ALTER COLUMN owner_ref SET NOT NULL;
ALTER TABLE bom_allocation_event ALTER COLUMN pt SET NOT NULL;
ALTER TABLE bom_allocation_event ALTER COLUMN unit SET NOT NULL;

ALTER TABLE bom_allocation_event DROP CONSTRAINT bom_allocation_event_allocation_id_fkey;

CREATE FUNCTION bom_allocation_event_check_and_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a record;
BEGIN
  SELECT al.owner_kind, al.owner_ref, al.owner_no, al.pt, al.unit INTO a
    FROM bom_allocation al
   WHERE al.id = NEW.allocation_id AND al.project_id = NEW.project_id AND al.document_id = NEW.document_id
     FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bom_allocation_event: allocation % is not an allocation of this project and drawing revision', NEW.allocation_id
      USING ERRCODE = '23503', CONSTRAINT = 'bom_allocation_event_allocation_fkey';
  END IF;
  NEW.owner_kind := a.owner_kind; NEW.owner_ref := a.owner_ref; NEW.owner_no := a.owner_no; NEW.pt := a.pt; NEW.unit := a.unit;
  RETURN NEW;
END $$;
CREATE TRIGGER bom_allocation_event_snapshot BEFORE INSERT ON bom_allocation_event
  FOR EACH ROW EXECUTE FUNCTION bom_allocation_event_check_and_snapshot();

CREATE FUNCTION bom_allocation_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bom_allocation_event is append-only' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER bom_allocation_event_no_update BEFORE UPDATE ON bom_allocation_event
  FOR EACH ROW EXECUTE FUNCTION bom_allocation_event_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON bom_allocation_event FROM app_rw;
