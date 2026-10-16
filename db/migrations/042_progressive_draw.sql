-- ─────────────────────────────────────────────────────────────────────────
-- ASME B31.3 §341.3.4 progressive examination: the additional welds are
-- drawn with a seed and recorded, like the random sample itself, so the
-- lot is judged on welds nobody chose. Rules: lib/ndt/compliance.mjs.
-- One draw per lot (line · method · welder) and tier; never changed.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE ndt_progressive_draw (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  line_id        uuid NOT NULL REFERENCES line(id) ON DELETE CASCADE,
  method         ndt_method NOT NULL,
  welder_id      uuid NOT NULL REFERENCES welder(id),
  tier           text NOT NULL,
  defect_uids    text[] NOT NULL,             -- the rejected welds this tier answers for
  selected_uids  text[] NOT NULL,
  seed           text NOT NULL,
  drawn_by       uuid REFERENCES app_user(id),
  drawn_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (line_id, method, welder_id, tier)
);
ALTER TABLE ndt_progressive_draw ADD CONSTRAINT progressive_tier CHECK (tier IN ('a', 'b'));

ALTER TABLE ndt_progressive_draw ENABLE ROW LEVEL SECURITY;
ALTER TABLE ndt_progressive_draw FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON ndt_progressive_draw USING (project_id = current_project_id())
  WITH CHECK (project_id = current_project_id());
GRANT SELECT, INSERT ON ndt_progressive_draw TO app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON ndt_progressive_draw FROM app_rw;
GRANT SELECT ON ndt_progressive_draw TO app_report;
