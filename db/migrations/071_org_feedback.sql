-- ─────────────────────────────────────────────────────────────────────────
-- The owner's review of the organisation's process (2026-10-15):
--
-- company.tax_code          the company's tax (economic) code
-- contract employer / contractor companies
--                           picked from the companies directory; each is also
--                           a stakeholder of the contract in that role
-- contract_category 'work_group'
--                           a third tree per contract: the executive work
--                           groups a resource row in the daily report is
--                           booked against
-- password_reset_request    "I forgot my password": a request the account's
--                           administrators see and answer with a one-time
--                           link. Nothing is mailed — the platform has no
--                           mail server — and the request never says whether
--                           the account exists.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE company ADD COLUMN tax_code text;

ALTER TABLE contract ADD COLUMN employer_company_id uuid REFERENCES company(id) ON DELETE RESTRICT;
ALTER TABLE contract ADD COLUMN contractor_company_id uuid REFERENCES company(id) ON DELETE RESTRICT;

ALTER TABLE contract_category DROP CONSTRAINT contract_category_tree_check;
ALTER TABLE contract_category ADD CONSTRAINT contract_category_tree_check CHECK (tree IN ('resource', 'narrative', 'work_group'));

CREATE TABLE password_reset_request (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  source       text,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES app_user(id),
  outcome      text CHECK (outcome IN ('link', 'dismissed', 'self'))
);
CREATE INDEX password_reset_request_open ON password_reset_request (user_id) WHERE resolved_at IS NULL;
CREATE INDEX password_reset_request_source ON password_reset_request (source, requested_at);
-- Outside project scope, like user_credential and user_setup_token.
GRANT SELECT, INSERT, UPDATE ON password_reset_request TO app_rw;
REVOKE ALL ON password_reset_request FROM app_report;
