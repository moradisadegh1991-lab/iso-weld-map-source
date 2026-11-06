-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2d.1 — integrity and append-only hardening of material_override (migration 101).
--
-- A. Project/spool coherence in the database. 101 had two independent single-column foreign keys (project_id → project,
--    spool_id → spool): nothing said the spool is the PROJECT'S spool. Replaced by one composite key
--    (project_id, spool_id) → spool (project_id, id), and the activity reference by (activity_id, project_id, spool_id)
--    → spool_activity (id, project_id, spool_id): an event can only point at its own project's spool and at an activity of
--    that very spool. The two single-column keys are dropped (the composite ones imply them).
--
-- B. No exception in the append-only rule. 101 let a trigger pass an UPDATE that only nulled activity_id (to serve
--    ON DELETE SET NULL). Nothing in that test distinguishes the foreign-key action from an ordinary statement run by the
--    table's owner. The reference is now ON DELETE NO ACTION and activity_id NOT NULL: a spool_activity row that has override
--    events cannot be deleted on its own (nothing in the application does that; the rows go with their spool or project,
--    and then the events go in the same statement). With no SET NULL left, the trigger refuses EVERY update.
--
-- The migration stops, changing nothing, if any existing event violates the new rules, and names the offenders: no event is
-- rewritten or deleted here. Additive in the sense that no row changes; it tightens constraints only.
-- ─────────────────────────────────────────────────────────────────────────

-- The tables FORCE row level security and, outside a project scope, the policy sees no project: run by an owner that is not
-- a superuser, the checks below would see zero rows and pass silently (as 012 explains). The force is lifted for the checks
-- and restored right after.
ALTER TABLE material_override NO FORCE ROW LEVEL SECURITY;
ALTER TABLE spool NO FORCE ROW LEVEL SECURITY;
ALTER TABLE spool_activity NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(m.id::text || ' (project ' || m.project_id || ', spool ' || m.spool_id || ', spool belongs to ' || s.project_id || ')', '; ')
    INTO bad
    FROM material_override m JOIN spool s ON s.id = m.spool_id
   WHERE s.project_id <> m.project_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'material_override events whose spool belongs to another project (resolve by hand, nothing was changed): %', bad;
  END IF;

  SELECT string_agg(m.id::text || ' (activity ' || a.id || ' is of spool ' || a.spool_id || ' / project ' || a.project_id || ')', '; ')
    INTO bad
    FROM material_override m JOIN spool_activity a ON a.id = m.activity_id
   WHERE a.project_id <> m.project_id OR a.spool_id <> m.spool_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'material_override events whose activity is not of their project and spool (resolve by hand, nothing was changed): %', bad;
  END IF;

  SELECT string_agg(m.id::text, ', ') INTO bad FROM material_override m WHERE m.activity_id IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'material_override events with no activity (resolve by hand, nothing was changed): %', bad;
  END IF;
END $$;

ALTER TABLE material_override FORCE ROW LEVEL SECURITY;
ALTER TABLE spool FORCE ROW LEVEL SECURITY;
ALTER TABLE spool_activity FORCE ROW LEVEL SECURITY;

-- Targets of the composite keys. `id` is already unique, so these hold for every existing row.
ALTER TABLE spool ADD CONSTRAINT spool_project_id_id_key UNIQUE (project_id, id);
ALTER TABLE spool_activity ADD CONSTRAINT spool_activity_id_project_spool_key UNIQUE (id, project_id, spool_id);

ALTER TABLE material_override DROP CONSTRAINT material_override_project_id_fkey;
ALTER TABLE material_override DROP CONSTRAINT material_override_spool_id_fkey;
ALTER TABLE material_override DROP CONSTRAINT material_override_activity_id_fkey;

ALTER TABLE material_override ADD CONSTRAINT material_override_spool_fkey
  FOREIGN KEY (project_id, spool_id) REFERENCES spool (project_id, id) ON DELETE CASCADE;
ALTER TABLE material_override ALTER COLUMN activity_id SET NOT NULL;
ALTER TABLE material_override ADD CONSTRAINT material_override_activity_fkey
  FOREIGN KEY (activity_id, project_id, spool_id) REFERENCES spool_activity (id, project_id, spool_id);   -- NO ACTION, on purpose

-- Every UPDATE is refused, for every role including the owner: there is no foreign-key action left that updates this table.
CREATE OR REPLACE FUNCTION material_override_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'material_override is append-only' USING ERRCODE = '42501';
END $$;
