-- ─────────────────────────────────────────────────────────────────────────
-- Spool loads (owner's request 2026-10-20, from the Piping.Tools reports):
-- a load is one truck from the fabrication shop to site — the spools on it
-- and the loose items shipped with them (ship-loose: valves, bolts, gaskets
-- that travel beside a spool but are not welded into it). Its packing list
-- and the delivery column of the piping progress report read from here.
--
-- ship_load        one load: number, where it goes, when it left and arrived
-- ship_load_spool  a spool on a load — a spool travels on one load only
-- ship_load_item   a ship-loose line: what, how many, for which drawing
--
-- A load that has left carries its leave date; a delivered one its arrival,
-- not before it left. Nothing else is inferred: a spool not on a load has no
-- delivery, whatever its stage.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE ship_load (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  load_no       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shipped', 'delivered')),
  destination   text,
  leave_on      date,
  delivered_on  date,
  notes         text,
  created_by    uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, load_no),
  CONSTRAINT load_left_is_dated CHECK (status = 'pending' OR leave_on IS NOT NULL),
  CONSTRAINT load_arrival_is_dated CHECK (status <> 'delivered' OR delivered_on IS NOT NULL),
  CONSTRAINT load_arrives_after_leaving CHECK (delivered_on IS NULL OR (leave_on IS NOT NULL AND delivered_on >= leave_on))
);

CREATE TABLE ship_load_spool (
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  load_id     uuid NOT NULL REFERENCES ship_load(id) ON DELETE CASCADE,
  spool_id    uuid NOT NULL REFERENCES spool(id) ON DELETE CASCADE,
  added_by    uuid REFERENCES app_user(id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (load_id, spool_id),
  CONSTRAINT spool_on_one_load UNIQUE (project_id, spool_id)
);

CREATE TABLE ship_load_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  load_id      uuid NOT NULL REFERENCES ship_load(id) ON DELETE CASCADE,
  drawing_ref  text,
  item_no      text,
  description  text NOT NULL,
  qty          numeric(14,3) NOT NULL CHECK (qty > 0),
  uom          text NOT NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ship_load_item_load ON ship_load_item (load_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ship_load', 'ship_load_spool', 'ship_load_item'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
