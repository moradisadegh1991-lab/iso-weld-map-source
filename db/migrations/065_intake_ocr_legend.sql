-- ─────────────────────────────────────────────────────────────────────────
-- Document intake, phase 2 (lib/intake/ocr.mjs, lib/intake/legend.mjs).
--
-- OCR      a scan is read by OCR. A reading that waits in the OCR queue is
--          its own run ('queued'); the result is a NEW run — runs stay
--          records, nothing on them is rewritten.
--          Every OCR'd number carries the engine's confidence; a number read
--          unsurely, read only after swapping a confusable character, or one
--          misread away from a number the register holds is "to be checked":
--          applied only with a reason.
-- legend   the project's P&ID legend: how a line number is built, and the
--          fluid and insulation codes it uses. Typed by a person from the
--          legend sheet; a code not in it is reported, never filled.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE intake_run DROP CONSTRAINT intake_run_method_check;
ALTER TABLE intake_run ADD CONSTRAINT intake_run_method_check CHECK (method IN ('pdf-text', 'xlsx', 'ocr', 'none'));
ALTER TABLE intake_run DROP CONSTRAINT intake_run_status_check;
ALTER TABLE intake_run ADD CONSTRAINT intake_run_status_check CHECK (status IN ('read', 'needs-ocr', 'queued', 'unsupported', 'failed'));
ALTER TABLE intake_run ADD COLUMN engine text;          -- e.g. "tesseract 5.3.4"
ALTER TABLE intake_run ADD COLUMN ocr_pages int[] NOT NULL DEFAULT '{}';
ALTER TABLE intake_run ADD COLUMN ocr_conf numeric;     -- mean word confidence over the OCR'd pages, 0..1

ALTER TABLE intake_item ADD COLUMN confidence numeric;  -- OCR only; null = read from a text layer or a table
ALTER TABLE intake_item ADD COLUMN ocr_read text;       -- the characters printed, when a confusable one was swapped
ALTER TABLE intake_item ADD COLUMN suspect text;        -- the register number this one may be a misread of
ALTER TABLE intake_item ADD COLUMN checks text[] NOT NULL DEFAULT '{}';
ALTER TABLE intake_item ADD COLUMN unknown_codes jsonb NOT NULL DEFAULT '{}';
ALTER TABLE intake_item ADD CONSTRAINT intake_item_check_needs_reason
  CHECK (decision <> 'applied' OR cardinality(checks) = 0 OR action = 'same' OR reason IS NOT NULL);

ALTER TABLE line ADD COLUMN fluid_code text;

CREATE TABLE intake_line_format (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL UNIQUE REFERENCES project(id) ON DELETE CASCADE,
  format      text NOT NULL CHECK (length(btrim(format)) > 0),
  example     text,
  source      text,                  -- the legend sheet it was taken from
  updated_by  uuid REFERENCES app_user(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legend_code (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('fluid', 'insulation')),
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  meaning     text NOT NULL CHECK (length(btrim(meaning)) > 0),
  source      text,
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind, code)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['intake_line_format', 'legend_code'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;
GRANT SELECT ON intake_line_format, legend_code TO app_report;
