-- ─────────────────────────────────────────────────────────────────────────
-- Who uses what of a sheet's BOM (owner's request of 2026-11-02): a ledger of
-- reservations against the BOM rows of one drawing revision, with its history.
--
--   iso_bom_row.alloc_cap   how many welded ends the row can serve (lib/register/
--                           bom-allocation.mjs rowCapacity); NULL: no ceiling known.
--                           Set when the BOM is saved.
--   bom_allocation          one line per owner and BOM row: a weld (its ends of the
--                           row), later a spool, a cut or an equipment's accessory
--                           (pieces or metres). Keyed by the drawing revision and the
--                           PT number, NOT by the BOM row's id: a save writes the
--                           BOM's rows again. The owner is the mark's id on the sheet.
--                           reserved → installed → returned, or reserved → released.
--   bom_allocation_event    append-only history of every change.
--
-- The ceiling is enforced here, not only on the page: a trigger locks the BOM row
-- and refuses a line that would take more than is left, so two people allocating
-- the same row at once cannot both succeed. Welds draw on the row's welded ends
-- (alloc_cap); every other owner draws on its quantity. A returned or released
-- line gives its quantity back.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE iso_bom_row ADD COLUMN alloc_cap numeric(14,3) CHECK (alloc_cap IS NULL OR alloc_cap >= 0);

CREATE TABLE bom_allocation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  run_id      uuid REFERENCES extraction_run(id) ON DELETE SET NULL,
  pt          integer NOT NULL CHECK (pt BETWEEN 1 AND 999),
  owner_kind  text NOT NULL CHECK (owner_kind IN ('weld', 'spool', 'equipment', 'accessory', 'cut')),
  owner_ref   text NOT NULL CHECK (length(owner_ref) BETWEEN 1 AND 120),
  owner_no    text CHECK (owner_no IS NULL OR length(owner_no) <= 120),
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  unit        text NOT NULL CHECK (unit IN ('pcs', 'm')),
  status      text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'installed', 'released', 'returned')),
  note        text CHECK (note IS NULL OR length(note) <= 400),
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  status_by   uuid REFERENCES app_user(id),
  status_at   timestamptz NOT NULL DEFAULT now()
);
-- one reserved and one installed line per owner and row
CREATE UNIQUE INDEX bom_allocation_active_uq ON bom_allocation (document_id, pt, owner_kind, owner_ref, status) WHERE status IN ('reserved', 'installed');
CREATE INDEX bom_allocation_doc_idx ON bom_allocation (project_id, document_id, pt);

CREATE TABLE bom_allocation_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  allocation_id uuid NOT NULL REFERENCES bom_allocation(id) ON DELETE CASCADE,
  event         text NOT NULL CHECK (event IN ('reserve', 'adjust', 'install', 'return', 'release')),
  qty_before    numeric(14,3),
  qty_after     numeric(14,3),
  status_before text,
  status_after  text,
  reason        text CHECK (reason IS NULL OR length(reason) <= 400),
  by_user       uuid REFERENCES app_user(id),
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bom_allocation_event_idx ON bom_allocation_event (project_id, document_id, allocation_id, at);

-- the ceiling, under a lock on the BOM row
CREATE FUNCTION bom_allocation_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cap numeric; used numeric; total numeric; is_weld boolean := (NEW.owner_kind = 'weld');
BEGIN
  SELECT alloc_cap, qty INTO cap, total FROM iso_bom_row WHERE document_id = NEW.document_id AND pt = NEW.pt FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bom_allocation: PT % is not in this drawing''s BOM', NEW.pt USING ERRCODE = '23503';
  END IF;
  IF NOT is_weld THEN cap := total; END IF;
  IF cap IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(sum(qty), 0) INTO used FROM bom_allocation
   WHERE document_id = NEW.document_id AND pt = NEW.pt AND status IN ('reserved', 'installed')
     AND (owner_kind = 'weld') = is_weld AND id <> NEW.id;
  IF used + NEW.qty > cap THEN
    RAISE EXCEPTION 'bom_allocation: PT % has % of % left, % asked', NEW.pt, greatest(cap - used, 0), cap, NEW.qty USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bom_allocation_check BEFORE INSERT OR UPDATE OF qty, status, pt, document_id ON bom_allocation
  FOR EACH ROW WHEN (NEW.status IN ('reserved', 'installed')) EXECUTE FUNCTION bom_allocation_check();

ALTER TABLE bom_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_allocation FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON bom_allocation USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE ON bom_allocation TO app_rw;
GRANT SELECT ON bom_allocation TO app_report;
ALTER TABLE bom_allocation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_allocation_event FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON bom_allocation_event USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT ON bom_allocation_event TO app_rw;
GRANT SELECT ON bom_allocation_event TO app_report;
