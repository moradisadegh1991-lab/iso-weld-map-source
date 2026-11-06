-- ─────────────────────────────────────────────────────────────────────────
-- Material override audit trail (Phase 2d).
--
-- A spool step that consumes material (fit-up, erection) is refused while the spool's tracked material is not all issued.
-- A person with the override permission can record it anyway, with a reason. That decision is a fact in its own right:
-- who authorised it, when, why, for which step, and what was missing at the time. It used to live only in the step's
-- free-text note, which the step's next update overwrites.
--
-- One row per override event, APPEND-ONLY:
--   · app_rw may SELECT and INSERT only (no UPDATE, no DELETE);
--   · a trigger refuses any change to a row (the one exception is the RI action that detaches activity_id when the
--     activity row itself is removed — the event keeps its own copy of spool and step code);
--   · rows leave only with their spool or project (ON DELETE CASCADE).
-- Additive. No existing row is changed and nothing is back-filled from old notes: an override that was only ever a note
-- stays a note, it is not reconstructed as an event.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE material_override (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  spool_id      uuid NOT NULL REFERENCES spool(id) ON DELETE CASCADE,
  activity_id   uuid REFERENCES spool_activity(id) ON DELETE SET NULL,
  code          text NOT NULL,                       -- the step overridden (fit_up, erected)
  reason        text NOT NULL,
  warnings      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- what was outstanding when it was overridden
  authorized_by uuid NOT NULL REFERENCES app_user(id),
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),   -- the server's clock, never the client's
  source        text NOT NULL,
  op_id         uuid,                                -- the field operation, when it came from a phone
  CONSTRAINT material_override_reason_not_blank CHECK (length(btrim(reason)) > 0),
  CONSTRAINT material_override_source_known CHECK (source IN ('web', 'offline')),
  CONSTRAINT material_override_offline_has_op CHECK (source <> 'offline' OR op_id IS NOT NULL)
);
-- A replayed operation cannot add a second event (the operation itself is applied once; this is the backstop).
CREATE UNIQUE INDEX material_override_op_uq ON material_override (op_id) WHERE op_id IS NOT NULL;
CREATE INDEX material_override_project_at ON material_override (project_id, authorized_at DESC);
CREATE INDEX material_override_spool_at   ON material_override (spool_id, authorized_at DESC);
CREATE INDEX material_override_activity   ON material_override (activity_id) WHERE activity_id IS NOT NULL;

CREATE FUNCTION material_override_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'activity_id') = (to_jsonb(OLD) - 'activity_id') AND NEW.activity_id IS NULL THEN
    RETURN NEW;      -- the activity row was removed: the event stays, detached from it
  END IF;
  RAISE EXCEPTION 'material_override is append-only' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER material_override_no_update BEFORE UPDATE ON material_override
  FOR EACH ROW EXECUTE FUNCTION material_override_append_only();

ALTER TABLE material_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_override FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON material_override
  USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());

-- Default privileges (001_core) hand app_rw every right on a new table; REVOKE is what makes it append-only (as 018/019/020).
GRANT SELECT, INSERT ON material_override TO app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON material_override FROM app_rw;
GRANT SELECT ON material_override TO app_report;
