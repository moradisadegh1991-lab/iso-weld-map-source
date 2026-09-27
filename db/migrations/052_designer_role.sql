-- The designer as a user of the platform, not a name typed on a form.
--
-- A design consultant submits its transmittals and answers the comments the
-- project returns to it; the project's reviewers distribute, comment and
-- code. The two sides work on different screens and neither sees the
-- other's forms: the designer does not see the internal review (who is
-- reviewing, comments not yet sent back), and a reviewer does not type the
-- designer's transmittal or its replies. `designer` is a project role with
-- exactly that one grant (lib/authz.mjs).
ALTER TYPE project_role ADD VALUE IF NOT EXISTS 'designer';

-- Who answered a comment, and when: the designer's own record, no longer a
-- line a reviewer copied from a comment sheet when closing it.
ALTER TABLE doc_comment ADD COLUMN designer_replied_by uuid REFERENCES app_user(id);
ALTER TABLE doc_comment ADD COLUMN designer_replied_at timestamptz;
