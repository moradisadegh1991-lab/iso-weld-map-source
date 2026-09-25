-- ─────────────────────────────────────────────────────────────────────────
-- Project controls: control accounts, their baseline S-curve, reported
-- progress, cost, and the risk register.
--
-- Money is in the project's contract currency; an account's BAC and a cost
-- entry are refused while the project states none (lib/db/repos/controls.mjs),
-- because an amount with no currency is not an amount (009).
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE control_account (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code                 text NOT NULL,          -- WBS / CBS code
  title                text NOT NULL,
  contractor_id        uuid REFERENCES contractor(id) ON DELETE SET NULL,
  bac                  numeric(18,2),          -- budget at completion, contract currency
  ev_method            text NOT NULL DEFAULT 'manual',
  ev_discipline        discipline,             -- platform EV: which items
  ev_subsystem_id      uuid REFERENCES subsystem(id) ON DELETE SET NULL,
  credit_installed_pct numeric(5,2),           -- rule of credit: share earned at "installed"
  baseline_rev         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
ALTER TABLE control_account ADD CONSTRAINT account_ev_method_known CHECK (ev_method IN ('manual', 'platform'));
ALTER TABLE control_account ADD CONSTRAINT account_platform_names_items CHECK (ev_method <> 'platform' OR ev_discipline IS NOT NULL);
ALTER TABLE control_account ADD CONSTRAINT account_bac_positive CHECK (bac IS NULL OR bac > 0);
ALTER TABLE control_account ADD CONSTRAINT account_credit_range CHECK (
  credit_installed_pct IS NULL OR (credit_installed_pct >= 0 AND credit_installed_pct <= 100));

CREATE TABLE control_baseline_point (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES control_account(id) ON DELETE CASCADE,
  on_date     date NOT NULL,
  cum_pct     numeric(5,2) NOT NULL,
  UNIQUE (account_id, on_date)
);
ALTER TABLE control_baseline_point ADD CONSTRAINT baseline_pct_range CHECK (cum_pct >= 0 AND cum_pct <= 100);

-- Every issue of a baseline, whole: a re-baseline is a decision with a
-- reason, and the curve it replaced stays readable.
CREATE TABLE control_baseline_revision (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES control_account(id) ON DELETE CASCADE,
  revision    text NOT NULL,
  points      jsonb NOT NULL,
  reason      text NOT NULL,
  issued_by   uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Reported progress (manual EV): the latest report on or before the data
-- date decides.
CREATE TABLE control_progress (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES control_account(id) ON DELETE CASCADE,
  as_of       date NOT NULL,
  pct         numeric(5,2) NOT NULL,
  source      text NOT NULL,                  -- the progress report it came from
  recorded_by uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE control_progress ADD CONSTRAINT progress_pct_range CHECK (pct >= 0 AND pct <= 100);

CREATE TABLE cost_entry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES control_account(id) ON DELETE CASCADE,
  posted_on   date NOT NULL,
  amount      numeric(18,2) NOT NULL,         -- contract currency; a negative entry reverses
  ref_no      text NOT NULL,                  -- invoice / timesheet / accrual
  note        text,
  recorded_by uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE cost_entry ADD CONSTRAINT cost_nonzero CHECK (amount <> 0);
ALTER TABLE cost_entry ADD CONSTRAINT cost_reversal_explained CHECK (amount > 0 OR note IS NOT NULL);

CREATE TABLE control_risk (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code          text NOT NULL,
  title         text NOT NULL,
  category      text,
  cause         text,
  consequence   text,
  owner         text,
  account_id    uuid REFERENCES control_account(id) ON DELETE SET NULL,
  probability   smallint NOT NULL,
  impact        smallint NOT NULL,
  response      text,
  due_on        date,
  residual_p    smallint,
  residual_i    smallint,
  status        text NOT NULL DEFAULT 'open',
  closed_on     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
ALTER TABLE control_risk ADD CONSTRAINT risk_scales CHECK (
  probability BETWEEN 1 AND 5 AND impact BETWEEN 1 AND 5
  AND (residual_p IS NULL OR residual_p BETWEEN 1 AND 5) AND (residual_i IS NULL OR residual_i BETWEEN 1 AND 5));
ALTER TABLE control_risk ADD CONSTRAINT risk_status_known CHECK (status IN ('open', 'closed'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['control_account', 'control_baseline_point', 'control_baseline_revision',
                           'control_progress', 'cost_entry', 'control_risk'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

-- Cost, reported progress and baseline issues are records: corrected by a
-- new entry (a reversal, a later report, a re-baseline), never edited.
REVOKE UPDATE, DELETE, TRUNCATE ON control_baseline_revision, control_progress, cost_entry FROM app_rw;
GRANT SELECT, INSERT ON control_baseline_revision, control_progress, cost_entry TO app_rw;
GRANT SELECT ON control_account, control_baseline_point, control_baseline_revision, control_progress,
                cost_entry, control_risk TO app_report;

-- ── reporting ────────────────────────────────────────────────────────────

CREATE VIEW reporting.dim_control_account WITH (security_invoker = true) AS
SELECT a.id AS account_key, a.project_id AS project_key, a.code, a.title, a.contractor_id AS contractor_key,
       a.bac, p.contract_currency AS currency, a.ev_method, a.ev_discipline, a.ev_subsystem_id AS subsystem_key,
       a.credit_installed_pct, a.baseline_rev
  FROM control_account a JOIN project p ON p.id = a.project_id;

CREATE VIEW reporting.fact_baseline WITH (security_invoker = true) AS
SELECT b.project_id AS project_key, b.account_id AS account_key, b.on_date, b.cum_pct
  FROM control_baseline_point b;

CREATE VIEW reporting.fact_cost WITH (security_invoker = true) AS
SELECT c.id AS cost_key, c.project_id AS project_key, c.account_id AS account_key, c.posted_on, c.amount, c.ref_no
  FROM cost_entry c;

CREATE VIEW reporting.fact_reported_progress WITH (security_invoker = true) AS
SELECT r.project_id AS project_key, r.account_id AS account_key, r.as_of, r.pct, r.source
  FROM control_progress r;

CREATE VIEW reporting.fact_risk WITH (security_invoker = true) AS
SELECT r.id AS risk_key, r.project_id AS project_key, r.code, r.title, r.category, r.owner,
       r.account_id AS account_key, r.probability, r.impact, r.probability * r.impact AS score,
       r.residual_p, r.residual_i, r.residual_p * r.residual_i AS residual_score, r.status, r.due_on, r.closed_on
  FROM control_risk r;

GRANT SELECT ON reporting.dim_control_account, reporting.fact_baseline, reporting.fact_cost,
                reporting.fact_reported_progress, reporting.fact_risk TO app_rw, app_report;
