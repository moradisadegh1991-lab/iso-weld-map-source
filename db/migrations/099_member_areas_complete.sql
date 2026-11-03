-- The work areas a member can be given (lib/platform/areas.mjs AREAS) are eighteen; the check from 033 knew fifteen.
-- «contracts», «finance» and «hr» could not be stored, so a member narrowed to areas could never be given the contracts,
-- finance or HR desk and was shut out of those routes for good. The check is widened — nothing a row holds today is
-- refused or changed (every existing value is still in the list).
ALTER TABLE project_member DROP CONSTRAINT member_areas_known;
ALTER TABLE project_member ADD CONSTRAINT member_areas_known CHECK (areas <@ ARRAY[
  'piping', 'civil', 'structural', 'equipment', 'electrical', 'instrumentation', 'coating', 'quality',
  'completions', 'hse', 'controls', 'procurement', 'warehouse', 'documents', 'handover',
  'contracts', 'finance', 'hr']::text[]);
