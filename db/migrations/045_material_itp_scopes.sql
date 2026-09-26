-- ─────────────────────────────────────────────────────────────────────────
-- Material receipt is three kinds of work, not one (project review §7).
--
-- migration 034 gave every warehouse lot one scope, 'material' — so an ITP
-- written for pipe (PMI, heat traceability) also held a delivery of cable,
-- and one written for cable's continuity check held a delivery of bolting.
-- A lot's real kind of work is its item's category (lib/warehouse/stock.mjs):
--   material_pressure    pipe, fitting, flange, valve, plate, structural,
--                        bolting — the categories already needing heat/MTC
--                        traceability (TRACEABLE); PMI and pressure-part
--                        checks belong here
--   material_electrical  cable, instrument
--   material_general     everything else (consumable, other)
-- The mapping is lib/inspection/itp.mjs's materialScopeOf; there is nothing
-- to migrate on material_lot or material_item — a lot's scope was never
-- stored, only computed from `scope = 'material'` plus its item's category
-- read separately, so the split changes nothing already on a lot.
--
-- Existing ITP rows are what must be reconciled. An ITP with scope
-- 'material' is moved to 'material_pressure', not split or guessed apart:
-- we cannot know from the row alone which categories it was written to
-- protect, and PMI/heat-traceability holds (this module's worked example,
-- and the likelier reason a project wrote one at all) are the ones whose
-- silent loss would be dangerous — a delivery accepted without the check
-- meant to catch a wrong alloy. Landing on material_general instead would
-- have silently stopped protecting exactly the deliveries most likely to
-- have been the point. A project that actually meant this ITP for cable or
-- for general stores re-points it (or writes a fresh revision) once —
-- loudly, by someone who can see what the ITP's activities actually check,
-- not by this migration guessing from a scope string alone.
-- ─────────────────────────────────────────────────────────────────────────

-- Reassign before swapping the constraint: dropping and re-adding it first
-- would reject the very rows this migration exists to carry forward.
UPDATE itp SET scope = 'material_pressure' WHERE scope = 'material';

ALTER TABLE itp DROP CONSTRAINT itp_scope_known;
ALTER TABLE itp ADD CONSTRAINT itp_scope_known CHECK (
  scope IN ('foundation', 'structure', 'rotating', 'static', 'fired', 'piping_spool', 'cable', 'instrument', 'coating',
            'material_pressure', 'material_electrical', 'material_general'));
