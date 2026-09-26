-- ─────────────────────────────────────────────────────────────────────────
-- Warehouse: materials, lots, movements, and what the MTO requires.
--
-- A lot is one receipt line: one item, one heat, one MTC. Stock is computed
-- from lots and movements (lib/warehouse/stock.mjs), never stored. Where a
-- movement went — a spool, a tag — is recorded because a rejected
-- certificate turns every issue from that lot into a recall.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE material_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code         text NOT NULL,              -- commodity / ident code as the MTO writes it
  description  text NOT NULL,
  category     text NOT NULL,
  uom          text NOT NULL,              -- m, EA, kg … never converted silently
  spec         text,                       -- material spec and grade, e.g. ASTM A106 Gr.B
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
ALTER TABLE material_item ADD CONSTRAINT material_category_known CHECK (category IN
  ('pipe', 'fitting', 'flange', 'valve', 'plate', 'structural', 'bolting', 'cable', 'instrument', 'consumable', 'other'));

CREATE TABLE material_lot (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES material_item(id),
  receipt_no     text NOT NULL,            -- MRR / goods receipt
  po_ref         text,
  supplier       text,
  received_on    date NOT NULL,
  heat_no        text,
  mtc_ref        text,
  mtc_status     text NOT NULL DEFAULT 'pending',
  qty_received   numeric(14,3) NOT NULL,
  qty_accepted   numeric(14,3),            -- NULL until the MIR decides
  qty_rejected   numeric(14,3),
  mir_ref        text,
  inspected_on   date,
  location       text,
  recorded_by    uuid REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX material_lot_item_idx ON material_lot (item_id);
CREATE INDEX material_lot_heat_idx ON material_lot (project_id, heat_no);
ALTER TABLE material_lot ADD CONSTRAINT lot_qty_positive CHECK (qty_received > 0);
ALTER TABLE material_lot ADD CONSTRAINT lot_inspection_fits CHECK (
  (qty_accepted IS NULL OR qty_accepted >= 0) AND (qty_rejected IS NULL OR qty_rejected >= 0)
  AND COALESCE(qty_accepted, 0) + COALESCE(qty_rejected, 0) <= qty_received);
ALTER TABLE material_lot ADD CONSTRAINT lot_mtc_status_known
  CHECK (mtc_status IN ('pending', 'accepted', 'rejected'));

CREATE TABLE material_movement (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  lot_id        uuid NOT NULL REFERENCES material_lot(id),
  kind          text NOT NULL,
  qty           numeric(14,3) NOT NULL,
  moved_on      date NOT NULL,
  ref_no        text,                      -- MIV / return note
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  spool_id      uuid REFERENCES spool(id) ON DELETE SET NULL,
  tag_id        uuid REFERENCES tag(id) ON DELETE SET NULL,
  purpose       text,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX material_movement_lot_idx ON material_movement (lot_id);
ALTER TABLE material_movement ADD CONSTRAINT movement_kind_known CHECK (kind IN ('issue', 'return'));
ALTER TABLE material_movement ADD CONSTRAINT movement_qty_positive CHECK (qty > 0);

CREATE TABLE material_requirement (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES material_item(id) ON DELETE CASCADE,
  qty          numeric(14,3) NOT NULL,
  source       text NOT NULL,              -- the MTO and its revision
  line_id      uuid REFERENCES line(id) ON DELETE SET NULL,
  tag_id       uuid REFERENCES tag(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, item_id, source)
);
ALTER TABLE material_requirement ADD CONSTRAINT requirement_qty_positive CHECK (qty > 0);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['material_item', 'material_lot', 'material_movement', 'material_requirement'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- Movements are the ledger: corrected by a counter-movement, never edited.
REVOKE UPDATE, DELETE, TRUNCATE ON material_movement FROM app_rw;
GRANT SELECT, INSERT ON material_movement TO app_rw;
GRANT SELECT ON material_item, material_lot, material_movement, material_requirement TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_material_lot WITH (security_invoker = true) AS
SELECT l.id AS lot_key, l.project_id AS project_key, i.code AS item_code, i.description, i.category,
       i.uom, l.receipt_no, l.po_ref, l.supplier, l.received_on, l.heat_no, l.mtc_ref, l.mtc_status,
       l.qty_received, l.qty_accepted, l.qty_rejected, l.location,
       COALESCE((SELECT sum(m.qty) FROM material_movement m WHERE m.lot_id = l.id AND m.kind = 'issue'), 0)  AS qty_issued,
       COALESCE((SELECT sum(m.qty) FROM material_movement m WHERE m.lot_id = l.id AND m.kind = 'return'), 0) AS qty_returned
  FROM material_lot l JOIN material_item i ON i.id = l.item_id;

CREATE VIEW reporting.fact_material_movement WITH (security_invoker = true) AS
SELECT m.id AS movement_key, m.project_id AS project_key, m.lot_id AS lot_key, m.kind, m.qty,
       m.moved_on, m.ref_no, m.contractor_id AS contractor_key, m.spool_id AS spool_key, m.tag_id AS tag_key
  FROM material_movement m;

GRANT SELECT ON reporting.fact_material_lot, reporting.fact_material_movement TO app_rw, app_report;
