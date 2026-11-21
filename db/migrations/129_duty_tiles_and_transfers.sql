ALTER TABLE duty ADD COLUMN tiles text[] NOT NULL DEFAULT '{}';

ALTER TABLE duty_member DROP CONSTRAINT duty_member_permissions_check;
ALTER TABLE duty_member ADD CONSTRAINT duty_member_permissions_check
  CHECK (permissions IS NULL OR (cardinality(permissions) > 0 AND permissions <@ ARRAY['view','create','add_content','edit','delete_content','delete','sign','return','approve','import','export']::text[]));

ALTER TABLE group_member DROP CONSTRAINT group_member_permissions_check;
ALTER TABLE group_member ADD CONSTRAINT group_member_permissions_check
  CHECK (permissions <@ ARRAY['view','create','add_content','edit','edit_after_sign','delete_content','delete','sign','return','approve','import','export']::text[]);

ALTER TABLE group_duty DROP CONSTRAINT group_duty_permissions_check;
ALTER TABLE group_duty ADD CONSTRAINT group_duty_permissions_check
  CHECK (permissions <@ ARRAY['view','create','add_content','edit','delete_content','delete','sign','return','approve','import','export']::text[]);
