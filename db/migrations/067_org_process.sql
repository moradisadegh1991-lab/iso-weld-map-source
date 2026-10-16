-- ─────────────────────────────────────────────────────────────────────────
-- The organisation's process, steps 1–2 (owner's spec, 2026-10-15):
--
-- company              the organisation's directory of companies — shared by
--                      every project (the same client or vendor is the same
--                      company everywhere), each with any number of logos
-- project_stakeholder  which companies take part in a project, in what role
-- project_currency     the currencies a project counts in, each with its value
--                      in the project's base unit (USD = 1, IRR = 0.00732 …)
-- project_budget       the project's budgets, one line per currency
-- contract_currency    a contract's currencies, each with the rate the contract
--                      fixes and the budget forecast in it
-- contract_stakeholder which companies take part in a contract, in what role
-- contract_amendment   addenda and extensions: time, money or both; each money
--                      change is a line per currency (+ / −, or new items)
-- contract_category    the contract's category trees: resources and narrative,
--                      by discipline and work group
--
-- What a budget line shows beyond its forecast is derived: the weight of a
-- currency is forecast × rate over the contract's total; increases,
-- decreases and new items are the sum of the amendments; the total needed is
-- forecast − decreases + increases + new items. Done is the approved payment
-- statements' gross when the currency is the contract's own; otherwise it is
-- typed, and labelled as typed.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE company (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$'),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  name_en     text,
  national_id text,
  address     text,
  phone       text,
  email       text,
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_logo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  sha256        text NOT NULL,
  storage_uri   text NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  byte_size     int  NOT NULL CHECK (byte_size > 0),
  active        boolean NOT NULL DEFAULT true,
  uploaded_by   uuid REFERENCES app_user(id),
  uploaded_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (company_id, sha256)
);

CREATE TABLE project_stakeholder (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT,
  role        text NOT NULL CHECK (role IN ('owner', 'epc', 'consultant', 'supervisor', 'contractor', 'subcontractor', 'vendor', 'other')),
  note        text,
  UNIQUE (project_id, company_id, role)
);

CREATE TABLE project_currency (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code        text NOT NULL CHECK (code ~ '^[A-Z]{3}$'),
  name        text NOT NULL,
  rate        numeric(24,10) NOT NULL CHECK (rate > 0),    -- the value of one unit in the base unit
  UNIQUE (project_id, code)
);

CREATE TABLE project_budget (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(btrim(title)) > 0),
  currency    text NOT NULL,
  amount      numeric(20,2) NOT NULL CHECK (amount >= 0),
  note        text,
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, currency) REFERENCES project_currency (project_id, code) ON UPDATE CASCADE
);

CREATE TABLE contract_currency (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  currency     text NOT NULL,
  rate         numeric(24,10) NOT NULL CHECK (rate > 0),   -- as the contract fixes it
  budget       numeric(20,2) NOT NULL DEFAULT 0 CHECK (budget >= 0),   -- the forecast budget in this currency
  done_typed   numeric(20,2) CHECK (done_typed IS NULL OR done_typed >= 0),
  UNIQUE (contract_id, currency),
  FOREIGN KEY (project_id, currency) REFERENCES project_currency (project_id, code) ON UPDATE CASCADE
);

CREATE TABLE contract_stakeholder (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES company(id) ON DELETE RESTRICT,
  role         text NOT NULL CHECK (role IN ('employer', 'contractor', 'consultant', 'supervisor', 'subcontractor', 'other')),
  note         text,
  UNIQUE (contract_id, company_id, role)
);

CREATE TABLE contract_amendment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  amendment_no text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('time', 'financial', 'both')),
  title        text NOT NULL CHECK (length(btrim(title)) > 0),
  signed_on    date,
  days         int NOT NULL DEFAULT 0,          -- extension (+) or reduction (−) of the contract period
  note         text,
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, amendment_no),
  CHECK (kind = 'financial' OR days <> 0),       -- a time amendment changes the time
  CHECK (kind <> 'financial' OR days = 0)
);

CREATE TABLE contract_amendment_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  amendment_id  uuid NOT NULL REFERENCES contract_amendment(id) ON DELETE CASCADE,
  currency      text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('change', 'new_items')),
  amount        numeric(20,2) NOT NULL CHECK (amount <> 0),   -- change: + increase / − decrease; new items: + only
  CHECK (kind <> 'new_items' OR amount > 0),
  UNIQUE (amendment_id, currency, kind)
);

CREATE TABLE contract_category (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  tree         text NOT NULL CHECK (tree IN ('resource', 'narrative')),
  parent_id    uuid REFERENCES contract_category(id) ON DELETE RESTRICT,
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  discipline   text,
  seq          int NOT NULL DEFAULT 1,
  UNIQUE (contract_id, tree, parent_id, name)
);
CREATE INDEX contract_category_parent ON contract_category (parent_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_stakeholder', 'project_currency', 'project_budget', 'contract_currency', 'contract_stakeholder',
                           'contract_amendment', 'contract_amendment_line', 'contract_category'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;
GRANT SELECT ON company, company_logo, project_stakeholder, project_currency, project_budget, contract_currency,
  contract_stakeholder, contract_amendment, contract_amendment_line, contract_category TO app_report;
