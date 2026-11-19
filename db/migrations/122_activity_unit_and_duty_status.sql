-- An activity may override the unit inherited from its WBS node.
ALTER TABLE wbs_activity ADD COLUMN unit text;

-- Current workflow assignments can be disabled without deleting their history.
ALTER TABLE duty ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE duty_member ADD COLUMN active boolean NOT NULL DEFAULT true;
