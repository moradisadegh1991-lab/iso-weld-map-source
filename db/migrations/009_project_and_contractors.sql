-- ─────────────────────────────────────────────────────────────────────────
-- The project, and the companies doing the work.
--
-- WHY A CONTRACTOR TABLE AND NOT A TEXT COLUMN
--
-- In EPC the work is executed by subcontractors, and almost every question a
-- project manager actually asks is scoped by one: whose weld rejected, whose
-- foundation is late, which package is holding a subsystem. A contractor
-- name typed into a text column on each record answers none of those — it
-- answers them wrongly, because "Sazeh Pad", "SazehPad" and "سازه پاد" are
-- three companies as far as a GROUP BY is concerned.
--
-- So a contractor is a row, a scope of work is a row, and everything else
-- points at them.
-- ─────────────────────────────────────────────────────────────────────────

-- ── the project's own particulars ────────────────────────────────────────
--
-- Added to `project` rather than kept in a side table: these are one-to-one
-- with the project and are read on nearly every screen that prints a header.
-- All nullable, because a project is created before its contract is signed
-- and a form that refuses to save until every field is known is a form
-- people keep in Excel instead.

ALTER TABLE project
  ADD COLUMN client_name        text,      -- کارفرما
  ADD COLUMN consultant_name    text,      -- مشاور / مهندس کارفرما
  ADD COLUMN contractor_name    text,      -- پیمانکار اصلی (EPC)
  ADD COLUMN contract_no        text,
  ADD COLUMN contract_date      date,
  ADD COLUMN contract_value     numeric(18,2),
  ADD COLUMN contract_currency  text,
  ADD COLUMN site_location      text,
  ADD COLUMN start_date         date,
  ADD COLUMN planned_end_date   date,
  ADD COLUMN description        text,
  ADD COLUMN updated_at         timestamptz;

-- A currency amount with no currency is not an amount. This is the one
-- constraint worth having here: the rest are genuinely optional, but a
-- number whose unit nobody recorded gets added to another one eventually.
ALTER TABLE project ADD CONSTRAINT value_has_currency
  CHECK (contract_value IS NULL OR contract_currency IS NOT NULL);

ALTER TABLE project ADD CONSTRAINT end_after_start
  CHECK (planned_end_date IS NULL OR start_date IS NULL OR planned_end_date >= start_date);

-- ── contractors ──────────────────────────────────────────────────────────

CREATE TYPE contractor_status AS ENUM ('prospective', 'active', 'suspended', 'demobilised');

CREATE TABLE contractor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  status        contractor_status NOT NULL DEFAULT 'active',
  -- Which trades this company is actually approved for. An array rather than
  -- one discipline, because a civil contractor that also does structural
  -- steel is the normal case, not an exception worth a second row.
  disciplines   discipline[] NOT NULL DEFAULT '{}',
  contact_name  text,
  contact_phone text,
  contact_email text,
  national_id   text,                      -- شناسهٔ ملی / registration number
  -- Qualification is a date, not a boolean: "approved" with no expiry is how
  -- a contractor keeps working two years after their certification lapsed.
  prequalified_on   date,
  prequalified_until date,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

CREATE INDEX contractor_status_idx ON contractor (project_id, status);

-- ── scope of work ────────────────────────────────────────────────────────
--
-- A contract package is what a contractor was actually given: a discipline,
-- optionally narrowed to one subsystem. This is the join that turns
-- "subsystem 21-01 is 40% ready" into "and it is Package C-03's to finish".

CREATE TABLE contract_package (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contractor_id  uuid NOT NULL REFERENCES contractor(id) ON DELETE CASCADE,
  code           text NOT NULL,
  title          text,
  discipline     discipline NOT NULL,
  -- NULL means the whole project for that discipline. Spelling that out
  -- beats inventing a magic "ALL" subsystem that every query has to know about.
  subsystem_id   uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  value          numeric(18,2),
  currency       text,
  start_date     date,
  end_date       date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

CREATE INDEX contract_package_contractor_idx ON contract_package (contractor_id);
CREATE INDEX contract_package_subsystem_idx  ON contract_package (subsystem_id);

ALTER TABLE contract_package ADD CONSTRAINT package_value_has_currency
  CHECK (value IS NULL OR currency IS NOT NULL);

-- ── attribution ──────────────────────────────────────────────────────────
--
-- Who actually did this step. Without it, "the foundation is late" cannot
-- become "and it is this company's third late foundation".

ALTER TABLE tag_activity
  ADD COLUMN contractor_id uuid REFERENCES contractor(id) ON DELETE SET NULL;

-- ── row level security ───────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contractor', 'contract_package'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON contractor, contract_package TO app_rw;
GRANT SELECT ON contractor, contract_package TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.dim_contractor WITH (security_invoker = true) AS
SELECT c.id AS contractor_key, c.project_id AS project_key,
       c.code AS contractor_code, c.name AS contractor_name, c.status,
       c.disciplines, c.prequalified_until,
       -- Computed, never stored: a stored "expired" flag is wrong the
       -- morning after it becomes true and nobody is watching.
       (c.prequalified_until IS NOT NULL AND c.prequalified_until < CURRENT_DATE)
         AS prequalification_expired,
       COUNT(p.id) AS packages,
       SUM(p.value) AS awarded_value
  FROM contractor c
  LEFT JOIN contract_package p ON p.contractor_id = c.id
 GROUP BY c.id;

-- Whose work is holding which subsystem. The Thursday question, with a name
-- attached to the answer.
CREATE VIEW reporting.kpi_package_progress WITH (security_invoker = true) AS
SELECT pk.project_id AS project_key, pk.id AS package_key, pk.code AS package_code,
       pk.discipline, c.id AS contractor_key, c.name AS contractor_name,
       s.code AS subsystem_code,
       COUNT(f.item_uid)                              AS items,
       COUNT(f.item_uid) FILTER (WHERE f.is_installed) AS installed,
       COUNT(f.item_uid) FILTER (WHERE f.is_tested)    AS tested,
       ROUND(100.0 * COUNT(f.item_uid) FILTER (WHERE f.is_tested)
             / NULLIF(COUNT(f.item_uid), 0), 1)        AS pct_ready
  FROM contract_package pk
  JOIN contractor c ON c.id = pk.contractor_id
  LEFT JOIN subsystem s ON s.id = pk.subsystem_id
  LEFT JOIN reporting.fact_progress f
         ON f.project_key = pk.project_id
        AND f.discipline = pk.discipline
        -- A package with no subsystem covers the whole discipline.
        AND (pk.subsystem_id IS NULL OR f.subsystem_key = pk.subsystem_id)
 GROUP BY pk.project_id, pk.id, pk.code, pk.discipline, c.id, c.name, s.code;

GRANT SELECT ON reporting.dim_contractor, reporting.kpi_package_progress
  TO app_rw, app_report;
