-- ─────────────────────────────────────────────────────────────────────────
-- Before 083 makes the WBS the PMS's: a PMS whose versions each built a
-- tree of their own (the rule until 083) is split, nothing dropped.
--
--   The tree of the PMS's master version stays on it (no master among them:
--   the first by order). Each other version with a tree of its own moves,
--   with its tree, its scope rules and its activities, to a new PMS of the
--   same contract: the old one's fields, code «<PMS>-<version>», title
--   «<PMS title> (<version title>)». Versions without a tree stay where they
--   are. Which of the trees is the plan is still the planner's call; this
--   only keeps each where 083 can carry it.
--
-- On a database already past 083 (wbs_node has no version_id) it does
-- nothing.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v record;
  base text;
  new_code text;
  n int;
  new_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'wbs_node' AND column_name = 'version_id') THEN
    RETURN;
  END IF;

  FOR v IN
    SELECT ver.id AS version_id, ver.code AS vcode, ver.title AS vtitle, p.project_id, p.contract_id, p.code AS pcode, p.title AS ptitle,
           p.registered_on, p.plan_start, p.plan_end, p.actual_start, p.actual_end, p.created_by, p.pms_type, p.description
      FROM (SELECT ev.*, row_number() OVER (PARTITION BY ev.pms_id ORDER BY ev.master DESC, ev.seq, ev.created_at, ev.id) AS rank
              FROM eps_version ev WHERE EXISTS (SELECT 1 FROM wbs_node w WHERE w.version_id = ev.id)) ver
      JOIN eps_pms p ON p.id = ver.pms_id
     WHERE ver.rank > 1
     ORDER BY p.code, ver.rank
  LOOP
    base := left(v.pcode || '-' || regexp_replace(v.vcode, '[^A-Za-z0-9_-]', '-', 'g'), 20);
    new_code := base; n := 1;
    WHILE EXISTS (SELECT 1 FROM eps_pms e WHERE e.project_id = v.project_id AND e.code = new_code) LOOP
      n := n + 1;
      new_code := left(base, 20 - length(n::text) - 1) || '-' || n;
    END LOOP;
    INSERT INTO eps_pms (project_id, contract_id, code, title, registered_on, plan_start, plan_end, actual_start, actual_end,
                         seq, created_by, pms_type, description)
      VALUES (v.project_id, v.contract_id, new_code, v.ptitle || ' (' || v.vtitle || ')', v.registered_on, v.plan_start, v.plan_end,
              v.actual_start, v.actual_end,
              (SELECT coalesce(max(e.seq), 0) + 1 FROM eps_pms e WHERE e.contract_id = v.contract_id), v.created_by, v.pms_type, v.description)
      RETURNING id INTO new_id;
    UPDATE eps_version SET pms_id = new_id WHERE id = v.version_id;
  END LOOP;
END $$;
