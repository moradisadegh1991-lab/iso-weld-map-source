-- ─────────────────────────────────────────────────────────────────────────
-- Procurement and expediting: vendors, purchase orders and their lines,
-- forecast history, shop inspection (FAT) and release, shipments, receipt
-- into the warehouse against the PO line, and the vendor document list.
--
-- The rules are lib/procurement/procurement.mjs.
-- ─────────────────────────────────────────────────────────────────────────

-- How long a vendor has to resubmit a document returned code 3. Contract
-- terms; no default.
ALTER TABLE project ADD COLUMN vdrl_resubmit_days integer;
ALTER TABLE project ADD CONSTRAINT vdrl_resubmit_positive CHECK (vdrl_resubmit_days IS NULL OR vdrl_resubmit_days > 0);

CREATE TABLE vendor (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  country     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

CREATE TABLE purchase_order (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  po_no       text NOT NULL,
  vendor_id   uuid NOT NULL REFERENCES vendor(id),
  title       text NOT NULL,
  currency    text,                       -- the PO's own; never converted here
  placed_on   date NOT NULL,
  status      text NOT NULL DEFAULT 'placed',
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, po_no)
);
ALTER TABLE purchase_order ADD CONSTRAINT po_status_known CHECK (status IN ('placed', 'cancelled'));

-- A line buys a stock item OR a tagged item, never both and never neither:
-- a PO line with only a free-text description is a tag list of its own.
CREATE TABLE po_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  po_id         uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  line_no       integer NOT NULL,
  item_id       uuid REFERENCES material_item(id),
  tag_id        uuid REFERENCES tag(id),
  description   text,
  qty           numeric(14,3) NOT NULL,
  uom           text NOT NULL,
  unit_price    numeric(16,2),
  promised_on   date,
  forecast_on   date,
  need_on       date,
  fat_required  boolean NOT NULL DEFAULT false,
  UNIQUE (po_id, line_no)
);
ALTER TABLE po_line ADD CONSTRAINT po_line_item_xor_tag CHECK ((item_id IS NOT NULL) <> (tag_id IS NOT NULL));
ALTER TABLE po_line ADD CONSTRAINT po_line_qty_positive CHECK (qty > 0);

-- Every forecast the expeditor gives, with its source: a slip that happened
-- in four small steps is the same slip, and the steps are the story.
CREATE TABLE po_forecast (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  po_line_id   uuid NOT NULL REFERENCES po_line(id) ON DELETE CASCADE,
  forecast_on  date NOT NULL,
  source       text NOT NULL,             -- vendor progress report, call, visit
  by_user      uuid REFERENCES app_user(id),
  at           timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE fat_record (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  po_line_id    uuid NOT NULL REFERENCES po_line(id) ON DELETE CASCADE,
  inspected_on  date NOT NULL,
  result        text NOT NULL,
  irn_no        text,
  inspector     text,
  note          text,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE fat_record ADD CONSTRAINT fat_result_known CHECK (result IN ('pass', 'fail', 'waived'));
ALTER TABLE fat_record ADD CONSTRAINT fat_release_has_irn CHECK (result = 'fail' OR irn_no IS NOT NULL);

CREATE TABLE shipment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  shipment_no  text NOT NULL,             -- packing list / B/L / AWB
  po_id        uuid NOT NULL REFERENCES purchase_order(id),
  mode         text,
  shipped_on   date NOT NULL,
  eta_on       date,
  arrived_on   date,
  recorded_by  uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, shipment_no)
);
ALTER TABLE shipment ADD CONSTRAINT shipment_arrives_after_leaving CHECK (arrived_on IS NULL OR arrived_on >= shipped_on);

CREATE TABLE shipment_line (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  shipment_id  uuid NOT NULL REFERENCES shipment(id) ON DELETE CASCADE,
  po_line_id   uuid NOT NULL REFERENCES po_line(id),
  qty          numeric(14,3) NOT NULL,
  UNIQUE (shipment_id, po_line_id)
);
ALTER TABLE shipment_line ADD CONSTRAINT shipment_qty_positive CHECK (qty > 0);

-- Receipt into the warehouse against the PO line it fulfils.
ALTER TABLE material_lot ADD COLUMN po_line_id uuid REFERENCES po_line(id);

CREATE TABLE vendor_document (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  po_id       uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  doc_code    text NOT NULL,              -- the VDRL code: GA, DS, IOM, DOSSIER …
  title       text NOT NULL,
  due_on      date,
  before_fat  boolean NOT NULL DEFAULT false,
  UNIQUE (po_id, doc_code)
);

CREATE TABLE vendor_doc_submission (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  doc_id        uuid NOT NULL REFERENCES vendor_document(id) ON DELETE CASCADE,
  revision      text NOT NULL,
  submitted_on  date NOT NULL,
  returned_on   date,
  review_code   smallint,
  comment       text,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE vendor_doc_submission ADD CONSTRAINT review_code_known CHECK (review_code IS NULL OR review_code BETWEEN 1 AND 4);
ALTER TABLE vendor_doc_submission ADD CONSTRAINT review_is_dated CHECK ((review_code IS NULL) = (returned_on IS NULL));
ALTER TABLE vendor_doc_submission ADD CONSTRAINT returned_after_submitted CHECK (returned_on IS NULL OR returned_on >= submitted_on);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vendor', 'purchase_order', 'po_line', 'po_forecast', 'fat_record', 'shipment',
                           'shipment_line', 'vendor_document', 'vendor_doc_submission'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- The expediting log and inspection records are evidence.
REVOKE UPDATE, DELETE, TRUNCATE ON po_forecast, fat_record FROM app_rw;
GRANT SELECT, INSERT ON po_forecast, fat_record TO app_rw;
GRANT SELECT ON vendor, purchase_order, po_line, po_forecast, fat_record, shipment, shipment_line,
                vendor_document, vendor_doc_submission TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_po_line WITH (security_invoker = true) AS
SELECT l.id AS po_line_key, l.project_id AS project_key, o.po_no, v.code AS vendor_code, l.line_no,
       l.item_id AS item_key, l.tag_id AS tag_key, l.qty, l.uom, l.unit_price, o.currency,
       l.promised_on, l.forecast_on, l.need_on, l.fat_required,
       (SELECT COALESCE(sum(sl.qty), 0) FROM shipment_line sl WHERE sl.po_line_id = l.id) AS shipped_qty,
       CASE WHEN l.item_id IS NOT NULL
            THEN (SELECT COALESCE(sum(m.qty_received), 0) FROM material_lot m WHERE m.po_line_id = l.id)
            ELSE (SELECT COALESCE(sum(sl.qty), 0) FROM shipment_line sl JOIN shipment s ON s.id = sl.shipment_id
                   WHERE sl.po_line_id = l.id AND s.arrived_on IS NOT NULL) END AS received_qty,
       (COALESCE(l.forecast_on, l.promised_on) - l.promised_on) AS slip_days,
       (l.need_on - COALESCE(l.forecast_on, l.promised_on)) AS float_days
  FROM po_line l JOIN purchase_order o ON o.id = l.po_id JOIN vendor v ON v.id = o.vendor_id
 WHERE o.status = 'placed';

CREATE VIEW reporting.fact_vendor_document WITH (security_invoker = true) AS
SELECT d.id AS doc_key, d.project_id AS project_key, o.po_no, d.doc_code, d.title, d.due_on, d.before_fat,
       s.revision AS last_revision, s.submitted_on AS last_submitted_on, s.review_code AS last_code, s.returned_on AS last_returned_on
  FROM vendor_document d JOIN purchase_order o ON o.id = d.po_id
  LEFT JOIN LATERAL (SELECT * FROM vendor_doc_submission x WHERE x.doc_id = d.id ORDER BY x.created_at DESC LIMIT 1) s ON true;

GRANT SELECT ON reporting.fact_po_line, reporting.fact_vendor_document TO app_rw, app_report;
