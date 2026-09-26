-- ─────────────────────────────────────────────────────────────────────────
-- Incoming transmittals from the designer, the file of each revision, and
-- the project's review: distribution to disciplines, comments that live
-- with the document across revisions, and the coded reply.
-- Rules: lib/documents/review.mjs.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE project ADD COLUMN doc_review_days integer;   -- the contract's review period; no default
ALTER TABLE project ADD CONSTRAINT doc_review_days_positive CHECK (doc_review_days IS NULL OR doc_review_days > 0);

-- The file a revision was issued as — stored by its hash, never replaced.
ALTER TABLE mdr_revision
  ADD COLUMN file_uri       text,
  ADD COLUMN file_sha256    text,
  ADD COLUMN file_name      text,
  ADD COLUMN file_size      bigint,
  ADD COLUMN content_type   text;
ALTER TABLE mdr_revision ADD CONSTRAINT mdr_file_whole CHECK ((file_uri IS NULL) = (file_sha256 IS NULL));

-- A document first seen on a designer's transmittal, not on the agreed MDR.
ALTER TABLE mdr_document ADD COLUMN outside_mdr boolean NOT NULL DEFAULT false;

-- Transmittals now go both ways.
ALTER TABLE transmittal
  ADD COLUMN direction    text NOT NULL DEFAULT 'out',
  ADD COLUMN from_party   text,
  ADD COLUMN received_on  date,
  ADD COLUMN received_by  uuid REFERENCES app_user(id);
ALTER TABLE transmittal ALTER COLUMN to_party DROP NOT NULL;
ALTER TABLE transmittal ADD CONSTRAINT transmittal_direction CHECK (direction IN ('out', 'in'));
ALTER TABLE transmittal ADD CONSTRAINT transmittal_parties CHECK (
  (direction = 'out' AND to_party IS NOT NULL) OR
  (direction = 'in' AND from_party IS NOT NULL AND received_on IS NOT NULL AND received_on >= sent_on));
ALTER TABLE transmittal DROP CONSTRAINT transmittal_project_id_transmittal_no_key;
ALTER TABLE transmittal ADD CONSTRAINT transmittal_no_once UNIQUE (project_id, direction, transmittal_no);

-- The project's reply to an incoming transmittal.
CREATE TABLE doc_reply (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  reply_no     text NOT NULL,
  incoming_id  uuid NOT NULL REFERENCES transmittal(id),
  to_party     text NOT NULL,
  sent_on      date NOT NULL,
  sent_by      uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, reply_no)
);
ALTER TABLE transmittal_item ADD COLUMN reply_id uuid REFERENCES doc_reply(id);
ALTER TABLE transmittal_item ADD COLUMN due_on date;
-- What was wrong with an incoming revision when it arrived (e.g. IFC before approval). A receipt is
-- a fact and is recorded; refusing it would lose the evidence without unsending the document.
ALTER TABLE transmittal_item ADD COLUMN receipt_flags text[] NOT NULL DEFAULT '{}';
GRANT UPDATE (reply_id) ON transmittal_item TO app_rw;

CREATE TABLE doc_review (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES transmittal_item(id) ON DELETE CASCADE,
  discipline    text NOT NULL,
  reviewer_id   uuid REFERENCES app_user(id),
  status        text NOT NULL DEFAULT 'open',
  waive_reason  text,
  assigned_by   uuid REFERENCES app_user(id),
  assigned_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_by   uuid REFERENCES app_user(id),
  finished_at   timestamptz,
  UNIQUE (item_id, discipline)
);
ALTER TABLE doc_review ADD CONSTRAINT doc_review_status CHECK (status IN ('open', 'done', 'waived'));
ALTER TABLE doc_review ADD CONSTRAINT doc_review_waiver_says_why CHECK (status <> 'waived' OR waive_reason IS NOT NULL);

CREATE TABLE doc_comment (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  mdr_id             uuid NOT NULL REFERENCES mdr_document(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL REFERENCES transmittal_item(id) ON DELETE CASCADE,   -- raised on this revision
  discipline         text NOT NULL,
  ref                text,                  -- sheet, clause or tag the comment points at
  text               text NOT NULL,
  raised_by          uuid REFERENCES app_user(id),
  raised_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  status             text NOT NULL DEFAULT 'open',
  designer_reply     text,
  closed_item_id     uuid REFERENCES transmittal_item(id),   -- the revision it was closed on
  closed_by          uuid REFERENCES app_user(id),
  closed_at          timestamptz
);
ALTER TABLE doc_comment ADD CONSTRAINT doc_comment_status CHECK (status IN ('open', 'closed'));
ALTER TABLE doc_comment ADD CONSTRAINT doc_comment_closed_with_reply CHECK (status = 'open' OR designer_reply IS NOT NULL);
CREATE INDEX doc_comment_mdr ON doc_comment (mdr_id, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doc_reply', 'doc_review', 'doc_comment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY project_isolation ON %I USING (project_id = current_project_id())'
      ' WITH CHECK (project_id = current_project_id())', t);
    EXECUTE format('GRANT SELECT ON %I TO app_report', t);
  END LOOP;
END $$;
REVOKE UPDATE, DELETE, TRUNCATE ON doc_reply FROM app_rw;
GRANT SELECT, INSERT ON doc_reply TO app_rw;

-- Power BI: turnaround and overdue replies.
CREATE VIEW reporting.fact_incoming_item WITH (security_invoker = true) AS
SELECT i.id AS item_key, i.project_id AS project_key, t.transmittal_no, t.from_party, t.sent_on, t.received_on,
       i.due_on, i.revision_id AS revision_key, d.doc_no, d.discipline, r.revision, r.purpose,
       i.return_code, i.returned_on, rp.reply_no,
       (SELECT count(*) FROM doc_comment c WHERE c.item_id = i.id)::int AS comments_raised
  FROM transmittal_item i JOIN transmittal t ON t.id = i.transmittal_id
  JOIN mdr_revision r ON r.id = i.revision_id JOIN mdr_document d ON d.id = r.mdr_id
  LEFT JOIN doc_reply rp ON rp.id = i.reply_id
 WHERE t.direction = 'in';
GRANT SELECT ON reporting.fact_incoming_item TO app_rw, app_report;
