-- ─────────────────────────────────────────────────────────────────────────
-- Document intake, phase 3 (lib/intake/datasheet.mjs): cable and structure
-- numbers join the project's numbering shapes; a reading and its items
-- carry notes — what was printed but could not be used, and why (a
-- pressure with no gauge/absolute reference, two design temperatures, a
-- datasheet not linked to any tag).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE intake_pattern DROP CONSTRAINT intake_pattern_kind_check;
ALTER TABLE intake_pattern ADD CONSTRAINT intake_pattern_kind_check
  CHECK (kind IN ('drawing', 'equipment', 'line', 'instrument', 'subsystem', 'system', 'cable', 'structure'));
ALTER TABLE intake_run ADD COLUMN notes text[] NOT NULL DEFAULT '{}';
ALTER TABLE intake_item ADD COLUMN notes text[] NOT NULL DEFAULT '{}';
