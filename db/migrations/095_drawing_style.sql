-- ─────────────────────────────────────────────────────────────────────────
-- A drawing style's template (owner's choice of 2026-11-01: «automatic, plus
-- a saved template per style»): where one designer's isometrics print each
-- title-block value, marked once by a person on one sheet of the style.
--
--   drawing_style   one per project and name. `fingerprint` is the words the
--                   title block of that sheet prints (its labels and
--                   headings, as tools/iso-read.py read them); a later sheet
--                   whose words are at least half the same is read by this
--                   template. `fields` maps a value's key (drawingNo, sheet,
--                   rev, lineNo, testPressure, …) to its cell on the page:
--                   { "box": [x0, y0, x1, y1] } as fractions of the page as
--                   rendered. The value itself is never stored: every sheet's
--                   own cell is read, and kept only when its readings agree.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE drawing_style (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  fingerprint  text[] NOT NULL CHECK (cardinality(fingerprint) BETWEEN 1 AND 600),
  fields       jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'object'),
  sample       text CHECK (sample IS NULL OR length(sample) <= 200),
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES app_user(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

ALTER TABLE drawing_style ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawing_style FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON drawing_style USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON drawing_style TO app_rw;
GRANT SELECT ON drawing_style TO app_report;
