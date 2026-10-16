-- ─────────────────────────────────────────────────────────────────────────
-- PMS ↔ the platform's own records (owner's request 2026-10-16): a WBS
-- activity's scope and progress read from the equipment, welds, cables,
-- instruments, foundations and structures the platform holds, so that a new
-- drawing, P&ID or equipment register — or one withdrawn — reaches the PMS.
--
-- scope_rule        what a rule takes in: a discipline, filters (subsystem,
--                   unit, number pattern, drawing pattern, kind), the measure
--                   (count, inch-dia, cable metres, concrete m³) and the
--                   milestone that counts as done.
--                     aggregate  on one activity: its volume and its done
--                                are the matching items', worked out on read
--                     per_item   on a WBS node: one activity per item (per
--                                line for piping), made, weighted and
--                                withdrawn as the items come and go
-- scope_item_seen   the items a rule held when it was last applied — what
--                   «changes since» is measured against
-- scope_change      every apply: what came in, what went out, by whom, and
--                   whether it was applied on its own (auto) or by a person
-- wbs_activity      the rule an activity was made by and its item (per_item),
--                   and a flag for one whose item left the scope but which
--                   could not be deleted (work, relations or roles hang on it)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE scope_rule (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  version_id   uuid NOT NULL REFERENCES eps_version(id) ON DELETE CASCADE,
  mode         text NOT NULL CHECK (mode IN ('aggregate', 'per_item')),
  activity_id  uuid UNIQUE REFERENCES wbs_activity(id) ON DELETE CASCADE,
  node_id      uuid UNIQUE REFERENCES wbs_node(id) ON DELETE CASCADE,
  discipline   text NOT NULL CHECK (discipline IN ('equipment', 'piping', 'electrical', 'instrumentation', 'civil', 'structural')),
  filter       jsonb NOT NULL DEFAULT '{}',
  measure      text NOT NULL DEFAULT 'count' CHECK (measure IN ('count', 'dia_inch', 'length_m', 'volume_m3')),
  milestone    text NOT NULL,
  auto_apply   boolean NOT NULL DEFAULT true,
  applied_at   timestamptz,
  applied_by   uuid REFERENCES app_user(id),
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((mode = 'aggregate') = (activity_id IS NOT NULL)),
  CHECK ((mode = 'per_item') = (node_id IS NOT NULL))
);
CREATE INDEX scope_rule_version ON scope_rule (version_id);

CREATE TABLE scope_item_seen (
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  rule_id     uuid NOT NULL REFERENCES scope_rule(id) ON DELETE CASCADE,
  item_key    text NOT NULL,
  label       text NOT NULL,
  qty         numeric(16,3),
  PRIMARY KEY (rule_id, item_key)
);

CREATE TABLE scope_change (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  rule_id     uuid NOT NULL REFERENCES scope_rule(id) ON DELETE CASCADE,
  added       jsonb NOT NULL DEFAULT '[]',
  removed     jsonb NOT NULL DEFAULT '[]',
  changed     jsonb NOT NULL DEFAULT '[]',
  auto        boolean NOT NULL DEFAULT false,
  by_user     uuid REFERENCES app_user(id),
  at          timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX scope_change_rule ON scope_change (rule_id, at);

ALTER TABLE wbs_activity ADD COLUMN scope_rule_id uuid REFERENCES scope_rule(id) ON DELETE SET NULL;
ALTER TABLE wbs_activity ADD COLUMN scope_item text;
ALTER TABLE wbs_activity ADD COLUMN scope_removed boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX wbs_activity_scope_item ON wbs_activity (scope_rule_id, scope_item) WHERE scope_rule_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['scope_rule', 'scope_item_seen', 'scope_change'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY project_isolation ON %I USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
