-- ─────────────────────────────────────────────────────────────────────────
-- The project's trash: a register row deleted by mistake can be brought
-- back for 30 days (lib/db/repos/removal.mjs, lib/db/repos/trash.mjs).
--
--   trash_item   one deleted record: its kind (an ENTITIES key of
--                removal.mjs), its id, a label to recognise it by, and the
--                rows it was — itself first, then the rows it owned (a JSA's
--                steps) — as they stood, so a restore puts back exactly what
--                was there, under the same ids
--
-- Only what removal.mjs lets go reaches here: a record nothing else uses.
-- Evidence was never deletable and still is not. After 30 days an item is
-- dropped from the trash for good; restored, it leaves the trash.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE trash_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  entity      text NOT NULL,
  record_id   uuid NOT NULL,
  label       text,
  rows        jsonb NOT NULL CHECK (jsonb_typeof(rows) = 'array' AND jsonb_array_length(rows) > 0),
  deleted_by  uuid REFERENCES app_user(id),
  deleted_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX trash_item_project ON trash_item (project_id, deleted_at DESC);

ALTER TABLE trash_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE trash_item FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON trash_item USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
-- what was deleted is not rewritten: it is kept, restored (and so removed) or let go
GRANT SELECT, INSERT, DELETE ON trash_item TO app_rw;
