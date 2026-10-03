-- How this project's isometrics draw a shop weld and a field weld.
--
-- Many designers print every joint number on the sheet inside a frame whose
-- SHAPE says where it is welded: a circle in the shop, a square in the field
-- (and the square of a field-fit weld annotated FFW). The extraction pass
-- reports the shape it sees; which shape means which is this project's
-- drawing convention, declared here by a person — never assumed. Until both
-- are declared, a register read from printed markers carries no Shop/Field.
ALTER TABLE project
  ADD COLUMN weld_symbol_shop  text CHECK (weld_symbol_shop  IN ('circle', 'square', 'diamond', 'hexagon')),
  ADD COLUMN weld_symbol_field text CHECK (weld_symbol_field IN ('circle', 'square', 'diamond', 'hexagon')),
  -- Whether these drawings print "THD" beside EVERY threaded joint. Declared,
  -- it lets an unlabelled joint among socket welds and threaded fittings of
  -- one size be read as a socket weld; undeclared, that joint's type is left
  -- for a person.
  ADD COLUMN weld_thd_labelled boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT project_weld_symbols_differ CHECK (weld_symbol_shop IS DISTINCT FROM weld_symbol_field OR weld_symbol_shop IS NULL);
