-- ─────────────────────────────────────────────────────────────────────────
-- Painting and insulation.
--
-- A painting SYSTEM is the specification (surface preparation grade and
-- profile, coats with their nominal DFT, maximum DFT). A coating ITEM is one
-- spool or one tag (a structure, a vessel) with a system and, where
-- required, an insulation class and thickness. The records are what the
-- inspector measured; every verdict is lib/coating/coating.mjs.
--
-- The one ordering the code imposes across disciplines: ASME B31.3
-- §345.3.1 lets joints be primed and painted before the leak test, but not
-- insulated. The repository holds a spool's insulation step until the
-- spool's test is recorded, and the spool chain does not flag paint applied
-- before the test on an uninsulated spool.
-- ─────────────────────────────────────────────────────────────────────────

-- Painting and insulation contractors are a trade of their own on an EPC
-- job; their packages need a discipline to be filed under. (A new enum value
-- may be added in a transaction as long as it is not used in the same one.)
ALTER TYPE discipline ADD VALUE IF NOT EXISTS 'coating';

-- The dew-point margin, when the project's spec differs from the usual 3 °C,
-- and the RH limit, which has no default (product data sheets differ).
ALTER TABLE project
  ADD COLUMN coating_dewpoint_margin_c numeric(4,1),
  ADD COLUMN coating_max_rh_pct        numeric(4,1);

CREATE TABLE coating_system (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code            text NOT NULL,
  title           text,
  prep_grade      text NOT NULL,
  profile_min_um  numeric(5,1),
  profile_max_um  numeric(5,1),
  coats           jsonb NOT NULL,            -- [{name, ndft_um}], in application order
  max_dft_um      numeric(6,1),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
ALTER TABLE coating_system ADD CONSTRAINT coating_system_coats
  CHECK (jsonb_typeof(coats) = 'array' AND jsonb_array_length(coats) BETWEEN 1 AND 5);

CREATE TABLE coating_item (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  spool_id           uuid REFERENCES spool(id) ON DELETE CASCADE,
  tag_id             uuid REFERENCES tag(id) ON DELETE CASCADE,
  system_id          uuid NOT NULL REFERENCES coating_system(id),
  insulation         text NOT NULL DEFAULT 'none',
  insulation_thk_mm  numeric(6,1),
  area_m2            numeric(10,2),
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE coating_item ADD CONSTRAINT coating_item_one_owner CHECK ((spool_id IS NULL) <> (tag_id IS NULL));
ALTER TABLE coating_item ADD CONSTRAINT coating_item_insulation_known
  CHECK (insulation IN ('none', 'hot', 'cold', 'personnel'));
ALTER TABLE coating_item ADD CONSTRAINT coating_item_insulation_thickness
  CHECK (insulation = 'none' OR insulation_thk_mm > 0);
CREATE UNIQUE INDEX coating_item_spool_uq ON coating_item (project_id, spool_id) WHERE spool_id IS NOT NULL;
CREATE UNIQUE INDEX coating_item_tag_uq ON coating_item (project_id, tag_id) WHERE tag_id IS NOT NULL;

-- What the inspector measured. `data` by kind:
--   prep:       {grade, profile: [µm]}
--   coat:       {airC, rh, steelC, readings: [µm, cumulative]}
--   insulation: {thicknessMm: [mm]}
-- The latest record of a kind (and coat) decides; clock_timestamp() so two
-- entered in one request do not tie.
CREATE TABLE coating_record (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES coating_item(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  coat_no       int,
  data          jsonb NOT NULL,
  recorded_on   date NOT NULL,
  inspector     text,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX coating_record_item_idx ON coating_record (item_id);
ALTER TABLE coating_record ADD CONSTRAINT coating_record_kind CHECK (kind IN ('prep', 'coat', 'insulation'));
ALTER TABLE coating_record ADD CONSTRAINT coating_record_coat_no CHECK (kind <> 'coat' OR coat_no >= 1);

CREATE TABLE coating_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES coating_item(id) ON DELETE CASCADE,
  code          text NOT NULL,
  status        activity_status NOT NULL,
  done_at       date,
  ref_no        text,
  note          text,
  contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL,
  recorded_by   uuid REFERENCES app_user(id),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, item_id, code)
);
ALTER TABLE coating_activity ADD CONSTRAINT coating_done_is_dated
  CHECK (status <> 'done' OR done_at IS NOT NULL);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coating_system', 'coating_item', 'coating_record', 'coating_activity'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON coating_system, coating_item, coating_record, coating_activity TO app_rw;
GRANT SELECT ON coating_system, coating_item, coating_record, coating_activity TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.fact_coating WITH (security_invoker = true) AS
SELECT ci.id AS coating_key, ci.project_id AS project_key, ci.spool_id AS spool_key, ci.tag_id AS tag_key,
       cs.code AS system_code, ci.insulation, ci.insulation_thk_mm, ci.area_m2,
       EXISTS (SELECT 1 FROM coating_activity a WHERE a.item_id = ci.id
                 AND a.code = 'ready' AND a.status = 'done') AS is_ready
  FROM coating_item ci JOIN coating_system cs ON cs.id = ci.system_id;

GRANT SELECT ON reporting.fact_coating TO app_rw, app_report;

-- ── the spool's headline reads the coating sign-off ──────────────────────
--
-- The spool's "painted" step is answered by its coating item once it has
-- one, in the engine and here alike (db/test/execution.mjs holds the two
-- together). Otherwise unchanged from 012.
CREATE OR REPLACE VIEW reporting.spool_stage WITH (security_invoker = true) AS
WITH w AS (
  SELECT wd.spool_id,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Shop')                                   AS shop_n,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Shop' AND e.weld_uid IS NOT NULL)        AS shop_welded,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Shop' AND n.first_result IS NOT NULL)    AS shop_examined,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Field')                                  AS field_n,
         COUNT(*) FILTER (WHERE wd.shop_field = 'Field' AND e.weld_uid IS NOT NULL
                                                        AND n.first_result IS NOT NULL)   AS field_done,
         COUNT(*) FILTER (WHERE e.weld_uid IS NOT NULL)                                   AS any_welded
    FROM weld wd
    LEFT JOIN weld_execution e ON e.weld_uid = wd.weld_uid AND e.project_id = wd.project_id
    LEFT JOIN LATERAL (
          SELECT MAX(r.result::text) FILTER (WHERE r.repair_cycle = 0) AS first_result
            FROM ndt_record r
           WHERE r.weld_uid = wd.weld_uid AND r.project_id = wd.project_id
         ) n ON true
   WHERE wd.spool_id IS NOT NULL
   GROUP BY wd.spool_id
),
-- The coating module's sign-off: `ready` on the spool's coating item is
-- refused while any coating step is open, so it stands for "painted (and
-- insulated, where required) and accepted".
-- Once a spool HAS a coating item, only that sign-off counts: a "painted"
-- ticked by hand before the item existed is ignored, as the engine ignores it.
c AS (
  SELECT ci.spool_id,
         EXISTS (SELECT 1 FROM coating_activity ca WHERE ca.item_id = ci.id
                   AND ca.code = 'ready' AND ca.status = 'done') AS coated
    FROM coating_item ci
   WHERE ci.spool_id IS NOT NULL
),
a AS (
  SELECT spool_id,
         bool_or(code = 'released' AND status = 'done') AS released,
         bool_or(code = 'fit_up'   AND status = 'done') AS fit_up,
         bool_or(code = 'erected'  AND status = 'done') AS erected,
         bool_or(code = 'supports' AND status = 'done') AS supports,
         bool_or(code = 'test'     AND status = 'done') AS tested,
         bool_or(code = 'painted'  AND status = 'done') AS painted,
         bool_or(code = 'ready'    AND status = 'done') AS ready,
         -- Anything past release, done or under way, means steel exists.
         bool_or(code <> 'released')                    AS physical
    FROM spool_activity
   GROUP BY spool_id
),
s AS (
  SELECT sp.id, sp.project_id, sp.line_id, sp.extraction_run_id, sp.spool_no,
         CASE
           WHEN a.ready    THEN 'ready'
           WHEN CASE WHEN c.spool_id IS NOT NULL THEN c.coated ELSE a.painted END THEN 'painted'
           WHEN a.tested   THEN 'test'
           WHEN a.supports THEN 'supports'
           WHEN w.field_n > 0 AND w.field_done = w.field_n     THEN 'field_weld'
           WHEN a.erected  THEN 'erected'
           WHEN w.shop_n > 0 AND w.shop_examined = w.shop_n    THEN 'shop_ndt'
           WHEN w.shop_n > 0 AND w.shop_welded = w.shop_n      THEN 'shop_weld'
           WHEN a.fit_up   THEN 'fit_up'
           WHEN a.released THEN 'released'
           ELSE 'planned'
         END AS stage,
         (COALESCE(w.any_welded, 0) > 0 OR COALESCE(a.physical, false)) AS built
    FROM spool sp
    LEFT JOIN w ON w.spool_id = sp.id
    LEFT JOIN a ON a.spool_id = sp.id
    LEFT JOIN c ON c.spool_id = sp.id
)
SELECT s.id AS spool_key, s.project_id AS project_key, s.line_id AS line_key,
       s.extraction_run_id AS run_key, s.spool_no, s.stage,
       -- For sorting in a report: position in the chain, 0 = still on paper.
       array_position(ARRAY['planned','released','fit_up','shop_weld','shop_ndt',
                            'erected','field_weld','supports','test','painted','ready'],
                      s.stage) - 1 AS stage_seq,
       s.built
  FROM s;
