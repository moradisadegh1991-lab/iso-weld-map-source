-- Work handed over by the contractor, accepted by the employer.
--
-- With the project's `site_work_approval` on, a step a contractor-side
-- member records as done is a CLAIM: it is kept as in progress, with the
-- date the contractor says the work was finished (`claimed_on`), and it
-- counts nowhere — not in progress, EV, a payment statement or MC — until a
-- member who signs for the employer (inspection party «company») approves
-- it. Approval makes it done on the claimed date; a rejection keeps the
-- step open with the reason, for the contractor to put right and claim
-- again.
--
-- Keeping a claim as `in_progress` rather than a new status is deliberate:
-- every query that counts work already counts `status = 'done'`, so a
-- claim is excluded from all of them without touching any of them.

ALTER TABLE project ADD COLUMN site_work_approval boolean NOT NULL DEFAULT false;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tag_activity', 'spool_activity', 'cable_activity', 'instrument_activity', 'coating_activity'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN claimed_on date', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN approved_by uuid REFERENCES app_user(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN approved_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN rejected_by uuid REFERENCES app_user(id) ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN rejected_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN rejected_reason text', t);
    -- A claim is open work: never a done step with a pending claim on it.
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (claimed_on IS NULL OR status = ''in_progress'')', t, t || '_claim_is_open');
    -- An approval names who approved, and when.
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((approved_by IS NULL) = (approved_at IS NULL))', t, t || '_approval_complete');
  END LOOP;
END $$;
