-- ─────────────────────────────────────────────────────────────────────────
-- Repair for 045: carry an existing 'material' ITP forward to
-- 'material_pressure' on a database that has one.
--
-- 045 as released reassigns the rows first and swaps the constraint after.
-- On a database with no 'material' ITP that is harmless (nothing to move),
-- and 045 applied there. On a database WITH one it cannot succeed:
--   · the old constraint (034) does not know 'material_pressure', and
--   · itp_fixed (030) refuses any change of scope on an approved ITP.
-- It rolled back there and was never recorded. 045 is not edited — where it
-- did apply, its recorded checksum must keep matching — so this runs
-- before it (the name sorts between 044 and 045) and leaves it nothing to do.
--
-- It is written for both histories:
--   before 045   rows are reassigned and the new constraint installed; 045
--                then updates nothing and drops/re-adds the same constraint.
--   after 045    no 'material' row can exist; the constraint is replaced by
--                itself and the update matches nothing.
--
-- Order: the old constraint is dropped first, so there is nothing to
-- violate while rows are reassigned, and the new one is added only once
-- every row satisfies it. The trigger is disabled for the one statement:
-- this is not someone editing a signed-off ITP, it is the schema catching
-- up with which deliveries the ITP was always about (see 045 for why
-- material_pressure). Row level security is lifted for the same statement,
-- as 012 does: run by an owner that is not a superuser, the update would
-- otherwise see no project and move nothing.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE itp DROP CONSTRAINT itp_scope_known;

ALTER TABLE itp NO FORCE ROW LEVEL SECURITY;
ALTER TABLE itp DISABLE TRIGGER itp_fixed;
UPDATE itp SET scope = 'material_pressure' WHERE scope = 'material';
ALTER TABLE itp ENABLE TRIGGER itp_fixed;
ALTER TABLE itp FORCE ROW LEVEL SECURITY;

ALTER TABLE itp ADD CONSTRAINT itp_scope_known CHECK (
  scope IN ('foundation', 'structure', 'rotating', 'static', 'fired', 'piping_spool', 'cable', 'instrument', 'coating',
            'material_pressure', 'material_electrical', 'material_general'));
