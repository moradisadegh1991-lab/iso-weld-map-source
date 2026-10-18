-- ─────────────────────────────────────────────────────────────────────────
-- A person's own settings: language, theme, accent, density, text size and
-- the default table view. Kept on the account, not only in one browser, so
-- they follow the person to the phone on site and the desk in the office.
-- lib/prefs.mjs is the one list of what may be stored and its allowed values.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE app_user ADD COLUMN prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE app_user ADD CONSTRAINT app_user_prefs_object CHECK (jsonb_typeof(prefs) = 'object');
