-- ─────────────────────────────────────────────────────────────────────────
-- EPIC-2 · fabrication status on a spool
--
-- Revision control is only worth building because of what it protects: a
-- spool that is still on paper absorbs a drawing revision for free, and one
-- that is already welded, tested and painted absorbs it as cut-and-reweld, a
-- fresh NDT report and a delay. Without knowing which is which, a diff is
-- just a list.
--
-- The status lives on the spool row of a particular run, so it is always
-- clear WHICH register's spool was built. Matching a built spool to its
-- counterpart in a later revision is derived from the welds they share, not
-- stored — spool numbers renumber exactly like weld numbers do.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TYPE fabrication_status AS ENUM (
  'planned',      -- on paper only
  'released',     -- issued to the shop
  'fabricated',   -- welded
  'tested',       -- NDT complete
  'painted',
  'shipped',
  'erected'
);

ALTER TABLE spool
  ADD COLUMN fab_status     fabrication_status NOT NULL DEFAULT 'planned',
  ADD COLUMN fab_status_at  timestamptz,
  ADD COLUMN fab_note       text;

CREATE INDEX spool_fab_idx ON spool (project_id, fab_status)
  WHERE fab_status <> 'planned';

-- Recording that a spool was built is evidence, so it carries who said so.
ALTER TABLE spool
  ADD COLUMN fab_status_by  uuid REFERENCES app_user(id) ON DELETE SET NULL;
