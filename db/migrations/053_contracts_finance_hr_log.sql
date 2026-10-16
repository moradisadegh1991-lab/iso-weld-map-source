-- ─────────────────────────────────────────────────────────────────────────
-- Contracts and subcontracts, contractors' payment statements measured on
-- the project's WBS and design (PDMS) quantities, finance, human resources,
-- and one log per section of the project.
--
-- A contract's payment items (BOQ lines) each sit on a WBS element — a
-- control account (021) — and say how their quantity is MEASURED:
--   platform  counted by the platform from the work recorded in it, as of the
--             statement's period end (inch-dia welded, m³ poured, m pulled…);
--   design    the design model's quantity (PDMS/E3D MTO, imported by model
--             revision) × the WBS element's progress;
--   measured  a quantity from a signed measurement sheet (صورت‌جلسه);
--   lump_sum  the item's amount × the WBS element's progress.
-- A statement freezes what it measured, with where each number came from.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TYPE project_role ADD VALUE IF NOT EXISTS 'contracts';
ALTER TYPE project_role ADD VALUE IF NOT EXISTS 'finance';
ALTER TYPE project_role ADD VALUE IF NOT EXISTS 'hr';

-- ── contracts ────────────────────────────────────────────────────────────

CREATE TABLE contract (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_no         text NOT NULL,
  title               text NOT NULL,
  kind                text NOT NULL,           -- main | subcontract | service
  contractor_id       uuid REFERENCES contractor(id) ON DELETE RESTRICT,
  counterparty        text,                    -- the other party when it is not a registered contractor (the client)
  currency            text NOT NULL,
  value               numeric(18,2),           -- as signed; the BOQ is what statements are measured against
  signed_on           date,
  start_on            date,
  end_on              date,
  -- Terms every statement applies, as percentages of the period's gross.
  advance_pct         numeric(5,2) NOT NULL DEFAULT 0,  -- advance payment, % of contract value
  advance_recovery_pct numeric(5,2),                    -- recovered from each statement; NULL = advance_pct
  retention_pct       numeric(5,2) NOT NULL DEFAULT 0,  -- حسن انجام کار
  insurance_pct       numeric(5,2) NOT NULL DEFAULT 0,  -- کسر بیمه
  withholding_pct     numeric(5,2) NOT NULL DEFAULT 0,  -- مالیات تکلیفی
  vat_pct             numeric(5,2) NOT NULL DEFAULT 0,  -- ارزش افزوده (added, not deducted)
  overrun_limit_pct   numeric(5,2) NOT NULL DEFAULT 25, -- quantity above the BOQ beyond which an amendment is needed
  scope               text,
  status              text NOT NULL DEFAULT 'draft',
  created_by          uuid REFERENCES app_user(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, contract_no)
);
ALTER TABLE contract ADD CONSTRAINT contract_kind_known CHECK (kind IN ('main', 'subcontract', 'service'));
ALTER TABLE contract ADD CONSTRAINT contract_status_known CHECK (status IN ('draft', 'in_review', 'signed', 'closed'));
ALTER TABLE contract ADD CONSTRAINT contract_party CHECK (contractor_id IS NOT NULL OR counterparty IS NOT NULL);
ALTER TABLE contract ADD CONSTRAINT contract_pcts CHECK (
  advance_pct BETWEEN 0 AND 100 AND retention_pct BETWEEN 0 AND 100 AND insurance_pct BETWEEN 0 AND 100
  AND withholding_pct BETWEEN 0 AND 100 AND vat_pct BETWEEN 0 AND 100 AND overrun_limit_pct BETWEEN 0 AND 100
  AND (advance_recovery_pct IS NULL OR advance_recovery_pct BETWEEN 0 AND 100));
ALTER TABLE contract ADD CONSTRAINT contract_dates CHECK (end_on IS NULL OR start_on IS NULL OR end_on >= start_on);

-- A package (009) is the scope a contract gives.
ALTER TABLE contract_package ADD COLUMN contract_id uuid REFERENCES contract(id) ON DELETE SET NULL;

-- ── design quantities (PDMS / E3D material take-off) ─────────────────────

CREATE TABLE design_quantity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  source        text NOT NULL DEFAULT 'PDMS',
  model_rev     text NOT NULL,
  code          text NOT NULL,                -- the model report's item / commodity code
  description   text,
  unit          text NOT NULL,
  qty           numeric(18,3) NOT NULL,
  account_id    uuid REFERENCES control_account(id) ON DELETE SET NULL,
  area          text,
  imported_by   uuid REFERENCES app_user(id),
  imported_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code, model_rev)
);
ALTER TABLE design_quantity ADD CONSTRAINT design_qty_nonneg CHECK (qty >= 0);

-- ── payment items (BOQ) ──────────────────────────────────────────────────

CREATE TABLE contract_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  item_no       text NOT NULL,
  description   text NOT NULL,
  unit          text NOT NULL,
  qty           numeric(18,3) NOT NULL,        -- contract quantity
  rate          numeric(18,4) NOT NULL,        -- unit rate, contract currency
  account_id    uuid REFERENCES control_account(id) ON DELETE RESTRICT,   -- the WBS element
  method        text NOT NULL,
  metric        text,                          -- platform: what is counted
  subsystem_id  uuid REFERENCES subsystem(id) ON DELETE SET NULL,  -- platform: counted only here
  design_code   text,                          -- design: the model item
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, item_no)
);
ALTER TABLE contract_line ADD CONSTRAINT line_qty_positive CHECK (qty > 0 AND rate >= 0);
ALTER TABLE contract_line ADD CONSTRAINT line_method_known CHECK (method IN ('platform', 'design', 'measured', 'lump_sum'));
ALTER TABLE contract_line ADD CONSTRAINT line_platform_metric CHECK (method <> 'platform' OR metric IS NOT NULL);
ALTER TABLE contract_line ADD CONSTRAINT line_design_code CHECK (method <> 'design' OR (design_code IS NOT NULL AND account_id IS NOT NULL));
ALTER TABLE contract_line ADD CONSTRAINT line_lump_wbs CHECK (method <> 'lump_sum' OR account_id IS NOT NULL);

-- ── payment statements (صورت وضعیت) ───────────────────────────────────────

CREATE TABLE pay_statement (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id      uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  seq              int NOT NULL,
  period_to        date NOT NULL,
  status           text NOT NULL DEFAULT 'draft',
  -- The money, frozen when the statement is submitted (cumulative method).
  gross_cum        numeric(18,2),
  gross_prev       numeric(18,2),
  gross_this       numeric(18,2),
  advance_recovery numeric(18,2),
  retention        numeric(18,2),
  insurance        numeric(18,2),
  withholding      numeric(18,2),
  vat              numeric(18,2),
  net_this         numeric(18,2),
  flags            jsonb NOT NULL DEFAULT '[]',
  prepared_by      uuid REFERENCES app_user(id),
  prepared_at      timestamptz NOT NULL DEFAULT now(),
  submitted_by     uuid REFERENCES app_user(id),
  submitted_at     timestamptz,
  verified_by      uuid REFERENCES app_user(id),
  verified_at      timestamptz,
  approved_by      uuid REFERENCES app_user(id),
  approved_at      timestamptz,
  UNIQUE (contract_id, seq)
);
ALTER TABLE pay_statement ADD CONSTRAINT statement_status_known CHECK (status IN ('draft', 'submitted', 'verified', 'approved', 'paid'));

CREATE TABLE pay_statement_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  statement_id  uuid NOT NULL REFERENCES pay_statement(id) ON DELETE CASCADE,
  line_id       uuid NOT NULL REFERENCES contract_line(id) ON DELETE CASCADE,
  cum_qty       numeric(18,3),                 -- NULL: not measured yet (a measured line without its sheet)
  prev_qty      numeric(18,3) NOT NULL DEFAULT 0,
  sheet_ref     text,                          -- measured: the measurement sheet
  evidence      jsonb NOT NULL DEFAULT '{}',   -- how the quantity was reached, as it stood
  UNIQUE (statement_id, line_id)
);

-- ── payments ─────────────────────────────────────────────────────────────

CREATE TABLE contract_payment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  statement_id  uuid REFERENCES pay_statement(id) ON DELETE RESTRICT,
  kind          text NOT NULL,                 -- advance | statement | retention_release
  paid_on       date NOT NULL,
  amount        numeric(18,2) NOT NULL,
  ref_no        text NOT NULL,                 -- the bank / treasury document
  note          text,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contract_payment ADD CONSTRAINT payment_kind_known CHECK (kind IN ('advance', 'statement', 'retention_release'));
ALTER TABLE contract_payment ADD CONSTRAINT payment_positive CHECK (amount > 0);
ALTER TABLE contract_payment ADD CONSTRAINT payment_statement_named CHECK ((kind = 'statement') = (statement_id IS NOT NULL));

-- ── human resources ──────────────────────────────────────────────────────
--
-- One person, one row: the people HSE names on permits (047) are the
-- project's personnel, so HR extends that register rather than keeping a
-- second list of the same people.

ALTER TABLE hse_person ADD COLUMN position    text;
ALTER TABLE hse_person ADD COLUMN department  text;
ALTER TABLE hse_person ADD COLUMN employer    text NOT NULL DEFAULT 'contractor';
ALTER TABLE hse_person ADD COLUMN mobilized_on   date;
ALTER TABLE hse_person ADD COLUMN demobilized_on date;
ALTER TABLE hse_person ADD COLUMN phone       text;
ALTER TABLE hse_person ADD COLUMN email       text;
ALTER TABLE hse_person ADD CONSTRAINT person_employer_known CHECK (employer IN ('epc', 'contractor', 'client', 'consultant'));
ALTER TABLE hse_person ADD CONSTRAINT person_mobilization CHECK (demobilized_on IS NULL OR mobilized_on IS NULL OR demobilized_on >= mobilized_on);

CREATE TABLE hr_timesheet (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  person_id     uuid NOT NULL REFERENCES hse_person(id) ON DELETE CASCADE,
  work_date     date NOT NULL,
  hours         numeric(4,1) NOT NULL,
  overtime      numeric(4,1) NOT NULL DEFAULT 0,
  account_id    uuid REFERENCES control_account(id) ON DELETE SET NULL,   -- the WBS element worked on
  note          text,
  recorded_by   uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX hr_timesheet_day ON hr_timesheet
  (person_id, work_date, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE hr_timesheet ADD CONSTRAINT timesheet_hours CHECK (hours >= 0 AND overtime >= 0 AND hours + overtime <= 24);

-- ── the log ──────────────────────────────────────────────────────────────
--
-- Each step a record takes through its workflow, and every comment on it:
-- who, when, from what state to what, and what they wrote. Append-only.
-- Sections that sign in their own tables (MC, IR, punches…) are read into
-- the same log from those signatures (lib/db/repos/log.mjs); this table
-- holds what has no other home — the new modules' steps and comments.

CREATE TABLE workflow_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  section       text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid,
  entity_label  text NOT NULL,
  action        text NOT NULL,
  from_state    text,
  to_state      text,
  comment       text,
  user_id       uuid REFERENCES app_user(id),
  at            timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX workflow_event_section ON workflow_event (project_id, section, at DESC);
CREATE INDEX workflow_event_entity ON workflow_event (entity_type, entity_id);
ALTER TABLE workflow_event ADD CONSTRAINT event_comment_has_text CHECK (action <> 'commented' OR length(btrim(comment)) > 0);

-- ── row level security ───────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contract', 'design_quantity', 'contract_line', 'pay_statement', 'pay_statement_line',
                           'contract_payment', 'hr_timesheet', 'workflow_event'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- The log and the payments are records of what happened.
REVOKE UPDATE, DELETE, TRUNCATE ON workflow_event FROM app_rw;
GRANT SELECT, INSERT ON workflow_event TO app_rw;
REVOKE UPDATE, DELETE, TRUNCATE ON contract_payment FROM app_rw;
GRANT SELECT, INSERT ON contract_payment TO app_rw;
GRANT SELECT ON contract, design_quantity, contract_line, pay_statement, pay_statement_line, contract_payment,
               hr_timesheet, workflow_event TO app_report;
