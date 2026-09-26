-- A requisition line says whether the item needs a factory acceptance test,
-- and the PO line the award makes carries it.
--
-- Before this, a PO created by awarding an MR never required FAT and could
-- not be made to: a pump bought through a tender shipped without the
-- inspection the equipment spec asks for. Found by the DM-water pump
-- scenario (lib/scenario/dm-pump.mjs). Existing lines stay false — what an
-- issued revision said is not rewritten.

ALTER TABLE mr_line ADD COLUMN fat_required boolean NOT NULL DEFAULT false;
