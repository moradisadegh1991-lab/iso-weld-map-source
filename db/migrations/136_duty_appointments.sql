ALTER TABLE duty_member ADD COLUMN appointment_id uuid REFERENCES contract_member(id) ON DELETE CASCADE;
CREATE FUNCTION appointment_active(appointment uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT appointment IS NULL OR EXISTS (SELECT 1 FROM contract_member m WHERE m.id=appointment AND m.status='active'
    AND (m.starts_on IS NULL OR m.starts_on<=CURRENT_DATE) AND (m.ends_on IS NULL OR m.ends_on>=CURRENT_DATE));
$$;
