-- ─────────────────────────────────────────────────────────────────────────
-- Passwords, so the platform can be reached over the internet.
--
-- Until now identity was a subject string typed into a box and trusted
-- (AUTH_MODE=dev). That is correct on a laptop and catastrophic behind a
-- public URL, which is where this is going.
--
-- WHY THIS IS STILL NOT THE END STATE
--
-- The reference architecture puts Keycloak here, and the seam for it is
-- still in lib/authz.mjs — `createIdentityResolver` takes a verifier, and
-- nothing downstream knows what verified the caller. This adds a SECOND
-- verifier, it does not remove that seam. Migrating later means issuing
-- tokens from Keycloak instead of this table; every permission rule, every
-- membership check and every policy stays exactly as it is.
--
-- The hash is scrypt from node:crypto — deliberately no new dependency, and
-- deliberately not a fast hash. Parameters are stored WITH each hash so they
-- can be raised later without invalidating everyone's password.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE user_credential (
  user_id        uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  -- "scrypt$N$r$p$<salt b64>$<hash b64>" — self-describing, so a hash made
  -- under today's cost parameters still verifies after they are raised.
  password_hash  text NOT NULL,
  must_change    boolean NOT NULL DEFAULT false,
  -- Lockout state. Counting failures in the database rather than in memory
  -- because the app runs as several instances on Vercel, and a counter in
  -- one process is not a lockout.
  failed_count   int NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  password_set_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- app_user rows are the directory; credentials hang off them. No RLS: these
-- tables are outside project scope by design (see lib/db/repos/projects.mjs),
-- and this one is only ever read by the login path, by user_id.
GRANT SELECT, INSERT, UPDATE, DELETE ON user_credential TO app_rw;

-- Deliberately NOT granted to app_report. A password hash has no business in
-- a BI tool, and the reporting role is the one most likely to be handed out.
