-- ─────────────────────────────────────────────────────────────────────────
-- The cross-discipline spine · tag, system, subsystem
--
-- WHY THIS EXISTS, AND WHY IT COMES BEFORE THE OTHER MODULES
--
-- A modular platform fails in exactly one way: each module gets its own idea
-- of what a thing belongs to, and then nothing joins. Piping hangs its welds
-- off a `line`. Electrical has no line — it has cables. Civil has no line —
-- it has foundations. If each one invents its own parent, the project ends
-- up with six correct databases and no answer to the only question a project
-- manager actually asks:
--
--     "ساب‌سیستم ۲۱-۰۱ برای MC آماده است یا نه؟"
--
-- and the answer gets assembled in Excel, by hand, every Thursday — which is
-- the work this whole platform exists to remove.
--
-- So the join is declared once, here, while only one module exists and it is
-- still cheap. Every discipline's item hangs off a TAG; every tag belongs to
-- a SUBSYSTEM; a subsystem is what gets mechanically completed and handed
-- over. That is the commissioning breakdown every EPC project already runs
-- on, so this is not a new concept imposed on the work — it is the one the
-- work already uses, finally written down where software can read it.
--
-- NOTE ON ORDERING: the ecosystem plan (docs/epc-llm/05-ecosystem-plan.md)
-- puts the spine at module 5, reasoning that it is first needed for MC
-- readiness. That is a module too late. A daily progress report — module 3 —
-- says "۱۲ جوش در ساب‌سیستم ۲۱ انجام شد", and without this table there is
-- nowhere to post it. The plan has been corrected.
-- ─────────────────────────────────────────────────────────────────────────

-- Kept in step with lib/platform/modules.mjs by db/test/spine.mjs, which
-- fails if a module is declared there with no discipline here. A registry
-- and an enum that disagree is how a module ships that can never be filed.
CREATE TYPE discipline AS ENUM (
  'piping', 'structural', 'electrical', 'instrumentation', 'civil', 'equipment'
);

-- ── the handover unit ────────────────────────────────────────────────────
--
-- `system_code` is carried rather than modelled as its own table. A system is
-- a grouping of subsystems and nothing else — it has no dates, no status and
-- no documents of its own — so a table for it would be a join that buys
-- nothing. If a system ever acquires its own attributes, it earns a table
-- then.

CREATE TABLE subsystem (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  unit_id         uuid REFERENCES unit(id) ON DELETE SET NULL,
  system_code     text NOT NULL,
  code            text NOT NULL,
  name            text,
  -- The order the project intends to hand over in. Progress against a
  -- subsystem nobody needs for six months is not the same news as progress
  -- against the one blocking start-up, and a report that cannot tell them
  -- apart gets read as a single number.
  handover_seq    int,
  target_mc_date  date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

-- ── the thing every discipline hangs off ─────────────────────────────────
--
-- A tag is the identity the plant is operated by, and it outlives this
-- project: the pump is P-2101A during engineering, during construction, and
-- for thirty years of maintenance afterwards. That is what makes it the
-- right join key — it is the one identifier that is still meaningful when
-- the construction data becomes maintenance data.

CREATE TABLE tag (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  subsystem_id  uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  tag_no        text NOT NULL,
  discipline    discipline NOT NULL,
  kind          text,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, tag_no)
);

CREATE INDEX tag_subsystem_idx  ON tag (subsystem_id);
CREATE INDEX tag_discipline_idx ON tag (project_id, discipline);

-- ── attaching what already exists ────────────────────────────────────────
--
-- Both are nullable and both stay nullable. A drawing arrives before anyone
-- has decided which subsystem it belongs to, and a platform that refuses the
-- drawing until the breakdown is loaded is a platform nobody can start using
-- on a Tuesday.
--
-- `document` carries it too, not only `line`, because `line` is a piping
-- concept. A civil or electrical module has documents and no lines, and it
-- must be able to file its work without piping's vocabulary.

ALTER TABLE line     ADD COLUMN subsystem_id uuid REFERENCES subsystem(id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN subsystem_id uuid REFERENCES subsystem(id) ON DELETE SET NULL;
ALTER TABLE line     ADD COLUMN tag_id       uuid REFERENCES tag(id) ON DELETE SET NULL;

CREATE INDEX line_subsystem_idx     ON line (subsystem_id);
CREATE INDEX document_subsystem_idx ON document (subsystem_id);

-- ── row level security ───────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subsystem', 'tag'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON subsystem, tag TO app_rw;
GRANT SELECT ON subsystem, tag TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.dim_subsystem WITH (security_invoker = true) AS
SELECT s.id AS subsystem_key, s.project_id AS project_key, s.unit_id AS unit_key,
       s.system_code, s.code AS subsystem_code, s.name AS subsystem_name,
       s.handover_seq, s.target_mc_date
  FROM subsystem s;

CREATE VIEW reporting.dim_tag WITH (security_invoker = true) AS
SELECT t.id AS tag_key, t.project_id AS project_key, t.subsystem_id AS subsystem_key,
       t.tag_no, t.discipline, t.kind, t.description
  FROM tag t;

-- ── the join that makes this an ecosystem ────────────────────────────────
--
-- One row per installable item, in ANY discipline. The grain is deliberately
-- the lowest common denominator of construction work, because every
-- discipline does the same three things to a thing: it exists, it gets
-- installed, it gets tested.
--
--   piping          weld          welded        NDT accepted
--   electrical      cable         pulled        megger/continuity
--   civil           pour          placed        cube test
--   structural      connection    erected       torque/NDT
--   instrumentation loop          installed     loop test
--   equipment       equipment     set           alignment
--
-- Piping is the only contributor today. The others arrive as further UNION
-- branches, and NOTHING above this view changes when they do — which is the
-- entire point of declaring the grain before the second module rather than
-- after it.
CREATE VIEW reporting.fact_progress WITH (security_invoker = true) AS
SELECT 'piping'::discipline AS discipline,
       f.project_key,
       COALESCE(l.subsystem_id, d.subsystem_id) AS subsystem_key,
       f.weld_uid::text  AS item_uid,
       f.weld_no         AS item_no,
       f.is_welded       AS is_installed,
       f.is_examined     AS is_tested
  FROM reporting.fact_weld f
  LEFT JOIN line     l ON l.id = f.line_key
  LEFT JOIN document d ON d.id = f.document_key;

-- The answer to the Thursday question, for every discipline at once.
--
-- `items_unfiled` is reported rather than hidden: an item whose subsystem is
-- unknown is not evidence of readiness, and a readiness percentage computed
-- over only the filed items would climb as the breakdown got LESS complete.
CREATE VIEW reporting.kpi_subsystem_readiness WITH (security_invoker = true) AS
SELECT p.project_key, p.subsystem_key, s.subsystem_code, s.system_code,
       s.subsystem_name, s.handover_seq, s.target_mc_date,
       p.discipline,
       COUNT(*)                                      AS items,
       COUNT(*) FILTER (WHERE p.is_installed)        AS installed,
       COUNT(*) FILTER (WHERE p.is_tested)           AS tested,
       COUNT(*) FILTER (WHERE p.subsystem_key IS NULL) AS items_unfiled,
       ROUND(100.0 * COUNT(*) FILTER (WHERE p.is_tested) / NULLIF(COUNT(*), 0), 1)
         AS pct_ready
  FROM reporting.fact_progress p
  LEFT JOIN reporting.dim_subsystem s ON s.subsystem_key = p.subsystem_key
 GROUP BY p.project_key, p.subsystem_key, s.subsystem_code, s.system_code,
          s.subsystem_name, s.handover_seq, s.target_mc_date, p.discipline;

GRANT SELECT ON reporting.dim_subsystem, reporting.dim_tag,
                reporting.fact_progress, reporting.kpi_subsystem_readiness
  TO app_rw, app_report;
