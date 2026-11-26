CREATE TABLE shared_signer_approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES structure_subscription(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES structure_source(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES contract_member(id) ON DELETE CASCADE,
  source_decree text NOT NULL,
  destination_decree text NOT NULL,
  type_id uuid NOT NULL REFERENCES report_type(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES review_group(id) ON DELETE CASCADE,
  approved_by uuid NOT NULL REFERENCES app_user(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id,appointment_id,type_id,group_id)
);
CREATE INDEX shared_signer_type ON shared_signer_approval(type_id);
ALTER TABLE shared_signer_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_signer_approval FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON shared_signer_approval USING (project_id=current_project_id()) WITH CHECK (project_id=current_project_id());
GRANT SELECT ON shared_signer_approval TO app_report;

-- Check the source appointment in one statement so concurrent reads sharing a
-- connection cannot observe the temporary source project between queries.
CREATE FUNCTION shared_signer_source_active(approval uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  destination uuid := current_project_id();
  candidate record;
  active boolean;
BEGIN
  SELECT b.project_id,b.contract_id,b.company_id,m.user_id,a.source_decree INTO candidate
  FROM shared_signer_approval a JOIN structure_subscription x ON x.id=a.subscription_id AND x.source_id=a.source_id
  JOIN structure_source b ON b.id=x.source_id JOIN contract_member m ON m.id=a.appointment_id
  WHERE a.id=approval AND a.project_id=destination AND (x.selection->'users') ? m.user_id::text;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM set_config('app.project_id',candidate.project_id::text,true);
  SELECT EXISTS(SELECT 1 FROM contract_member m JOIN app_user u ON u.id=m.user_id
    WHERE m.contract_id=candidate.contract_id AND m.user_id=candidate.user_id
      AND m.decree=candidate.source_decree AND appointment_active(m.id) AND u.is_active AND u.company_id=candidate.company_id)
    INTO active;
  PERFORM set_config('app.project_id',destination::text,true);
  RETURN active;
END;
$$;
