-- A vendor is a company the project deals with, not a code and a name:
-- who to call, where to write, what they supply. Bids and POs pick the
-- vendor from this register, so its details are typed once.
--
-- Every new column is optional — an existing vendor keeps what it had, and
-- a field nobody knows stays empty rather than filled with a placeholder.

ALTER TABLE vendor ADD COLUMN contact_name text;
ALTER TABLE vendor ADD COLUMN email        text;
ALTER TABLE vendor ADD COLUMN phone        text;
ALTER TABLE vendor ADD COLUMN address      text;
ALTER TABLE vendor ADD COLUMN city         text;
ALTER TABLE vendor ADD COLUMN website      text;
ALTER TABLE vendor ADD COLUMN scope        text;   -- what they supply: pumps, valves, cable…
ALTER TABLE vendor ADD COLUMN notes        text;

-- The same line the repository draws, so a direct write cannot store an
-- address that is not one.
ALTER TABLE vendor ADD CONSTRAINT vendor_email_shape
  CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
