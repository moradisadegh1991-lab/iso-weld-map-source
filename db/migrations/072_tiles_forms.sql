-- ─────────────────────────────────────────────────────────────────────────
-- Tiles and handover forms (owner's request 2026-10-16):
--
-- project_member.tiles   the tiles (pages) a member is given. Empty: the
--                        member's role decides, as before. Not empty: the
--                        member sees only these tiles, and the server answers
--                        only the API routes those tiles use (lib/platform/
--                        tiles.mjs). A project admin or developer is never
--                        narrowed.
-- report_type.form       a handover form a section's employer supervision
--                        designs: header fields, the table's columns, and
--                        whether its rows come from the work the employer
--                        accepted that day. Null for the built-in report
--                        types (DR, CR), whose content has its own code.
-- report_type.section    the work area the form belongs to (AREAS keys)
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE project_member ADD COLUMN tiles text[] NOT NULL DEFAULT '{}';

ALTER TABLE report_type ADD COLUMN form jsonb;
ALTER TABLE report_type ADD COLUMN section text;
ALTER TABLE report_type ADD COLUMN designed_by uuid REFERENCES app_user(id);
ALTER TABLE report_type ADD CONSTRAINT report_type_form_section CHECK (form IS NULL OR section IS NOT NULL);
