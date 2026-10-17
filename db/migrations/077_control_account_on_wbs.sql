-- ─────────────────────────────────────────────────────────────────────────
-- One WBS: a control account is a node of the master plan's WBS.
--
-- Project controls kept its own WBS (control_account, 021) beside the
-- contract planning WBS (wbs_node, 073): two lists of codes, titles and
-- budgets for the same work, typed twice and drifting apart. From here a
-- control account is picked from the WBS of a master version. Its code,
-- title and budget are the node's, read on every use; its planned curve is
-- the master plan's dates and weights; and its earned value can be the
-- node's progress — the daily reports and the platform records its
-- activities are linked to (075). The BOQ lines, costs, risks, timesheets
-- and finance that hang on a control account hang on that node.
--
-- An account made before this stays as it was (typed code, points and
-- progress) until someone links it to a node.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE control_account ADD COLUMN wbs_node_id uuid REFERENCES wbs_node(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX control_account_wbs_node ON control_account (wbs_node_id) WHERE wbs_node_id IS NOT NULL;

ALTER TABLE control_account DROP CONSTRAINT account_ev_method_known;
ALTER TABLE control_account ADD CONSTRAINT account_ev_method_known CHECK (ev_method IN ('manual', 'platform', 'wbs'));
ALTER TABLE control_account ADD CONSTRAINT account_wbs_names_node CHECK (ev_method <> 'wbs' OR wbs_node_id IS NOT NULL);

ALTER TABLE ev_snapshot DROP CONSTRAINT ev_snapshot_method;
ALTER TABLE ev_snapshot ADD CONSTRAINT ev_snapshot_method CHECK (ev_method IN ('platform', 'manual', 'wbs'));
