-- ─────────────────────────────────────────────────────────────────────────
-- A template's activity carries the fields a person types on an activity in
-- the activities table (owner's request 2026-10-25: «جهت ایجاد الگو … لیست
-- فیلدهای جدول فعالیت‌ها نمایش داده شود، حتی فیلدهایی که کاربر به جدول
-- فعالیت‌ها اضافه کرده»), and hands them to the activities made from it
-- (lib/db/repos/eps.mjs attachTemplate, syncTemplate):
--
--   act_type, activity_no, wf_rate   as on wbs_activity (083)
--   volume_plan                      as on wbs_activity (074)
--
-- The project's own columns of the activities table (custom_field
-- 'eps-activities', 085) are kept for a template's activity under its id,
-- as for any row, and copied onto the activity made from it.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE template_activity ADD COLUMN act_type text;
ALTER TABLE template_activity ADD COLUMN activity_no text;
ALTER TABLE template_activity ADD COLUMN wf_rate numeric(24,10);
ALTER TABLE template_activity ADD COLUMN volume_plan numeric(16,3) CHECK (volume_plan IS NULL OR volume_plan >= 0);
