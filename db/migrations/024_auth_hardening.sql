-- ─────────────────────────────────────────────────────────────────────────
-- Session revocation and per-source login throttling.
--
-- A session cookie is signed and self-contained, so until now nothing could
-- end one early: logging out cleared one browser's copy, and a stolen cookie
-- stayed good for its eight hours. The cookie now carries the credential's
-- session_version; bumping it (a new password, "sign out everywhere")
-- revokes every cookie issued before.
--
-- The per-account lockout (migration 010) stops guessing one account's
-- password. It does not stop trying one common password against every
-- account, a few tries each. login_failure counts failures per source.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE user_credential ADD COLUMN session_version integer NOT NULL DEFAULT 0;

CREATE TABLE login_failure (
  id      bigserial PRIMARY KEY,
  source  text NOT NULL,
  at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX login_failure_source_at ON login_failure (source, at);

-- Outside project scope, like user_credential; the application role never
-- needs it (the login path runs before any project is chosen).
REVOKE ALL ON login_failure FROM app_rw, app_report;
