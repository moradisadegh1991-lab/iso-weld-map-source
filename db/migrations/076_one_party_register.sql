-- ─────────────────────────────────────────────────────────────────────────
-- One register of parties: a contractor is a company.
--
-- The project had three places that said who a company is: the companies
-- (067), the project's contractors (009) and, typed into the project page,
-- the client, consultant and EPC contractor names. A contractor typed on its
-- own page was a second company record that the companies list did not know.
--
-- From here a contractor is the project's profile of a company acting as a
-- contractor (status, disciplines, prequalification). Its company is set on
-- every insert: the one picked, or the company of the same code, or a new
-- company made from what was typed. The name follows the company. And a
-- contractor is a stakeholder of its project, so the project's parties list
-- is the one place that lists who works on it.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE contractor ADD COLUMN company_id uuid REFERENCES company(id) ON DELETE RESTRICT;
CREATE INDEX contractor_company ON contractor (company_id);

-- The company a contractor code stands for: the one of that code (any case),
-- or a new one. A company code is Latin letters, digits, - and _ (067); a
-- contractor code that is not becomes one, and if nothing is left, a code
-- made from the name.
CREATE FUNCTION company_for_contractor(p_code text, p_name text, p_nid text, p_phone text, p_email text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  cid uuid;
  c   text := left(regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9_-]', '', 'g'), 16);
BEGIN
  SELECT id INTO cid FROM company WHERE upper(code) = upper(p_code) ORDER BY created_at LIMIT 1;
  IF cid IS NOT NULL THEN RETURN cid; END IF;
  IF c !~ '^[A-Z0-9][A-Z0-9_-]{0,15}$' THEN c := 'K' || upper(substr(md5(coalesce(p_name, p_code, '')), 1, 8)); END IF;
  SELECT id INTO cid FROM company WHERE code = c;
  IF cid IS NOT NULL THEN RETURN cid; END IF;
  INSERT INTO company (code, name, national_id, phone, email)
  VALUES (c, coalesce(nullif(btrim(p_name), ''), c), p_nid, p_phone, p_email) RETURNING id INTO cid;
  RETURN cid;
END $$;

CREATE FUNCTION contractor_is_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := company_for_contractor(NEW.code, NEW.name, NEW.national_id, NEW.contact_phone, NEW.contact_email);
  END IF;
  SELECT name INTO NEW.name FROM company WHERE id = NEW.company_id;
  RETURN NEW;
END $$;
CREATE TRIGGER contractor_is_company BEFORE INSERT OR UPDATE OF company_id, name ON contractor
  FOR EACH ROW EXECUTE FUNCTION contractor_is_company();

-- A contractor is a party of its project.
CREATE FUNCTION contractor_is_stakeholder() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO project_stakeholder (project_id, company_id, role)
  SELECT NEW.project_id, NEW.company_id, 'contractor'
   WHERE NOT EXISTS (SELECT 1 FROM project_stakeholder s WHERE s.project_id = NEW.project_id
                        AND s.company_id = NEW.company_id AND s.role IN ('contractor', 'subcontractor', 'epc'));
  RETURN NULL;
END $$;
CREATE TRIGGER contractor_is_stakeholder AFTER INSERT OR UPDATE OF company_id ON contractor
  FOR EACH ROW EXECUTE FUNCTION contractor_is_stakeholder();

-- A company renamed is renamed wherever it is a contractor. SECURITY DEFINER:
-- a company belongs to no project, its contractors to many.
CREATE FUNCTION company_renamed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE contractor SET name = NEW.name WHERE company_id = NEW.id AND name IS DISTINCT FROM NEW.name;
  RETURN NULL;
END $$;
CREATE TRIGGER company_renamed AFTER UPDATE OF name ON company
  FOR EACH ROW EXECUTE FUNCTION company_renamed();

-- Every contractor already registered gets its company and its stakeholder
-- row. Row level security is lifted for these statements, as 044b does: run
-- by an owner that is not a superuser, they would otherwise see no project.
ALTER TABLE contractor NO FORCE ROW LEVEL SECURITY;
ALTER TABLE project_stakeholder NO FORCE ROW LEVEL SECURITY;
UPDATE contractor SET company_id = company_for_contractor(code, name, national_id, contact_phone, contact_email)
 WHERE company_id IS NULL;
INSERT INTO project_stakeholder (project_id, company_id, role)
SELECT DISTINCT k.project_id, k.company_id, 'contractor' FROM contractor k
 WHERE NOT EXISTS (SELECT 1 FROM project_stakeholder s WHERE s.project_id = k.project_id
                      AND s.company_id = k.company_id AND s.role IN ('contractor', 'subcontractor', 'epc'));
ALTER TABLE project_stakeholder FORCE ROW LEVEL SECURITY;
ALTER TABLE contractor FORCE ROW LEVEL SECURITY;

ALTER TABLE contractor ALTER COLUMN company_id SET NOT NULL;

-- The reporting dimension carries the company, so a report joins a
-- contractor to the companies list by key rather than by a copied name.
CREATE OR REPLACE VIEW reporting.dim_contractor WITH (security_invoker = true) AS
SELECT c.id AS contractor_key, c.project_id AS project_key,
       c.code AS contractor_code, c.name AS contractor_name, c.status,
       c.disciplines, c.prequalified_until,
       (c.prequalified_until IS NOT NULL AND c.prequalified_until < CURRENT_DATE)
         AS prequalification_expired,
       COUNT(p.id) AS packages,
       SUM(p.value) AS awarded_value,
       c.company_id AS company_key
  FROM contractor c
  LEFT JOIN contract_package p ON p.contractor_id = c.id
 GROUP BY c.id;
