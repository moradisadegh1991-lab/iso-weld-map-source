-- ─────────────────────────────────────────────────────────────────────────
-- Reservations and stock counts (rules: lib/warehouse/reserve.mjs).
--
-- What a reservation still holds is derived from the issues made against
-- it; a count difference changes the book only through a movement a person
-- decided on, with a reason — the ledger stays append-only.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE material_reservation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES material_item(id),
  lot_id          uuid REFERENCES material_lot(id),        -- when the heat matters; else any issuable lot
  qty             numeric(14,3) NOT NULL,
  spool_id        uuid REFERENCES spool(id) ON DELETE SET NULL,
  tag_id          uuid REFERENCES tag(id) ON DELETE SET NULL,
  purpose         text,
  need_by         date,
  reserved_by     uuid REFERENCES app_user(id),
  reserved_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  released_at     timestamptz,
  released_by     uuid REFERENCES app_user(id),
  release_reason  text
);
ALTER TABLE material_reservation ADD CONSTRAINT reservation_qty_positive CHECK (qty > 0);
ALTER TABLE material_reservation ADD CONSTRAINT reservation_has_destination
  CHECK (spool_id IS NOT NULL OR tag_id IS NOT NULL OR purpose IS NOT NULL);
ALTER TABLE material_reservation ADD CONSTRAINT reservation_release_says_why
  CHECK (released_at IS NULL OR release_reason IS NOT NULL);
CREATE INDEX material_reservation_item ON material_reservation (item_id) WHERE released_at IS NULL;

CREATE TABLE stock_count (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  count_no    text NOT NULL,
  counted_on  date NOT NULL,
  scope       text,                          -- location or item group counted
  status      text NOT NULL DEFAULT 'open',
  opened_by   uuid REFERENCES app_user(id),
  closed_by   uuid REFERENCES app_user(id),
  closed_at   timestamptz,
  UNIQUE (project_id, count_no)
);
ALTER TABLE stock_count ADD CONSTRAINT stock_count_status CHECK (status IN ('open', 'closed'));

CREATE TABLE stock_count_line (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  count_id         uuid NOT NULL REFERENCES stock_count(id) ON DELETE CASCADE,
  lot_id           uuid NOT NULL REFERENCES material_lot(id),
  system_qty       numeric(14,3) NOT NULL,    -- the book on the count date, when the count was entered
  counted_qty      numeric(14,3) NOT NULL,
  counted_by       text,
  note             text,
  decision         text,                      -- adjust | keep_book
  decision_reason  text,
  decided_by       uuid REFERENCES app_user(id),
  decided_at       timestamptz,
  entered_by       uuid REFERENCES app_user(id),
  entered_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (count_id, lot_id)
);
ALTER TABLE stock_count_line ADD CONSTRAINT count_qty_not_negative CHECK (counted_qty >= 0);
ALTER TABLE stock_count_line ADD CONSTRAINT count_decision_known CHECK (decision IS NULL OR decision IN ('adjust', 'keep_book'));
ALTER TABLE stock_count_line ADD CONSTRAINT count_decision_says_why CHECK (decision IS NULL OR decision_reason IS NOT NULL);

ALTER TABLE material_movement ADD COLUMN reservation_id uuid REFERENCES material_reservation(id);
ALTER TABLE material_movement ADD COLUMN count_line_id uuid REFERENCES stock_count_line(id);
ALTER TABLE material_movement DROP CONSTRAINT movement_kind_known;
ALTER TABLE material_movement ADD CONSTRAINT movement_kind_known CHECK (kind IN ('issue', 'return', 'count_gain', 'count_loss'));
ALTER TABLE material_movement ADD CONSTRAINT movement_count_has_line
  CHECK (kind NOT IN ('count_gain', 'count_loss') OR count_line_id IS NOT NULL);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['material_reservation', 'stock_count', 'stock_count_line'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;

-- The book balance now includes count adjustments; the columns are appended.
CREATE OR REPLACE VIEW reporting.fact_material_lot WITH (security_invoker = true) AS
SELECT l.id AS lot_key, l.project_id AS project_key, i.code AS item_code, i.description, i.category,
       i.uom, l.receipt_no, l.po_ref, l.supplier, l.received_on, l.heat_no, l.mtc_ref, l.mtc_status,
       l.qty_received, l.qty_accepted, l.qty_rejected, l.location,
       COALESCE((SELECT sum(m.qty) FROM material_movement m WHERE m.lot_id = l.id AND m.kind = 'issue'), 0)  AS qty_issued,
       COALESCE((SELECT sum(m.qty) FROM material_movement m WHERE m.lot_id = l.id AND m.kind = 'return'), 0) AS qty_returned,
       COALESCE((SELECT sum(m.qty) FROM material_movement m WHERE m.lot_id = l.id AND m.kind = 'count_gain'), 0) AS qty_count_gain,
       COALESCE((SELECT sum(m.qty) FROM material_movement m WHERE m.lot_id = l.id AND m.kind = 'count_loss'), 0) AS qty_count_loss
  FROM material_lot l JOIN material_item i ON i.id = l.item_id;
