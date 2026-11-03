-- A project's choice (owner's decision, 2026-11-03): receive goods against a PO only from a shipment that has been
-- recorded AND has arrived. Off by default: a direct PO, a local purchase, material collected by the site are received
-- against the order alone, as they always were. Additive; no row changes.
ALTER TABLE project ADD COLUMN receipt_needs_shipment boolean NOT NULL DEFAULT false;
