-- ─────────────────────────────────────────────────────────────────────────
-- Users: developers, disciplines, deactivation, and setup links.
--
-- is_developer  a platform-level flag, not a project role: a developer sees
--               every project and may do everything in each. Granted only
--               from the command line (npm run auth:developer) or by
--               another developer — never by a project admin.
-- is_active     a deactivated account cannot sign in; its sessions are
--               revoked when it is deactivated.
-- areas         the disciplines a member works in (piping, civil, …). Empty
--               means all. It decides the member's menu, and which areas
--               they may WRITE to; reading stays open, as it must for a
--               tag's cross-discipline record.
-- user_setup_token  a one-time link to set a password: a new account's
--               first one, or a reset. Kept as a SHA-256 of the token — the
--               token itself exists only in the link — expiring, single-use.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE app_user ADD COLUMN is_developer boolean NOT NULL DEFAULT false;
ALTER TABLE app_user ADD COLUMN is_active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX app_user_email_unique ON app_user (lower(email)) WHERE email IS NOT NULL;

ALTER TABLE project_member ADD COLUMN areas text[] NOT NULL DEFAULT '{}';
ALTER TABLE project_member ADD CONSTRAINT member_areas_known CHECK (areas <@ ARRAY[
  'piping', 'civil', 'structural', 'equipment', 'electrical', 'instrumentation', 'coating', 'quality',
  'completions', 'hse', 'controls', 'procurement', 'warehouse', 'documents', 'handover']::text[]);

CREATE TABLE user_setup_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash  char(64) NOT NULL UNIQUE,
  purpose     text NOT NULL,
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
ALTER TABLE user_setup_token ADD CONSTRAINT setup_purpose_known CHECK (purpose IN ('setup', 'reset'));
-- Outside project scope, like user_credential; never for a BI tool.
GRANT SELECT, INSERT, UPDATE ON user_setup_token TO app_rw;
REVOKE ALL ON user_setup_token FROM app_report;
