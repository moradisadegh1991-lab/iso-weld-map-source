-- ─────────────────────────────────────────────────────────────────────────
-- Procurement before and after the PO: material requisition with issued
-- revisions, bids and their evaluation, the award that places the PO, and
-- the Vendor Data Template — the vendor's structured data per tag.
--
-- The rules are lib/procurement/tender.mjs. What vendors quoted against,
-- what was awarded on which ranking, and which template a vendor answered
-- are records: issued revisions, awards and template revisions are added,
-- never changed.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE material_requisition (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mr_no        text NOT NULL,
  title        text NOT NULL,
  discipline   text,
  status       text NOT NULL DEFAULT 'draft',
  current_rev  integer,                    -- last issued revision; null before the first issue
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, mr_no)
);
ALTER TABLE material_requisition ADD CONSTRAINT mr_status_known CHECK (status IN ('draft', 'issued', 'awarded', 'cancelled'));

CREATE TABLE mr_line (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mr_id        uuid NOT NULL REFERENCES material_requisition(id) ON DELETE CASCADE,
  line_no      integer NOT NULL,
  item_id      uuid REFERENCES material_item(id),
  tag_id       uuid REFERENCES tag(id),
  description  text,
  qty          numeric(14,3) NOT NULL,
  uom          text NOT NULL,
  need_on      date,
  UNIQUE (mr_id, line_no)
);
ALTER TABLE mr_line ADD CONSTRAINT mr_line_item_xor_tag CHECK ((item_id IS NOT NULL) <> (tag_id IS NOT NULL));
ALTER TABLE mr_line ADD CONSTRAINT mr_line_qty_positive CHECK (qty > 0);

CREATE TABLE mr_revision (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mr_id       uuid NOT NULL REFERENCES material_requisition(id) ON DELETE CASCADE,
  rev         integer NOT NULL,
  reason      text NOT NULL,
  lines       jsonb NOT NULL,              -- the lines as issued: what vendors quote against
  issued_by   uuid REFERENCES app_user(id),
  issued_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (mr_id, rev)
);

CREATE TABLE bid (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mr_id           uuid NOT NULL REFERENCES material_requisition(id) ON DELETE CASCADE,
  vendor_id       uuid NOT NULL REFERENCES vendor(id),
  mr_rev          integer NOT NULL,
  bid_ref         text,
  received_on     date NOT NULL,
  valid_until     date,
  currency        text,
  total_price     numeric(18,2),
  delivery_weeks  integer,
  tech_status     text NOT NULL DEFAULT 'pending',
  tech_note       text,
  tech_by         uuid REFERENCES app_user(id),
  tech_at         timestamptz,
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mr_id, vendor_id, mr_rev)
);
ALTER TABLE bid ADD CONSTRAINT bid_tech_known CHECK (tech_status IN ('pending', 'acceptable', 'not_acceptable'));
ALTER TABLE bid ADD CONSTRAINT bid_rejection_says_why CHECK (tech_status <> 'not_acceptable' OR tech_note IS NOT NULL);
ALTER TABLE bid ADD CONSTRAINT bid_price_positive CHECK (total_price IS NULL OR total_price > 0);

ALTER TABLE purchase_order ADD COLUMN mr_id uuid REFERENCES material_requisition(id);

CREATE TABLE mr_award (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mr_id          uuid NOT NULL UNIQUE REFERENCES material_requisition(id) ON DELETE CASCADE,
  bid_id         uuid NOT NULL REFERENCES bid(id),
  po_id          uuid NOT NULL REFERENCES purchase_order(id),
  justification  text,
  ranking        jsonb NOT NULL,           -- the ranking as it stood when the award was made
  awarded_by     uuid REFERENCES app_user(id),
  awarded_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE vdt_template (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  iso_class   text NOT NULL,
  rev         integer NOT NULL,
  attributes  jsonb NOT NULL,              -- [{key, label, unit, type, required}]
  reason      text NOT NULL,
  by_user     uuid REFERENCES app_user(id),
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, iso_class, rev)
);

CREATE TABLE vdt_submission (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tag_id        uuid NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  template_id   uuid NOT NULL REFERENCES vdt_template(id),
  vendor_ref    text,                      -- the vendor's transmittal / document no.
  values        jsonb NOT NULL,
  submitted_on  date NOT NULL,
  status        text NOT NULL DEFAULT 'submitted',
  review_note   text,
  reviewed_by   uuid REFERENCES app_user(id),
  reviewed_at   timestamptz,
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE vdt_submission ADD CONSTRAINT vdt_status_known CHECK (status IN ('submitted', 'accepted', 'returned'));
ALTER TABLE vdt_submission ADD CONSTRAINT vdt_return_says_why CHECK (status <> 'returned' OR review_note IS NOT NULL);
CREATE INDEX vdt_submission_tag ON vdt_submission (tag_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['material_requisition', 'mr_line', 'mr_revision', 'bid', 'mr_award', 'vdt_template', 'vdt_submission'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;

-- What vendors quoted against, what was awarded, and what a vendor answered stay as they were.
REVOKE UPDATE, DELETE, TRUNCATE ON mr_revision, mr_award, vdt_template FROM app_rw;
