-- ─────────────────────────────────────────────────────────────────────────
-- Material receipt inspection under the ITP.
--
-- A lot received into the warehouse (one receipt line: one item, one heat,
-- one MTC) becomes an item an ITP can be written for and an inspection
-- request raised against. Its two steps are the warehouse's own records:
--   mir         the Material Inspection Report — accepted and rejected qty;
--   mtc_review  QC's review of the mill certificate.
-- A Hold or Witness on either stops ACCEPTING it until the request is
-- released (lib/db/repos/warehouse.mjs asks lib/db/repos/inspection.mjs).
-- Rejecting material is never held: stopping bad material is not the step
-- an inspector holds.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE itp DROP CONSTRAINT itp_scope_known;
ALTER TABLE itp ADD CONSTRAINT itp_scope_known CHECK (
  scope IN ('foundation', 'structure', 'rotating', 'static', 'fired', 'piping_spool', 'cable', 'instrument', 'coating',
            'material'));

ALTER TABLE inspection_request DROP CONSTRAINT ir_item_kind_known;
ALTER TABLE inspection_request ADD CONSTRAINT ir_item_kind_known CHECK (
  item_kind IN ('tag', 'spool', 'cable', 'instrument', 'coating_item', 'lot'));
