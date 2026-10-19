-- ─────────────────────────────────────────────────────────────────────────
-- "I forgot my password", answered by mail (owner's requirements of
-- 2026-10-18, item 13). When the server is set up to send mail
-- (lib/server/mail.mjs), the form mails a one-time link to the address on the
-- account instead of waiting for an administrator. The request is still
-- written down — resolved at once, outcome 'mail' — so the administrators see
-- it happened and the per-network throttle still counts it.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE password_reset_request DROP CONSTRAINT password_reset_request_outcome_check;
ALTER TABLE password_reset_request ADD CONSTRAINT password_reset_request_outcome_check
  CHECK (outcome IN ('link', 'dismissed', 'self', 'mail'));
