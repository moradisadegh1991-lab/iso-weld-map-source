-- Work outside the contract, and the changes behind it.
--
--   tech_query   — a technical query (TQ) the site puts to the designer. The
--                  designer answers it in the designer portal; the EPC's
--                  engineer closes it: no change, or a change is needed.
--   site_change  — a change made on site: a site-run line (routed in the
--                  field), a field change, or an as-built deviation. It is
--                  approved by an engineer who did not raise it; the designer
--                  then puts it on the drawing (the as-built revision), and
--                  the EPC closes it once that revision is in the MDR.
--   work_order   — an instruction to a contractor for work its contract does
--                  not cover, often because of a TQ or a site change. It is
--                  prepared, then issued by someone else; issuing it adds a
--                  variation item to the (signed) contract, measured by sheet
--                  and paid through the payment statement like any other item.

CREATE TABLE tech_query (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tq_no           text NOT NULL,
  subject         text NOT NULL,
  question        text NOT NULL,
  proposal        text,                          -- what the site proposes, if anything
  discipline      text,
  mdr_document_id uuid REFERENCES mdr_document(id) ON DELETE SET NULL,
  line_id         uuid REFERENCES line(id) ON DELETE SET NULL,
  tag_id          uuid REFERENCES tag(id) ON DELETE SET NULL,
  raised_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  raised_on       date NOT NULL,
  reply_due       date,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  answer          text,
  answered_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  answered_on     date,
  outcome         text CHECK (outcome IN ('no_change', 'change_required')),
  closed_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, tq_no),
  CHECK (status = 'open' OR (answer IS NOT NULL AND answered_by IS NOT NULL AND answered_on IS NOT NULL)),
  CHECK (status <> 'closed' OR (outcome IS NOT NULL AND closed_by IS NOT NULL))
);

CREATE TABLE site_change (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  fcr_no          text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('site_run', 'field_change', 'as_built')),
  title           text NOT NULL,
  description     text NOT NULL,
  reason          text,
  tq_id           uuid REFERENCES tech_query(id) ON DELETE SET NULL,
  mdr_document_id uuid REFERENCES mdr_document(id) ON DELETE SET NULL,   -- the drawing that must show it
  line_id         uuid REFERENCES line(id) ON DELETE SET NULL,
  tag_id          uuid REFERENCES tag(id) ON DELETE SET NULL,
  raised_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  raised_on       date NOT NULL,
  status          text NOT NULL DEFAULT 'raised'
                  CHECK (status IN ('raised', 'approved', 'rejected', 'asbuilt_submitted', 'closed')),
  decided_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  asbuilt_revision text,                          -- the revision the designer issued for it
  asbuilt_note    text,
  asbuilt_by      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  asbuilt_on      date,
  closed_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, fcr_no),
  CHECK (status NOT IN ('asbuilt_submitted', 'closed') OR asbuilt_revision IS NOT NULL)
);

CREATE TABLE work_order (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  wo_no           text NOT NULL,
  contract_id     uuid NOT NULL REFERENCES contract(id),
  title           text NOT NULL,
  description     text NOT NULL,
  origin          text NOT NULL CHECK (origin IN ('tq', 'site_change', 'client', 'other')),
  tq_id           uuid REFERENCES tech_query(id) ON DELETE SET NULL,
  site_change_id  uuid REFERENCES site_change(id) ON DELETE SET NULL,
  account_id      uuid REFERENCES control_account(id),
  unit            text NOT NULL,
  qty             numeric(14,3) NOT NULL CHECK (qty > 0),
  rate            numeric(16,2) NOT NULL CHECK (rate >= 0),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'completed', 'cancelled')),
  prepared_by     uuid REFERENCES app_user(id) ON DELETE SET NULL,
  prepared_at     timestamptz NOT NULL DEFAULT now(),
  issued_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  issued_on       date,
  completed_on    date,
  line_id         uuid REFERENCES contract_line(id) ON DELETE SET NULL,   -- the variation item issuing it created
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, wo_no),
  CHECK (origin <> 'tq' OR tq_id IS NOT NULL),
  CHECK (origin <> 'site_change' OR site_change_id IS NOT NULL),
  CHECK (status = 'draft' OR status = 'cancelled' OR (issued_by IS NOT NULL AND issued_on IS NOT NULL AND line_id IS NOT NULL))
);

ALTER TABLE contract_line ADD COLUMN work_order_id uuid REFERENCES work_order(id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tech_query', 'site_change', 'work_order'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
  END LOOP;
END $$;

GRANT SELECT ON tech_query, site_change, work_order TO app_report;
