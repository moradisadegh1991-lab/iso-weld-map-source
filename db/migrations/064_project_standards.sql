-- The standards a project adopts, with the EDITION it adopts: an edition is
-- a project fact (the contract's list of applicable codes), never assumed.
-- lib/reference/epc.mjs lists the usual ones; this is the project's own.
CREATE TABLE project_standard (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code        text NOT NULL CHECK (length(btrim(code)) > 0),
  title       text,
  edition     text,                 -- null: not yet stated (shown as missing information)
  scope       text,                 -- what it governs on this project
  source      text,                 -- where the project states it (contract annex, job specification …)
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
ALTER TABLE project_standard ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_standard FORCE ROW LEVEL SECURITY;
CREATE POLICY project_isolation ON project_standard USING (project_id = current_project_id()) WITH CHECK (project_id = current_project_id());
GRANT SELECT ON project_standard TO app_report;
