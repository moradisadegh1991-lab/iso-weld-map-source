-- ─────────────────────────────────────────────────────────────────────────
-- The cost and float of an activity, as Primavera P6 names them (owner's
-- requirements of 2026-10-26, items 3 and 4), and the PMSs a contract uses
-- now (item 5).
--
--   target_cost         Budgeted Total Cost      بودجهٔ برنامه‌ای
--   act_cost            Actual Total Cost        هزینهٔ واقعی
--   remain_cost         Remaining Total Cost     بودجهٔ لازم برای تکمیل
--   total_cost          At Completion Total Cost کل بودجهٔ لازم تا تکمیل
--   free_float_hr_cnt   Free Float (h)           شناوری
--   total_float_hr_cnt  Total Float (h)          شناوری کل
--   cost_complete_pct   Cost % Complete (%)
--   act_pct_spent       (*)Cost % of Budget (%)
--
--   wbs_activity        all eight as a person types them (the activity table)
--   template_activity   the same, handed to the activity made from it
--   activity_plan       the six a person types, in the version's plan; the
--                       two percentages are worked out by the database from
--                       them, as the owner defines them:
--                         cost_complete_pct = target_cost / total_cost × 100
--                         act_pct_spent     = act_cost    / total_cost × 100
--                       empty while either side is empty or the total is 0 —
--                       never a figure nobody gave
--
--   eps_pms.active      a PMS the contract uses now; the pages that pick a
--                       PMS offer only these. Every PMS already there is
--                       active, as it was offered before.
--
-- Float may be negative (an activity behind its late dates); a cost may not.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wbs_activity', 'template_activity', 'activity_plan'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN target_cost numeric(24,4) CHECK (target_cost IS NULL OR target_cost >= 0)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN act_cost numeric(24,4) CHECK (act_cost IS NULL OR act_cost >= 0)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN remain_cost numeric(24,4) CHECK (remain_cost IS NULL OR remain_cost >= 0)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN total_cost numeric(24,4) CHECK (total_cost IS NULL OR total_cost >= 0)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN free_float_hr_cnt numeric(16,4)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN total_float_hr_cnt numeric(16,4)', t);
  END LOOP;
END $$;

ALTER TABLE wbs_activity ADD COLUMN cost_complete_pct numeric(14,4);
ALTER TABLE wbs_activity ADD COLUMN act_pct_spent numeric(14,4);
ALTER TABLE template_activity ADD COLUMN cost_complete_pct numeric(14,4);
ALTER TABLE template_activity ADD COLUMN act_pct_spent numeric(14,4);

ALTER TABLE activity_plan ADD COLUMN cost_complete_pct numeric(14,4)
  GENERATED ALWAYS AS (CASE WHEN total_cost > 0 THEN round(target_cost / total_cost * 100, 4) END) STORED;
ALTER TABLE activity_plan ADD COLUMN act_pct_spent numeric(14,4)
  GENERATED ALWAYS AS (CASE WHEN total_cost > 0 THEN round(act_cost / total_cost * 100, 4) END) STORED;

ALTER TABLE eps_pms ADD COLUMN active boolean NOT NULL DEFAULT true;
